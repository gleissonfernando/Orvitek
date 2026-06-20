import type { Interaction, Message } from "discord.js";
import type { MaintenanceState } from "./apiClient";
import { getCachedGuildSettings } from "./guildSettingsCache";
import type { BotContext, GuildSettings } from "../types";

export const MAINTENANCE_INTERACTION_MESSAGE = "⚠️ Os bots estão em manutenção no momento. Aguarde a nossa equipe finalizar a manutenção para utilizar novamente.";

const MAINTENANCE_ALERT_MESSAGE = [
  "⚠️ MANUTENÇÃO INICIADA",
  "O sistema entrou em modo de manutenção global.",
  "Todos os serviços estão temporariamente indisponíveis.",
  "Aguarde a liberação oficial da equipe de desenvolvimento."
].join("\n");

let maintenanceState: MaintenanceState = {
  active: false,
  activatedAt: null,
  affectedBots: 0,
  deactivatedAt: null,
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
  updatedByName: null
};
let started = false;

export function isMaintenanceModeActive() {
  return maintenanceState.active;
}

export async function refreshMaintenanceState(context: BotContext) {
  const state = await context.api.getMaintenanceState().catch((error) => {
    console.warn("[maintenance] nao foi possivel carregar estado:", error instanceof Error ? error.message : error);
    return null;
  });

  if (state) {
    maintenanceState = state;
  }
}

export function startMaintenanceService(context: BotContext) {
  if (started) {
    return;
  }

  started = true;
  void refreshMaintenanceState(context);

  context.socket.onMaintenanceUpdated((payload) => {
    maintenanceState = payload.state;

    if (payload.state.active && (payload.action === "maintenance:started" || payload.action === "maintenance:manual_alert")) {
      void sendMaintenanceAlertToConfiguredChannels(context, payload.alertMessage || MAINTENANCE_ALERT_MESSAGE);
    }
  });

  const interval = setInterval(() => {
    void refreshMaintenanceState(context);
  }, 60_000);

  interval.unref();
}

export async function blockInteractionIfMaintenance(interaction: Interaction) {
  if (!maintenanceState.active) {
    return false;
  }

  if (!interaction.isRepliable()) {
    return true;
  }

  const payload = {
    content: MAINTENANCE_INTERACTION_MESSAGE,
    ephemeral: true
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => undefined);
    return true;
  }

  await interaction.reply(payload).catch(() => undefined);
  return true;
}

export async function blockMessageIfMaintenance(message: Message) {
  if (!maintenanceState.active) {
    return false;
  }

  if (message.author.bot) {
    return true;
  }

  const mentioned = message.client.user ? message.mentions.has(message.client.user) : false;
  const looksLikeCommand = message.content.trim().startsWith("/") || message.content.trim().startsWith("!");

  if (mentioned || looksLikeCommand) {
    await message.reply(MAINTENANCE_INTERACTION_MESSAGE).catch(() => undefined);
  }

  return true;
}

async function sendMaintenanceAlertToConfiguredChannels(context: BotContext, message: string) {
  const sentChannels = new Set<string>();

  for (const guild of context.client.guilds.cache.values()) {
    const settings = await getCachedGuildSettings(context, guild.id, context.client.user?.id).catch(() => null);

    if (!settings) {
      continue;
    }

    for (const channelId of maintenanceChannelIds(settings)) {
      const key = `${guild.id}:${channelId}`;

      if (sentChannels.has(key)) {
        continue;
      }

      sentChannels.add(key);
      const channel = await guild.channels.fetch(channelId).catch(() => null);

      if (channel?.isTextBased() && channel.isSendable()) {
        await channel.send({
          allowedMentions: {
            parse: []
          },
          content: message
        }).catch((error) => {
          console.warn("[maintenance] falha ao enviar alerta:", error instanceof Error ? error.message : error);
        });
      }
    }
  }
}

function maintenanceChannelIds(settings: GuildSettings) {
  return [
    settings.logChannelId,
    settings.welcomeChannelId,
    settings.welcomeDisplayChannelId,
    settings.leaveChannelId,
    settings.leaveDisplayChannelId,
    settings.accountAgeLogChannelId,
    settings.safeBotChannelId,
    settings.safeBotLogChannelId
  ].filter((channelId): channelId is string => Boolean(channelId));
}
