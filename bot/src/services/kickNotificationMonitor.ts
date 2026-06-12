import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type Message,
  type MessageMentionOptions
} from "discord.js";
import { env } from "../config/env";
import type { ApiClient, KickNotification } from "./apiClient";
import { getKickLivestreamsByUserIds, type KickStream } from "./kickApiService";

let running = false;
const NOTIFICATION_CONCURRENCY = 25;
const LIVE_PREVIEW_REFRESH_DELAY_MS = 30_000;
const DEFAULT_EMBED_COLOR = "#53FC18";

export function startKickNotificationMonitor(client: Client, api: ApiClient) {
  const run = () => {
    void monitorKickNotifications(client, api).catch((error) => {
      console.warn("[kick-integration] monitor falhou:", error instanceof Error ? error.message : error);
    });
  };

  run();
  const interval = setInterval(run, env.KICK_MONITOR_INTERVAL_MS);
  interval.unref();
}

async function monitorKickNotifications(client: Client, api: ApiClient) {
  if (running) {
    return;
  }

  running = true;

  try {
    const notifications = await api.getActiveKickNotifications();
    const eligibleNotifications = notifications.filter((notification) => client.guilds.cache.has(notification.guildId));
    const streamsByUserId = await getKickLivestreamsByUserIds(
      eligibleNotifications
        .map((notification) => notification.kickUserId ?? "")
        .filter(Boolean)
    );

    await mapWithConcurrency(eligibleNotifications, NOTIFICATION_CONCURRENCY, async (notification) => {
      try {
        await processNotification(
          client,
          api,
          notification,
          notification.kickUserId ? streamsByUserId.get(notification.kickUserId) ?? null : null
        );
      } catch (error) {
        console.warn(
          `[kick-integration] notificacao ${notification.id} ignorada:`,
          error instanceof Error ? error.message : error
        );
      }
    });
  } finally {
    running = false;
  }
}

async function processNotification(
  client: Client,
  api: ApiClient,
  notification: KickNotification,
  stream: KickStream | null
) {
  if (!stream) {
    if (notification.isLive) {
      await sendLiveEndedAlert(client, notification).catch((error) => {
        console.warn("[kick-integration] nao foi possivel enviar encerramento:", error instanceof Error ? error.message : error);
      });
      await api.updateKickNotificationState(notification.id, {
        isLive: false,
        lastEndedAt: new Date().toISOString()
      });
      await api.notifyLive({
        guildId: notification.guildId,
        type: "ended",
        streamer: notification.kickDisplayName || notification.kickChannelName,
        url: notification.kickChannelUrl
      });
    }

    return;
  }

  const peakViewers = Math.max(notification.peakViewers ?? 0, stream.viewerCount || 0);

  if (notification.lastStreamId === stream.id) {
    await api.updateKickNotificationState(notification.id, {
      isLive: true,
      kickAvatar: stream.avatar ?? notification.kickAvatar ?? null,
      kickCategory: stream.categoryName,
      peakViewers
    });
    return;
  }

  const messageId = await sendLiveAlert(client, notification, stream);

  await api.updateKickNotificationState(notification.id, {
    isLive: true,
    kickAvatar: stream.avatar ?? notification.kickAvatar ?? null,
    kickCategory: stream.categoryName,
    lastLiveAt: stream.startedAt,
    lastStreamId: stream.id,
    lastMessageId: messageId,
    peakViewers
  });
  await api.notifyLive({
    guildId: notification.guildId,
    type: "started",
    streamer: stream.displayName || notification.kickDisplayName || notification.kickChannelName,
    title: stream.title,
    url: stream.url
  });
}

async function sendLiveAlert(client: Client, notification: KickNotification, stream: KickStream) {
  const channel = await client.channels.fetch(notification.discordChannelId).catch(() => null);

  if (
    !channel?.isTextBased()
    || !("send" in channel)
    || !("guildId" in channel)
    || channel.guildId !== notification.guildId
  ) {
    throw new Error(`Canal Discord ${notification.discordChannelId} nao encontrado.`);
  }

  const variables = kickVariables(notification, stream);
  const embed = new EmbedBuilder()
    .setColor(normalizeEmbedColor(notification.embedColor))
    .setAuthor({
      name: `${variables.streamer} iniciou uma transmissao na Kick`,
      iconURL: stream.avatar ?? notification.kickAvatar ?? undefined,
      url: stream.url
    })
    .setTitle("AO VIVO AGORA")
    .setURL(stream.url)
    .setDescription(renderKickDescription(notification, variables))
    .addFields(
      {
        name: "Streamer",
        value: variables.streamer,
        inline: true
      },
      {
        name: "Categoria",
        value: variables.category,
        inline: true
      },
      {
        name: "Viewers",
        value: variables.viewers,
        inline: true
      },
      {
        name: "Titulo",
        value: variables.title,
        inline: false
      }
    )
    .setFooter({
      text: "Sistema Kick Integration"
    });

  if (stream.thumbnailUrl) {
    embed.setImage(appendCacheBuster(stream.thumbnailUrl));
  }

  const mention = formatMention(notification);
  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Assistir Agora")
        .setStyle(ButtonStyle.Link)
        .setURL(stream.url)
    )
  ];
  const message = await channel.send({
    allowedMentions: mention.allowedMentions,
    content: mention.content ?? undefined,
    components,
    embeds: [embed]
  });

  if (stream.thumbnailUrl) {
    scheduleLivePreviewRefresh(message, embed, stream.thumbnailUrl);
  }

  return message.id;
}

async function sendLiveEndedAlert(client: Client, notification: KickNotification) {
  const channel = await client.channels.fetch(notification.discordChannelId).catch(() => null);

  if (
    !channel?.isTextBased()
    || !("send" in channel)
    || !("guildId" in channel)
    || channel.guildId !== notification.guildId
  ) {
    throw new Error(`Canal Discord ${notification.discordChannelId} nao encontrado.`);
  }

  const startedAt = notification.lastLiveAt ? new Date(notification.lastLiveAt) : null;
  const endedAt = new Date();
  const duration = startedAt ? formatDuration(Math.max(0, endedAt.getTime() - startedAt.getTime())) : "Nao registrado";
  const embed = new EmbedBuilder()
    .setColor(normalizeEmbedColor(notification.embedColor))
    .setTitle("Live Encerrada")
    .setURL(notification.kickChannelUrl)
    .setDescription(`${notification.kickDisplayName ?? notification.kickChannelName} encerrou a transmissao na Kick.`)
    .addFields(
      {
        name: "Duracao",
        value: duration,
        inline: true
      },
      {
        name: "Pico de viewers",
        value: String(notification.peakViewers ?? 0),
        inline: true
      },
      {
        name: "Categoria",
        value: notification.kickCategory || "Sem categoria",
        inline: true
      }
    )
    .setFooter({
      text: "Sistema Kick Integration"
    });

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds: [embed]
  });
}

function kickVariables(notification: KickNotification, stream: KickStream) {
  return {
    streamer: stream.displayName || notification.kickDisplayName || notification.kickChannelName,
    title: stream.title || "Live ao vivo",
    category: stream.categoryName || notification.kickCategory || "Sem categoria",
    viewers: String(stream.viewerCount || 0),
    url: stream.url,
    followers: String(notification.kickFollowers ?? 0),
    live_started: formatDateTime(new Date(stream.startedAt))
  };
}

function renderKickDescription(notification: KickNotification, variables: ReturnType<typeof kickVariables>) {
  const customMessage = notification.customMessage?.trim();

  if (customMessage) {
    return replaceVariables(customMessage, variables);
  }

  return `${variables.streamer} iniciou uma transmissao ao vivo.\nEntre agora para acompanhar.`;
}

function replaceVariables(template: string, variables: ReturnType<typeof kickVariables>) {
  return template.replace(/\{(streamer|title|category|viewers|url|followers|live_started)\}/g, (_, key: keyof typeof variables) => {
    return variables[key] ?? "";
  });
}

function scheduleLivePreviewRefresh(message: Message, embed: EmbedBuilder, thumbnailUrl: string) {
  const timer = setTimeout(() => {
    const refreshedEmbed = EmbedBuilder.from(embed)
      .setImage(appendCacheBuster(thumbnailUrl));

    void message.edit({
      embeds: [refreshedEmbed]
    }).catch((error) => {
      console.warn("[kick-integration] nao foi possivel atualizar a preview da live:", error instanceof Error ? error.message : error);
    });
  }, LIVE_PREVIEW_REFRESH_DELAY_MS);

  timer.unref();
}

function formatMention(notification: KickNotification): { content: string | null; allowedMentions: MessageMentionOptions } {
  if (!notification.mentionRoleId) {
    return {
      content: null,
      allowedMentions: {
        parse: []
      }
    };
  }

  if (notification.mentionRoleId === "everyone" || notification.mentionRoleId === notification.guildId) {
    return {
      content: "@everyone",
      allowedMentions: {
        parse: ["everyone"] as const
      }
    };
  }

  return {
    content: `<@&${notification.mentionRoleId}>`,
    allowedMentions: {
      parse: [],
      roles: [notification.mentionRoleId]
    }
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;

      if (item !== undefined) {
        await handler(item);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker()
    )
  );
}

function normalizeEmbedColor(value?: string | null) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as `#${string}`) : DEFAULT_EMBED_COLOR;
}

function appendCacheBuster(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(value);
}

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${minutes} min`;
  }

  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}
