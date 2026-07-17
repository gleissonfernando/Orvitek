import { AuditLogEvent, type Message, type PartialMessage } from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotContext } from "../types";

export type DeletedMessageAttachment = {
  contentType: string | null;
  height: number | null;
  id: string;
  name: string;
  size: number;
  spoiler: boolean;
  url: string;
  width: number | null;
};

export type DeletedMessageEmbed = {
  description: string | null;
  imageUrl: string | null;
  providerName: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  type: string | null;
  url: string | null;
};

export type DeletedMessageSticker = {
  format: number | null;
  id: string;
  name: string;
  url: string | null;
};

export type DeletedMessageSnapshot = {
  attachments: DeletedMessageAttachment[];
  authorAvatarUrl: string | null;
  authorBot: boolean;
  authorDisplayName: string | null;
  authorId: string | null;
  authorTag: string | null;
  authorUsername: string | null;
  channelId: string;
  channelName: string | null;
  content: string;
  createdAt: string | null;
  deletedAt: string | null;
  editedAt: string | null;
  embeds: DeletedMessageEmbed[];
  guildId: string;
  guildName: string | null;
  links: string[];
  mentionChannelIds: string[];
  mentionRoleIds: string[];
  mentionUserIds: string[];
  mentionsEveryone: boolean;
  messageId: string;
  referenceMessageId: string | null;
  stickers: DeletedMessageSticker[];
};

export type RegisterDeletedMessageInput = {
  action?: string | null;
  deletionType?: "AUTOMATIC" | "MODERATOR" | "AUTHOR" | "UNKNOWN";
  executorId?: string | null;
  module?: string | null;
  reason?: string | null;
  ruleId?: string | null;
  snapshot?: DeletedMessageSnapshot | null;
  message?: Message | PartialMessage | null;
};

const SNAPSHOT_TTL_MS = 72 * 60 * 60 * 1_000;
const LOG_IDEMPOTENCY_TTL_MS = 5 * 60 * 1_000;
const MAX_SNAPSHOTS = 20_000;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()\]]+/gi;

const snapshots = new Map<string, { expiresAt: number; snapshot: DeletedMessageSnapshot }>();
const deletionLogStates = new Map<string, { expiresAt: number; status: "reserved" | "logged" }>();

export async function rememberDeletedMessageSnapshot(message: Message) {
  if (!message.guild) return null;
  const snapshot = await createDeletedMessageSnapshot(message);
  if (!snapshot) return null;
  rememberSnapshot(snapshot);
  return snapshot;
}

export async function createDeletedMessageSnapshot(message: Message | PartialMessage) {
  if (!message.guild || !message.channelId || !message.id) {
    return null;
  }

  const cached = getCachedSnapshot(message.guild.id, message.id);
  const current = await snapshotFromMessage(message).catch(() => null);
  const merged = mergeSnapshots(cached, current);

  if (merged) {
    rememberSnapshot(merged);
  }

  return merged;
}

export async function reserveDeletedMessageLog(message: Message | PartialMessage) {
  const snapshot = await createDeletedMessageSnapshot(message);
  reserveDeletionLog(snapshot);
  return snapshot;
}

export async function deleteMessageWithAudit(
  context: BotContext,
  message: Message,
  input: Omit<RegisterDeletedMessageInput, "message" | "snapshot"> = {}
) {
  const snapshot = await createDeletedMessageSnapshot(message);

  if (snapshot) {
    reserveDeletionLog(snapshot);
  }

  try {
    await message.delete();
  } catch (error) {
    if (snapshot) releaseDeletionLogReservation(snapshot);
    throw error;
  }

  if (snapshot) {
    await registerDeletedMessageLog(context, {
      ...input,
      deletionType: input.deletionType ?? "AUTOMATIC",
      snapshot
    });
  }
}

export async function registerDeletedMessageLog(context: BotContext, input: RegisterDeletedMessageInput) {
  const snapshot = input.snapshot ?? (input.message ? await createDeletedMessageSnapshot(input.message) : null);

  if (!snapshot) {
    return;
  }

  snapshot.deletedAt = snapshot.deletedAt ?? new Date().toISOString();

  if (!claimDeletionLog(snapshot, Boolean(input.snapshot))) {
    return;
  }

  const auditExecutor = input.executorId
    ? { executorId: input.executorId, executorTag: null as string | null }
    : await resolveDeletionExecutor(context, snapshot).catch(() => null);
  const executorId = input.executorId ?? auditExecutor?.executorId ?? null;
  const deletionType = input.deletionType ?? inferDeletionType(snapshot, executorId, context.client.user?.id ?? null);
  const channelLabel = snapshot.channelName ? `#${snapshot.channelName}` : `<#${snapshot.channelId}>`;
  const authorLabel = snapshot.authorTag ?? snapshot.authorUsername ?? snapshot.authorId ?? "autor desconhecido";
  const contentState = snapshot.content.trim()
    ? "conteúdo preservado"
    : "conteúdo indisponível no cache";

  await context.api.postLog({
    action: "delete",
    botId: currentRuntimeBotId(),
    channelId: snapshot.channelId,
    executorId,
    guildId: snapshot.guildId,
    module: input.module ?? "Logs de mensagens apagadas",
    status: "info",
    type: "message.delete",
    userId: snapshot.authorId,
    message: `Mensagem de ${authorLabel} apagada em ${channelLabel}; ${contentState}.`,
    metadata: {
      ...snapshot,
      action: input.action ?? "DELETE",
      deletionType,
      executorId,
      executorTag: auditExecutor?.executorTag ?? null,
      module: input.module ?? "Logs de mensagens apagadas",
      reason: input.reason ?? null,
      ruleId: input.ruleId ?? null,
      unavailableReason: snapshot.content.trim() ? null : "A mensagem não estava no cache do Discord nem no cache temporário do bot."
    }
  }).catch((error) => {
    console.warn("[deleted-message-log] não foi possível registrar log:", errorMessage(error));
  });
}

export async function registerBulkDeletedMessageLogs(
  context: BotContext,
  messages: Iterable<Message | PartialMessage>,
  input: Omit<RegisterDeletedMessageInput, "message" | "snapshot"> = {}
) {
  const tasks: Array<Promise<unknown>> = [];

  for (const message of messages) {
    tasks.push(registerDeletedMessageLog(context, {
      ...input,
      deletionType: input.deletionType ?? "MODERATOR",
      message,
      module: input.module ?? "Logs de mensagens apagadas",
      reason: input.reason ?? "Exclusão em massa"
    }));
  }

  await Promise.allSettled(tasks);
}

function rememberSnapshot(snapshot: DeletedMessageSnapshot) {
  cleanupExpired();
  snapshots.set(snapshotKey(snapshot.guildId, snapshot.messageId), {
    expiresAt: Date.now() + SNAPSHOT_TTL_MS,
    snapshot
  });

  if (snapshots.size > MAX_SNAPSHOTS) {
    const removeCount = snapshots.size - MAX_SNAPSHOTS;
    for (const key of snapshots.keys()) {
      snapshots.delete(key);
      if (snapshots.size <= MAX_SNAPSHOTS - removeCount) break;
    }
  }
}

async function snapshotFromMessage(message: Message | PartialMessage): Promise<DeletedMessageSnapshot | null> {
  if (!message.guild || !message.channelId) return null;
  const author = message.author ?? null;
  const member = author?.id
    ? message.guild.members.cache.get(author.id) ?? await message.guild.members.fetch(author.id).catch(() => null)
    : null;
  const content = message.content ?? "";
  const channelName = "name" in message.channel && typeof message.channel.name === "string"
    ? message.channel.name
    : null;

  return {
    attachments: message.attachments.map((attachment) => ({
      contentType: attachment.contentType ?? null,
      height: attachment.height ?? null,
      id: attachment.id,
      name: attachment.name ?? `arquivo-${attachment.id}`,
      size: attachment.size,
      spoiler: Boolean(attachment.spoiler),
      url: attachment.url,
      width: attachment.width ?? null
    })),
    authorAvatarUrl: author?.displayAvatarURL({ size: 128 }) ?? null,
    authorBot: Boolean(author?.bot),
    authorDisplayName: member?.displayName ?? author?.globalName ?? author?.username ?? null,
    authorId: author?.id ?? null,
    authorTag: author?.tag ?? null,
    authorUsername: author?.username ?? null,
    channelId: message.channelId,
    channelName,
    content,
    createdAt: message.createdAt instanceof Date && !Number.isNaN(message.createdAt.getTime())
      ? message.createdAt.toISOString()
      : null,
    deletedAt: null,
    editedAt: "editedAt" in message && message.editedAt instanceof Date ? message.editedAt.toISOString() : null,
    embeds: message.embeds.map((embed) => ({
      description: embed.description ?? null,
      imageUrl: embed.image?.url ?? null,
      providerName: embed.provider?.name ?? null,
      thumbnailUrl: embed.thumbnail?.url ?? null,
      title: embed.title ?? null,
      type: null,
      url: embed.url ?? null
    })),
    guildId: message.guild.id,
    guildName: message.guild.name,
    links: extractLinks(content),
    mentionChannelIds: message.mentions.channels.map((channel) => channel.id),
    mentionRoleIds: message.mentions.roles.map((role) => role.id),
    mentionUserIds: message.mentions.users.map((user) => user.id),
    mentionsEveryone: message.mentions.everyone,
    messageId: message.id,
    referenceMessageId: message.reference?.messageId ?? null,
    stickers: message.stickers.map((sticker) => ({
      format: typeof sticker.format === "number" ? sticker.format : null,
      id: sticker.id,
      name: sticker.name,
      url: typeof sticker.url === "string" ? sticker.url : null
    }))
  };
}

function mergeSnapshots(
  cached: DeletedMessageSnapshot | null,
  current: DeletedMessageSnapshot | null
): DeletedMessageSnapshot | null {
  if (!cached) return current;
  if (!current) return cached;

  return {
    ...cached,
    ...current,
    attachments: current.attachments.length ? current.attachments : cached.attachments,
    authorAvatarUrl: current.authorAvatarUrl ?? cached.authorAvatarUrl,
    authorDisplayName: current.authorDisplayName ?? cached.authorDisplayName,
    authorId: current.authorId ?? cached.authorId,
    authorTag: current.authorTag ?? cached.authorTag,
    authorUsername: current.authorUsername ?? cached.authorUsername,
    channelName: current.channelName ?? cached.channelName,
    content: current.content || cached.content,
    createdAt: current.createdAt ?? cached.createdAt,
    deletedAt: current.deletedAt ?? cached.deletedAt,
    editedAt: current.editedAt ?? cached.editedAt,
    embeds: current.embeds.length ? current.embeds : cached.embeds,
    guildName: current.guildName ?? cached.guildName,
    links: current.links.length ? current.links : cached.links,
    mentionChannelIds: current.mentionChannelIds.length ? current.mentionChannelIds : cached.mentionChannelIds,
    mentionRoleIds: current.mentionRoleIds.length ? current.mentionRoleIds : cached.mentionRoleIds,
    mentionUserIds: current.mentionUserIds.length ? current.mentionUserIds : cached.mentionUserIds,
    referenceMessageId: current.referenceMessageId ?? cached.referenceMessageId,
    stickers: current.stickers.length ? current.stickers : cached.stickers
  };
}

async function resolveDeletionExecutor(context: BotContext, snapshot: DeletedMessageSnapshot) {
  const guild = context.client.guilds.cache.get(snapshot.guildId) ?? await context.client.guilds.fetch(snapshot.guildId).catch(() => null);
  if (!guild) return null;

  const logs = await guild.fetchAuditLogs({
    limit: 6,
    type: AuditLogEvent.MessageDelete
  }).catch(() => null);
  const now = Date.now();
  const entry = logs?.entries.find((item) => {
    const targetId = item.target && "id" in item.target ? String(item.target.id) : null;
    const extra = item.extra as { channel?: { id?: string } } | null;
    const channelId = extra?.channel?.id ?? null;
    return targetId === snapshot.authorId
      && (!channelId || channelId === snapshot.channelId)
      && now - item.createdTimestamp <= 15_000;
  });

  return entry?.executor
    ? { executorId: entry.executor.id, executorTag: entry.executor.tag }
    : null;
}

function inferDeletionType(snapshot: DeletedMessageSnapshot, executorId: string | null, botId: string | null) {
  if (!executorId) return "UNKNOWN";
  if (snapshot.authorId && executorId === snapshot.authorId) return "AUTHOR";
  if (botId && executorId === botId) return "AUTOMATIC";
  return "MODERATOR";
}

function reserveDeletionLog(snapshot: DeletedMessageSnapshot | null | undefined) {
  if (!snapshot) return;
  cleanupExpired();
  deletionLogStates.set(deletionKey(snapshot), {
    expiresAt: Date.now() + LOG_IDEMPOTENCY_TTL_MS,
    status: "reserved"
  });
}

export function releaseDeletionLogReservation(snapshot: DeletedMessageSnapshot | null | undefined) {
  if (!snapshot) return;
  const key = deletionKey(snapshot);
  if (deletionLogStates.get(key)?.status === "reserved") {
    deletionLogStates.delete(key);
  }
}

function claimDeletionLog(snapshot: DeletedMessageSnapshot, allowReserved = false) {
  cleanupExpired();
  const key = deletionKey(snapshot);
  const current = deletionLogStates.get(key);

  if (current?.status === "logged") {
    return false;
  }

  if (current?.status === "reserved") {
    if (!allowReserved) {
      return false;
    }

    current.status = "logged";
    current.expiresAt = Date.now() + LOG_IDEMPOTENCY_TTL_MS;
    return true;
  }

  deletionLogStates.set(key, {
    expiresAt: Date.now() + LOG_IDEMPOTENCY_TTL_MS,
    status: "logged"
  });
  return true;
}

function getCachedSnapshot(guildId: string, messageId: string) {
  cleanupExpired();
  return snapshots.get(snapshotKey(guildId, messageId))?.snapshot ?? null;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, value] of snapshots) {
    if (value.expiresAt <= now) snapshots.delete(key);
  }
  for (const [key, value] of deletionLogStates) {
    if (value.expiresAt <= now) deletionLogStates.delete(key);
  }
}

function snapshotKey(guildId: string, messageId: string) {
  return `${guildId}:${messageId}`;
}

function deletionKey(snapshot: DeletedMessageSnapshot) {
  return `${snapshot.guildId}:${snapshot.channelId}:${snapshot.messageId}`;
}

function extractLinks(content: string) {
  URL_PATTERN.lastIndex = 0;
  return [...new Set([...content.matchAll(URL_PATTERN)].map((match) => match[0]).filter(Boolean))].slice(0, 25);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
