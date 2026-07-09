import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { FivemHierarchyPanel } from "./apiClient";
import { renderComponentsV2Panel, type PanelVisualConfig } from "./panelVisualRenderer";

const PREFIX = "fivem_hierarchy";
const scheduledGuilds = new Map<string, NodeJS.Timeout>();

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
  context.socket.onFivemHierarchyPanelUpdate((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void refreshHierarchyPanelsForGuild(guild, context, payload.panelId);
  });

  for (const guild of client.guilds.cache.values()) {
    scheduleHierarchyRefresh(guild, context);
  }
}

export async function handleFivemHierarchyInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) return true;
  if (interaction.customId.startsWith(`${PREFIX}:refresh:`)) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Somente a administracao pode atualizar este painel manualmente.", ephemeral: true });
      return true;
    }
    const panelId = interaction.customId.split(":")[2] ?? null;
    await interaction.deferReply({ ephemeral: true });
    await refreshHierarchyPanelsForGuild(interaction.guild, context, panelId);
    await interaction.editReply("Painel de hierarquia atualizado.");
    return true;
  }
  return false;
}

export function scheduleHierarchyRefresh(guild: Guild, context: BotContext) {
  if (!isBotModuleEnabled("fivem-hierarchy")) return;
  const current = scheduledGuilds.get(guild.id);
  if (current) clearTimeout(current);
  const timeout = setTimeout(() => {
    scheduledGuilds.delete(guild.id);
    void refreshHierarchyPanelsForGuild(guild, context);
  }, 2500);
  timeout.unref();
  scheduledGuilds.set(guild.id, timeout);
}

export async function refreshHierarchyPanelsForGuild(guild: Guild, context: BotContext, panelId?: string | null) {
  const panels = await context.api.getActiveFivemHierarchyPanels().catch(() => []);
  const scoped = panels.filter((panel) => panel.guildId === guild.id && (!panelId || panel.id === panelId));
  if (!scoped.length) return;
  await guild.members.fetch().catch(() => null);
  for (const panel of scoped) {
    await publishHierarchyPanel(guild, context, panel);
  }
}

async function publishHierarchyPanel(guild: Guild, context: BotContext, panel: FivemHierarchyPanel) {
  if (!panel.enabled || !panel.panelChannelId) return;
  const channel = await guild.channels.fetch(panel.panelChannelId).catch(() => null);
  if (!channel || !("send" in channel) || !("messages" in channel)) {
    await logPublishFailure(context, guild.id, panel, "Canal do painel nao encontrado ou nao e um canal de texto.");
    return;
  }
  const permissionError = validatePublishPermissions(guild, channel as { id: string; permissionsFor(member: GuildMember): { has(permission: bigint): boolean } | null });
  if (permissionError) {
    await logPublishFailure(context, guild.id, panel, permissionError);
    return;
  }
  const visuals = await getPanelVisualSlots(context, guild.id, "fivem-hierarchy");
  const payload = createHierarchyPayload(guild, panel, visuals[0] ?? null, visuals.slice(1));
  let message = panel.panelMessageId ? await channel.messages.fetch(panel.panelMessageId).catch(() => null) : null;
  if (message) {
    await message.edit(payload).catch(async () => {
      message = await channel.send(payload).catch((error) => {
        void logPublishFailure(context, guild.id, panel, `Falha ao reenviar painel: ${errorMessage(error)}`);
        return null;
      });
    });
  } else {
    message = await channel.send(payload).catch((error) => {
      void logPublishFailure(context, guild.id, panel, `Falha ao enviar painel: ${errorMessage(error)}`);
      return null;
    });
  }
  if (message) {
    await context.api.updateFivemHierarchyPanelState({ guildId: guild.id, messageId: message.id, panelId: panel.id }).catch(() => null);
  }
}

function validatePublishPermissions(guild: Guild, channel: { id: string; permissionsFor(member: GuildMember): { has(permission: bigint): boolean } | null }) {
  const me = guild.members.me;
  if (!me || !channel || !("permissionsFor" in channel)) {
    return "Nao consegui validar meu membro ou minhas permissoes nesse canal.";
  }
  const permissions = channel.permissionsFor(me);
  const missing = [
    [PermissionFlagsBits.ViewChannel, "Ver Canal"],
    [PermissionFlagsBits.SendMessages, "Enviar Mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir Links"],
    [PermissionFlagsBits.ReadMessageHistory, "Ler Historico"]
  ].filter(([permission]) => !permissions?.has(permission as bigint)).map(([, label]) => label);
  return missing.length ? `Permissoes ausentes no canal <#${channel.id}>: ${missing.join(", ")}.` : null;
}

async function logPublishFailure(context: BotContext, guildId: string, panel: FivemHierarchyPanel, reason: string) {
  await context.api.postLog({
    guildId,
    channelId: panel.panelChannelId,
    module: "fivem-hierarchy",
    action: "panel.publish_failed",
    type: "fivem_hierarchy.publish_failed",
    message: `Falha ao publicar painel de hierarquia: ${reason}`,
    metadata: { panelId: panel.id, channelId: panel.panelChannelId, reason }
  }).catch(() => null);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createHierarchyPayload(guild: Guild, panel: FivemHierarchyPanel, visual: PanelVisualConfig | null, extraImages: PanelVisualConfig[] = []) {
  const fallbackVisual: PanelVisualConfig | null = panel.imageUrl ? { imageEnabled: true, imagePosition: panel.imagePosition === "bottom" ? "bottom" : panel.imagePosition, imageUrl: panel.imageUrl } : null;
  const action = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:refresh:${panel.id}`).setLabel("Atualizar painel").setStyle(ButtonStyle.Secondary)
      );
  return renderComponentsV2Panel({ accentColor: colorToInt(panel.color), actions: [action], description: panel.description ?? "Hierarquia atualizada automaticamente pelos cargos do servidor.", extraImages, fields: [renderHierarchyText(guild, panel), ...(panel.footerEnabled && panel.footerText ? [`_${panel.footerText}_`] : [])], image: visual?.imageEnabled ? visual : fallbackVisual, moduleId: "fivem-hierarchy", title: panel.title });
}

async function getPanelVisualSlots(context: BotContext, guildId: string, basePanelId: string) {
  const panelIds = [basePanelId, `${basePanelId}-banner-2`, `${basePanelId}-banner-3`];
  const visuals = await Promise.all(panelIds.map((panelId) => context.api.getPanelVisualSettings(guildId, panelId).catch(() => null)));

  return visuals.flatMap((visual, index): PanelVisualConfig[] => {
    if (!visual?.imageEnabled) return [];
    if (index > 0 && visual.useGlobalDefault) return [];
    return [{ imageEnabled: visual.imageEnabled, imagePosition: visual.imagePosition, imageUrl: visual.imageUrl }];
  });
}

function renderHierarchyText(guild: Guild, panel: FivemHierarchyPanel) {
  return panel.hierarchies
    .filter((item) => item.active)
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const members = guild.members.cache
        .filter((member: GuildMember) => member.roles.cache.has(item.roleId))
        .map((member) => `<@${member.id}>`)
        .slice(0, item.limit ?? 50);
      return `${item.emoji ?? ""} **${item.name}**\n${members.length ? members.join("\n") : "*Nenhum membro encontrado.*"}`;
    })
    .join("\n\n")
    .slice(0, 3800) || "*Nenhuma hierarquia configurada.*";
}

function colorToInt(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}
