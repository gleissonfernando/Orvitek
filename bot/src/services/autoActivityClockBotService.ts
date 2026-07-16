import {
  ActivityType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Presence
} from "discord.js";
import type { AutoActivityClockDashboard } from "./apiClient";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "auto-activity-clock";
const ACCENT = 0xf59e0b;
const activeCache = new Map<string, string>();

export const pontosAutomaticosCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos-automaticos")
    .setDescription("Mostra o painel do Ponto Automático por atividade.")
    .addUserOption((option) => option.setName("usuario").setDescription("Filtrar um usuário.").setRequired(false)),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await showAutoActivityReport(interaction, context);
  }
};

export async function handleAutoActivityPresenceUpdate(context: BotContext, oldPresence: Presence | null, newPresence: Presence) {
  const guild = newPresence.guild ?? oldPresence?.guild ?? null;
  if (!guild) return;
  const userId = newPresence.userId;
  const key = `${guild.id}:${userId}`;
  const activityName = bestActivityName(newPresence);

  if (!activityName) {
    if (activeCache.has(key)) {
      activeCache.delete(key);
      await context.api.closeAutoActivityClockSession(guild.id, { statusDiscord: null, userId }).catch(() => undefined);
    }
    return;
  }

  const city = await context.api.matchAutoActivityClockCity(guild.id, activityName).catch(() => null);

  if (!city) {
    if (activeCache.has(key)) {
      activeCache.delete(key);
      await context.api.closeAutoActivityClockSession(guild.id, { statusDiscord: activityName, userId }).catch(() => undefined);
    }
    return;
  }

  if (activeCache.get(key) === city.id) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  await context.api.openAutoActivityClockSession(guild.id, {
    cityId: city.id,
    cityName: city.name,
    statusDiscord: activityName,
    userId,
    username: member?.displayName ?? newPresence.user?.tag ?? userId
  }).then(() => {
    activeCache.set(key, city.id);
  }).catch(() => undefined);
}

async function showAutoActivityReport(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
  const dashboard = await context.api.getAutoActivityClockDashboard(interaction.guild.id);
  const user = interaction.options.getUser("usuario");
  const history = user ? dashboard.history.filter((item) => item.userId === user.id) : dashboard.history;
  const totalMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);

  await interaction.reply({
    ...autoPanelPayload(dashboard, user ? `Usuário: ${user}\nRegistros: **${history.length}**\nTotal: **${formatDuration(totalMs)}**` : null),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
}

function autoPanelPayload(dashboard: AutoActivityClockDashboard, extra: string | null) {
  const active = dashboard.active.slice(0, 20).map((item) => `• <@${item.userId}> — **${item.cityName}** — ${formatDuration(Date.now() - Date.parse(item.startedAt))}`);
  const cities = dashboard.cities.filter((city) => city.enabled).slice(0, 12).map((city) => `• ${city.name}`);
  return {
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: [{
        type: 10,
        content: `## Sistema de Ponto Automático\nStatus: **${dashboard.settings.enabled ? "Ativo" : "Desativado"}**\nUsuários ativos: **${dashboard.active.length}**\nCidades cadastradas: **${dashboard.cities.length}**\nTempo médio: **${formatDuration(dashboard.summary.averageDurationMs)}**${extra ? `\n\n${extra}` : ""}\n\n### Ativos\n${active.length ? active.join("\n") : "Nenhum usuário ativo."}\n\n### Cidades\n${cities.length ? cities.join("\n") : "Nenhuma cidade cadastrada."}`
      }]
    }]
  };
}

function bestActivityName(presence: Presence) {
  const activity = presence.activities.find((item) => item.type === ActivityType.Playing || item.type === ActivityType.Custom || item.type === ActivityType.Streaming || item.name);
  return activity?.name?.trim() || activity?.state?.trim() || null;
}

function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}
