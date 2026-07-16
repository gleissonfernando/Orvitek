import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type TextBasedChannel
} from "discord.js";
import type { PoliceTimeClockDashboard, PoliceTimeClockSettings } from "./apiClient";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "police-time-clock";
const PREFIX = "police_time_clock";
const ACCENT = 0x2563eb;

export const barraCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("barra")
    .setDescription("Gerencia o Relógio de Ponto da Polícia.")
    .addSubcommand((subcommand) => subcommand.setName("painel").setDescription("Publica ou atualiza o painel do Relógio de Ponto."))
    .addSubcommand((subcommand) => subcommand
      .setName("fechar-ponto")
      .setDescription("Fecha o ponto de um usuário.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário que terá o ponto fechado.").setRequired(true))
      .addStringOption((option) => option.setName("motivo").setDescription("Motivo do fechamento forçado.").setRequired(false).setMaxLength(300))),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() === "fechar-ponto") {
      await forceClosePoint(interaction, context);
      return;
    }
    await publishPanel(interaction, context);
  }
};

export const relogioDePontoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("relogio-de-ponto")
    .setDescription("Mostra relatório do Relógio de Ponto.")
    .addUserOption((option) => option.setName("usuario").setDescription("Filtrar um usuário.").setRequired(false)),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }
    const dashboard = await context.api.getPoliceTimeClockDashboard(interaction.guild.id);
    const user = interaction.options.getUser("usuario");
    const history = user ? dashboard.history.filter((item) => item.userId === user.id) : dashboard.history;
    const totalMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);
    const ranking = [...dashboard.history]
      .reduce((map, item) => map.set(item.userId, { name: item.username, total: (map.get(item.userId)?.total ?? 0) + (item.durationMs ?? 0) }), new Map<string, { name: string; total: number }>())
      .entries();
    const rows = [...ranking].sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([, item], index) => `${index + 1}. ${item.name} — ${formatDuration(item.total)}`);
    await interaction.reply({
      components: [{
        type: 17,
        accent_color: ACCENT,
        components: [{
          type: 10,
          content: user
            ? `## Relatório de Ponto\nUsuário: ${user}\nRegistros: **${history.length}**\nTotal: **${formatDuration(totalMs)}**\nÚltima entrada: ${history[0]?.startedAt ? `<t:${unix(history[0].startedAt)}:F>` : "-"}\nÚltima saída: ${history[0]?.endedAt ? `<t:${unix(history[0].endedAt)}:F>` : "-"}`
            : `## Relatório de Ponto\nFuncionários em serviço: **${dashboard.active.length}**\nRegistros recentes: **${dashboard.history.length}**\nTempo total registrado: **${formatDuration(totalMs)}**\n\n${rows.length ? rows.join("\n") : "Sem histórico registrado."}`
        }]
      }],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
    });
  }
};

export async function handlePoliceTimeClockInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este painel dentro de um servidor.", ephemeral: true });
    return true;
  }
  const action = interaction.customId.split(":")[1] ?? "";
  if (action === "enter") return enterService(interaction, context);
  if (action === "exit") return exitService(interaction, context);
  if (action === "mine") return myTime(interaction, context);
  if (action === "history") return history(interaction, context);
  if (action === "refresh") return refreshPanel(interaction, context);
  return false;
}

async function publishPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channel?.isTextBased()) {
    await interaction.reply({ content: "Use este comando em um canal de texto.", ephemeral: true });
    return;
  }
  const dashboard = await context.api.getPoliceTimeClockDashboard(interaction.guild.id);
  if (!dashboard.settings.enabled) {
    await interaction.reply({ content: "O Sistema de Relógio de Ponto está desativado na dashboard.", ephemeral: true });
    return;
  }
  if (!canManage(interaction.member as GuildMember, dashboard.settings)) {
    await interaction.reply({ content: "Você não possui permissão para publicar este painel.", ephemeral: true });
    return;
  }
  const target = await resolvePanelChannel(interaction.channel, dashboard.settings);
  const message = await (target as TextBasedChannel & { send: (payload: unknown) => Promise<{ id: string }> }).send(panelPayload(dashboard));
  await context.api.savePoliceTimeClockSettings(interaction.guild.id, { panelChannelId: target.id, panelMessageId: message.id }, interaction.user.id).catch(() => undefined);
  await interaction.reply({ content: `Painel publicado em ${target}.`, ephemeral: true });
}

async function forceClosePoint(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }
  const settings = await context.api.getPoliceTimeClockSettings(interaction.guild.id);
  if (!canForceClose(interaction.member as GuildMember, settings)) {
    await interaction.reply({ content: "Você não possui permissão para fechar pontos.", ephemeral: true });
    return;
  }
  const target = interaction.options.getUser("usuario", true);
  const session = await context.api.closePoliceTimeClockSession(interaction.guild.id, {
    closedBy: interaction.user.id,
    forced: true,
    reason: interaction.options.getString("motivo") ?? "Fechamento forçado",
    userId: target.id
  });
  await interaction.reply({ content: `Ponto de ${target} fechado. Tempo total: ${formatDuration(session.durationMs ?? 0)}.`, ephemeral: true });
}

async function enterService(interaction: ButtonInteraction, context: BotContext) {
  const member = interaction.member as GuildMember;
  const session = await context.api.openPoliceTimeClockSession(interaction.guildId!, {
    createdBy: interaction.user.id,
    origin: "manual",
    roleNames: member.roles.cache.map((role) => role.name),
    userId: interaction.user.id,
    username: member.displayName
  });
  await interaction.reply({ content: `Entrada registrada às <t:${unix(session.startedAt)}:t>.`, ephemeral: true });
}

async function exitService(interaction: ButtonInteraction, context: BotContext) {
  const session = await context.api.closePoliceTimeClockSession(interaction.guildId!, { closedBy: interaction.user.id, userId: interaction.user.id });
  await interaction.reply({ content: `Saída registrada. Tempo total: ${formatDuration(session.durationMs ?? 0)}.`, ephemeral: true });
}

async function myTime(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await context.api.getPoliceTimeClockDashboard(interaction.guildId!);
  const active = dashboard.active.find((item) => item.userId === interaction.user.id);
  const history = dashboard.history.filter((item) => item.userId === interaction.user.id);
  const totalMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  await interaction.reply({ content: active ? `Você está em serviço desde <t:${unix(active.startedAt)}:t>. Histórico recente: ${formatDuration(totalMs)}.` : `Você não está em serviço. Histórico recente: ${formatDuration(totalMs)}.`, ephemeral: true });
}

async function history(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await context.api.getPoliceTimeClockDashboard(interaction.guildId!);
  const rows = dashboard.history.slice(0, 10).map((item) => `${item.username}: ${formatDuration(item.durationMs ?? 0)} — <t:${unix(item.startedAt)}:d>`);
  await interaction.reply({ content: rows.length ? rows.join("\n") : "Sem histórico registrado.", ephemeral: true });
}

async function refreshPanel(interaction: ButtonInteraction, context: BotContext) {
  const dashboard = await context.api.getPoliceTimeClockDashboard(interaction.guildId!);
  await interaction.update(panelPayload(dashboard, false));
}

function panelPayload(dashboard: PoliceTimeClockDashboard, includeFlags = true) {
  const activeRows = dashboard.active.slice(0, 20).map((item) => `• <@${item.userId}> — Em serviço há **${formatDuration(Date.now() - Date.parse(item.startedAt))}** — entrada <t:${unix(item.startedAt)}:t>`);
  const payload = {
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [
        { type: 10, content: `## Relógio de Ponto\nFuncionários em serviço: **${dashboard.active.length}**\nTempo médio: **${formatDuration(dashboard.summary.averageDurationMs)}**\nÚltima atualização: <t:${Math.floor(Date.now() / 1000)}:R>\n\n${activeRows.length ? activeRows.join("\n") : "Nenhum funcionário em serviço."}` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:enter`).setLabel("Entrar em Serviço").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:exit`).setLabel("Sair de Serviço").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:mine`).setLabel("Meu Horário").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:refresh`).setLabel("Atualizar Painel").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:history`).setLabel("Histórico").setStyle(ButtonStyle.Secondary)
        )
      ]
    }]
  };
  return includeFlags ? { ...payload, flags: MessageFlags.IsComponentsV2 as const } : payload;
}

async function resolvePanelChannel(current: TextBasedChannel, settings: PoliceTimeClockSettings) {
  if (!settings.panelChannelId || !("guild" in current)) return current;
  const channel = await current.guild.channels.fetch(settings.panelChannelId).catch(() => null);
  return channel?.isTextBased() ? channel : current;
}

function canManage(member: GuildMember, settings: PoliceTimeClockSettings) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [settings.adminRoleId, settings.managerRoleId]);
}
function canForceClose(member: GuildMember, settings: PoliceTimeClockSettings) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || hasAny(member, [settings.adminRoleId, settings.closeRoleId, settings.managerRoleId]);
}
function hasAny(member: GuildMember, roleIds: Array<string | null>) { return roleIds.some((id) => id && member.roles.cache.has(id)); }
function unix(value: string) { return Math.floor(Date.parse(value) / 1000); }
function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}
