import {
  DiscordAPIError,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { FivemHierarchyPanel } from "./apiClient";
import { renderComponentsV2Panel, type PanelVisualConfig } from "./panelVisualRenderer";
import type { FivemHierarchyPanelUpdateAck } from "../websocket/socketClient";

type ScheduledRefresh = {
  roleIds: Set<string> | null;
  timeout: NodeJS.Timeout;
};

const scheduledGuilds = new Map<string, ScheduledRefresh>();

export const hierarchyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("hierarquia")
    .setDescription("Gerencia ou atualiza o painel de Hierarquia FAQ FiveM."),
  moduleId: "fivem-hierarchy",
  async execute(interaction: ChatInputCommandInteraction, context: BotContext) {
    if (!interaction.guild) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Voce precisa de permissao para gerenciar o servidor.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await refreshHierarchyPanelsForGuild(interaction.guild, context);
    await interaction.editReply("Painel de Hierarquia FAQ atualizado.");
  }
};

export function startFivemHierarchyService(client: Client<true>, context: BotContext) {
  context.socket.onFivemHierarchyPanelUpdate((payload, ack?: FivemHierarchyPanelUpdateAck) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) {
      ack?.({ error: "O bot nao esta conectado ao servidor selecionado.", ok: false, panelId: payload.panelId });
      return;
    }
    void refreshHierarchyPanelsForGuild(guild, context, payload.panelId)
      .then((results) => {
        const success = results.find((result) => result.ok);
        if (success) {
          ack?.(success);
          return;
        }
        ack?.(results[0] ?? { error: "Nenhum painel de hierarquia ativo foi encontrado para publicar.", ok: false, panelId: payload.panelId });
      })
      .catch((error) => {
        ack?.({ error: `Falha inesperada ao publicar hierarquia: ${errorMessage(error)}`, ok: false, panelId: payload.panelId });
      });
  });

  for (const guild of client.guilds.cache.values()) {
    scheduleHierarchyRefresh(guild, context);
  }
}

export function scheduleHierarchyRefresh(guild: Guild, context: BotContext) {
  scheduleHierarchyRefreshInternal(guild, context, null);
}

export function scheduleHierarchyRefreshForRoles(guild: Guild, context: BotContext, roleIds: string[]) {
  const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
  if (!uniqueRoleIds.length) return;
  scheduleHierarchyRefreshInternal(guild, context, uniqueRoleIds);
}

function scheduleHierarchyRefreshInternal(guild: Guild, context: BotContext, roleIds: string[] | null) {
  if (!isBotModuleEnabled("fivem-hierarchy")) return;
  const current = scheduledGuilds.get(guild.id);
  const nextRoleIds = !roleIds || current?.roleIds === null
    ? null
    : current?.roleIds
      ? new Set([...current.roleIds, ...roleIds])
      : new Set(roleIds);
  if (current) clearTimeout(current.timeout);
  const timeout = setTimeout(() => {
    scheduledGuilds.delete(guild.id);
    void refreshHierarchyPanelsForGuild(guild, context, null, nextRoleIds ? [...nextRoleIds] : null);
  }, 2500);
  timeout.unref();
  scheduledGuilds.set(guild.id, { roleIds: nextRoleIds, timeout });
}

export async function refreshHierarchyPanelsForGuild(guild: Guild, context: BotContext, panelId?: string | null, changedRoleIds?: string[] | null) {
  const panels = await context.api.getActiveFivemHierarchyPanels().catch((error) => {
    console.warn(`[fivem-hierarchy] falha ao buscar paineis ativos: ${errorMessage(error)}`);
    return [];
  });
  const changedRoleSet = changedRoleIds?.length ? new Set(changedRoleIds) : null;
  const scoped = panels.filter((panel) => {
    if (panel.guildId !== guild.id) return false;
    if (panelId && panel.id !== panelId) return false;
    if (!changedRoleSet) return true;
    return panel.hierarchies.some((item) => item.active && changedRoleSet.has(item.roleId));
  });
  if (!scoped.length) {
    return panelId
      ? [{ error: "Painel ativo nao encontrado para este bot. Salve o painel como ativo e confira se o bot DEV correto esta selecionado.", ok: false, panelId }]
      : [];
  }
  const fetchedMembers = await guild.members.fetch().catch((error) => {
    console.warn(`[fivem-hierarchy] falha ao buscar membros do servidor ${guild.id}: ${errorMessage(error)}`);
    return null;
  });
  const results = [];
  for (const panel of scoped) {
    results.push(await publishHierarchyPanel(guild, context, panel, (fetchedMembers ?? guild.members.cache).values()));
  }
  return results;
}

async function publishHierarchyPanel(guild: Guild, context: BotContext, panel: FivemHierarchyPanel, members: Iterable<GuildMember>) {
  if (!panel.enabled) return { error: "O painel de hierarquia esta desativado.", ok: false, panelId: panel.id };
  if (!panel.panelChannelId) return { error: "Canal do painel de hierarquia nao configurado.", ok: false, panelId: panel.id };
  const channel = await guild.channels.fetch(panel.panelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) {
    const error = "Canal do painel nao encontrado ou nao e um canal de texto.";
    await logPublishFailure(context, guild.id, panel, error);
    return { error, ok: false, panelId: panel.id };
  }
  const permissionReport = inspectPublishPermissions(guild, channel as PublishPermissionChannel, Boolean(panel.panelMessageId));
  await logPublishPermissionSnapshot(context, guild.id, panel, permissionReport);
  if (permissionReport.blockingMissing.length) {
    const error = `Permissoes ausentes no canal <#${channel.id}>: ${permissionReport.blockingMissing.join(", ")}. Permissoes reais: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
    await logPublishFailure(context, guild.id, panel, error, permissionReport);
    return { error, ok: false, panelId: panel.id };
  }
  await logMissingHierarchyRoles(context, guild, panel);
  const visuals = await getPanelVisualSlots(context, guild.id, "fivem-hierarchy");
  const payload = createHierarchyPayload(guild, panel, members, visuals[0] ?? null);
  let message = panel.panelMessageId ? await channel.messages.fetch(panel.panelMessageId).catch(() => null) : null;
  if (message) {
    message = await message.edit(payload).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Falha ao editar painel existente: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
      return channel.send(payload).catch(async (sendError) => {
        await logPublishFailure(context, guild.id, panel, `Falha ao reenviar painel: ${discordErrorMessage(sendError)}. ${permissionHint(permissionReport)}`, permissionReport);
        return null;
      });
    });
  } else {
    message = await channel.send(payload).catch(async (error) => {
      await logPublishFailure(context, guild.id, panel, `Falha ao enviar painel: ${discordErrorMessage(error)}. ${permissionHint(permissionReport)}`, permissionReport);
      return null;
    });
  }
  if (message) {
    await context.api.updateFivemHierarchyPanelState({ guildId: guild.id, messageId: message.id, panelId: panel.id }).catch(() => null);
    return { messageId: message.id, ok: true, panelId: panel.id };
  }
  return { error: `O Discord recusou o envio do painel no canal configurado. ${permissionHint(permissionReport)}`, ok: false, panelId: panel.id };
}

type PublishPermissionChannel = {
  id: string;
  permissionsFor(member: GuildMember): { has(permission: bigint): boolean; toArray(): string[] } | null;
};

function inspectPublishPermissions(guild: Guild, channel: PublishPermissionChannel, editingExistingMessage: boolean) {
  const me = guild.members.me;
  if (!me || !channel || !("permissionsFor" in channel)) {
    return {
      botId: me?.id ?? null,
      channelId: channel?.id ?? null,
      granted: [],
      blockingMissing: ["Validar membro do bot"],
      diagnosticMissing: ["Validar membro do bot"],
      required: ["Validar membro do bot"]
    };
  }
  const permissions = channel.permissionsFor(me);
  const required: Array<[bigint, string]> = [
    [PermissionFlagsBits.ViewChannel, "Ver Canal"],
    [PermissionFlagsBits.SendMessages, "Enviar Mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir Links"],
    [PermissionFlagsBits.ReadMessageHistory, "Ler Historico"]
  ];
  const diagnostic: Array<[bigint, string]> = editingExistingMessage
    ? [[PermissionFlagsBits.ManageMessages, "Gerenciar Mensagens"]]
    : [];
  const granted = permissions?.toArray() ?? [];
  const blockingMissing = required.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  const diagnosticMissing = diagnostic.filter(([permission]) => !permissions?.has(permission)).map(([, label]) => label);
  const report = {
    botId: me.id,
    channelId: channel.id,
    granted,
    blockingMissing,
    diagnosticMissing,
    required: required.map(([, label]) => label),
    diagnostic: diagnostic.map(([, label]) => label)
  };
  console.info(`[fivem-hierarchy] permissoes do bot no canal ${channel.id}: granted=${granted.join(",") || "nenhuma"} missing=${blockingMissing.join(",") || "nenhuma"} diagnosticMissing=${diagnosticMissing.join(",") || "nenhuma"}`);
  return report;
}

async function logPublishPermissionSnapshot(context: BotContext, guildId: string, panel: FivemHierarchyPanel, permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.permission_snapshot",
    type: "fivem_hierarchy.permission_snapshot",
    message: `Permissoes do bot no canal antes de publicar hierarquia: ${permissionReport.granted.join(", ") || "nenhuma"}. Faltando: ${permissionReport.blockingMissing.join(", ") || "nenhuma"}. Diagnostico: ${permissionReport.diagnosticMissing.join(", ") || "nenhuma"}.`,
    metadata: { panelId: panel.id, ...permissionReport }
  }).catch(() => null);
}

async function logPublishFailure(context: BotContext, guildId: string, panel: FivemHierarchyPanel, reason: string, permissionReport?: ReturnType<typeof inspectPublishPermissions>) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.publish_failed",
    type: "fivem_hierarchy.publish_failed",
    message: `Falha ao publicar painel de hierarquia: ${reason}`,
    metadata: { panelId: panel.id, channelId: panel.panelChannelId, permissionReport: permissionReport ?? null, reason }
  }).catch(() => null);
}

function permissionHint(permissionReport: ReturnType<typeof inspectPublishPermissions>) {
  return permissionReport.blockingMissing.length
    ? `Permissoes faltando: ${permissionReport.blockingMissing.join(", ")}.`
    : `Permissoes calculadas no canal: ${permissionReport.granted.join(", ") || "nenhuma"}.`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function discordErrorMessage(error: unknown) {
  if (error instanceof DiscordAPIError) {
    return `${error.message} (${error.code})`;
  }
  return errorMessage(error);
}

function createHierarchyPayload(guild: Guild, panel: FivemHierarchyPanel, members: Iterable<GuildMember>, visual: PanelVisualConfig | null) {
  const fallbackVisual: PanelVisualConfig | null = panel.imageUrl ? { imageEnabled: true, imagePosition: panel.imagePosition === "bottom" ? "bottom" : panel.imagePosition, imageUrl: panel.imageUrl } : null;
  const singleVisual = sanitizeSingleHierarchyVisual(visual?.imageEnabled ? visual : fallbackVisual);
  return renderComponentsV2Panel({ accentColor: colorToInt(panel.color), actions: [], description: panel.description ?? "Hierarquia atualizada automaticamente pelos cargos do servidor.", fields: [renderHierarchyText(guild, panel, members)], footer: panel.footerEnabled ? { text: panel.footerText ?? "OrviteK" } : { enabled: false }, image: singleVisual, moduleId: "fivem-hierarchy", title: panel.title });
}

async function getPanelVisualSlots(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  const visuals = await Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));

  return visuals.flatMap((visual, index): PanelVisualConfig[] => {
    if (!visual?.imageEnabled) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ blocks: visual.blocks ?? [], imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: visual.imageUrl }];
  });
}

function renderHierarchyText(guild: Guild, panel: FivemHierarchyPanel, members: Iterable<GuildMember>) {
  const memberList = [...members];
  return panel.hierarchies
    .filter((item) => item.active)
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const roleExists = Boolean(guild.roles.cache.get(item.roleId));
      const roleMembers = roleExists ? memberList
        .filter((member: GuildMember) => member.roles.cache.has(item.roleId))
        .map((member) => member.displayName || member.user.username)
        .slice(0, item.limit ?? 50) : [];
      return `${item.emoji ?? ""} **${item.name}**\n${roleMembers.length ? roleMembers.join("\n") : "*Nenhum membro encontrado.*"}`;
    })
    .join("\n\n")
    .slice(0, 3800) || "*Nenhuma hierarquia configurada.*";
}

function sanitizeSingleHierarchyVisual(visual: PanelVisualConfig | null): PanelVisualConfig | null {
  if (!visual?.imageEnabled || !visual.imageUrl) return null;
  return {
    imageEnabled: true,
    imagePosition: visual.imagePosition === "thumbnail" ? "top" : visual.imagePosition,
    imageUrl: visual.imageUrl
  };
}

async function logMissingHierarchyRoles(context: BotContext, guild: Guild, panel: FivemHierarchyPanel) {
  const missing = panel.hierarchies
    .filter((item) => item.active && item.roleId && !guild.roles.cache.has(item.roleId))
    .map((item) => ({ name: item.name, roleId: item.roleId }));
  if (!missing.length) return;
  await context.api.postLog({
    guildId: guild.id,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.missing_roles",
    type: "fivem_hierarchy.missing_roles",
    message: `Cargos configurados na hierarquia nao existem mais no servidor: ${missing.map((item) => `${item.name} (${item.roleId})`).join(", ")}`,
    metadata: { missing, panelId: panel.id }
  }).catch(() => null);
}

function colorToInt(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}
