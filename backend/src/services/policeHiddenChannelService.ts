import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoPoliceHiddenChannelLog, type MongoPoliceHiddenChannelSettings } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const POLICE_HIDDEN_CHANNEL_MODULE_ID = "police-hidden-channel";

export type PoliceHiddenChannelSettingsDto = {
  allowedRoleId: string | null;
  botId: string;
  channelId: string | null;
  createdAt: string;
  createdBy: string | null;
  enabled: boolean;
  guildId: string;
  id: string;
  logChannelId: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type PoliceHiddenChannelLogDto = {
  attachmentUrls: string[];
  authorId: string;
  authorTag: string;
  botId: string;
  channelId: string;
  content: string;
  createdAt: string;
  embedCount: number;
  errorMessage: string | null;
  guildId: string;
  id: string;
  logChannelId: string | null;
  originalMessageId: string;
  relayedMessageId: string | null;
  status: "relayed" | "failed";
  stickerIds: string[];
};

export type SavePoliceHiddenChannelSettingsInput = Partial<Pick<
  PoliceHiddenChannelSettingsDto,
  "allowedRoleId" | "channelId" | "enabled" | "logChannelId"
>>;

export type CreatePoliceHiddenChannelLogInput = {
  attachmentUrls?: string[];
  authorId: string;
  authorTag: string;
  channelId: string;
  content: string;
  embedCount?: number;
  errorMessage?: string | null;
  guildId: string;
  logChannelId?: string | null;
  originalMessageId: string;
  relayedMessageId?: string | null;
  status: "relayed" | "failed";
  stickerIds?: string[];
};

export async function getPoliceHiddenChannelDashboard(botId: string, guildId: string) {
  return {
    logs: await listPoliceHiddenChannelLogs(botId, guildId),
    settings: await getPoliceHiddenChannelSettings(botId, guildId)
  };
}

export async function getPoliceHiddenChannelSettings(botId: string, guildId: string) {
  const { policeHiddenChannelSettings } = await getMongoCollections();
  const row = await policeHiddenChannelSettings.findOne({ botId, guildId });
  return toSettingsDto(row ?? defaultSettings(botId, guildId));
}

export async function savePoliceHiddenChannelSettings(
  botId: string,
  guildId: string,
  input: SavePoliceHiddenChannelSettingsInput,
  actorId: string | null
) {
  const { policeHiddenChannelSettings } = await getMongoCollections();
  const now = new Date();
  const current = await policeHiddenChannelSettings.findOne({ botId, guildId });
  const next: MongoPoliceHiddenChannelSettings = {
    _id: current?._id ?? randomUUID(),
    allowedRoleId: normalizeSnowflake(input.allowedRoleId ?? current?.allowedRoleId ?? null),
    botId,
    channelId: normalizeSnowflake(input.channelId ?? current?.channelId ?? null),
    createdAt: current?.createdAt ?? now,
    createdBy: current?.createdBy ?? actorId,
    enabled: input.enabled ?? current?.enabled ?? false,
    guildId,
    logChannelId: normalizeSnowflake(input.logChannelId ?? current?.logChannelId ?? null),
    updatedAt: now,
    updatedBy: actorId
  };

  await ensureGuild(guildId);
  await policeHiddenChannelSettings.updateOne({ botId, guildId }, { $set: next }, { upsert: true });
  emitPoliceHiddenChannelUpdated(botId, guildId);
  return toSettingsDto(next);
}

export async function removePoliceHiddenChannelSettings(botId: string, guildId: string, actorId: string | null) {
  const { policeHiddenChannelSettings } = await getMongoCollections();
  const current = await policeHiddenChannelSettings.findOne({ botId, guildId });

  if (!current) {
    return toSettingsDto(defaultSettings(botId, guildId));
  }

  const now = new Date();
  const next: MongoPoliceHiddenChannelSettings = {
    ...current,
    allowedRoleId: null,
    channelId: null,
    enabled: false,
    logChannelId: null,
    updatedAt: now,
    updatedBy: actorId
  };

  await policeHiddenChannelSettings.updateOne({ botId, guildId }, { $set: next });
  emitPoliceHiddenChannelUpdated(botId, guildId);
  return toSettingsDto(next);
}

export async function listPoliceHiddenChannelLogs(botId: string, guildId: string, limit = 100) {
  const { policeHiddenChannelLogs } = await getMongoCollections();
  const rows = await policeHiddenChannelLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(limit).toArray();
  return rows.map(toLogDto);
}

export async function createPoliceHiddenChannelLog(botId: string, input: CreatePoliceHiddenChannelLogInput) {
  const { policeHiddenChannelLogs } = await getMongoCollections();
  const now = new Date();
  const row: MongoPoliceHiddenChannelLog = {
    _id: randomUUID(),
    attachmentUrls: input.attachmentUrls ?? [],
    authorId: input.authorId,
    authorTag: input.authorTag,
    botId,
    channelId: input.channelId,
    content: input.content.slice(0, 4000),
    createdAt: now,
    embedCount: input.embedCount ?? 0,
    errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
    guildId: input.guildId,
    logChannelId: input.logChannelId ?? null,
    originalMessageId: input.originalMessageId,
    relayedMessageId: input.relayedMessageId ?? null,
    status: input.status,
    stickerIds: input.stickerIds ?? []
  };

  await policeHiddenChannelLogs.insertOne(row).catch(async (error) => {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return;
    }

    throw error;
  });
  emitRealtimeToRoom(dashboardLogRealtimeRoom(input.guildId, botId), "police-hidden-channel:log_created", toLogDto(row));
  return toLogDto(row);
}

function defaultSettings(botId: string, guildId: string): MongoPoliceHiddenChannelSettings {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    allowedRoleId: null,
    botId,
    channelId: null,
    createdAt: now,
    createdBy: null,
    enabled: false,
    guildId,
    logChannelId: null,
    updatedAt: now,
    updatedBy: null
  };
}

function toSettingsDto(row: MongoPoliceHiddenChannelSettings): PoliceHiddenChannelSettingsDto {
  return {
    allowedRoleId: row.allowedRoleId,
    botId: row.botId,
    channelId: row.channelId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    enabled: row.enabled,
    guildId: row.guildId,
    id: row._id,
    logChannelId: row.logChannelId,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
  };
}

function toLogDto(row: MongoPoliceHiddenChannelLog): PoliceHiddenChannelLogDto {
  return {
    attachmentUrls: row.attachmentUrls,
    authorId: row.authorId,
    authorTag: row.authorTag,
    botId: row.botId,
    channelId: row.channelId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    embedCount: row.embedCount,
    errorMessage: row.errorMessage,
    guildId: row.guildId,
    id: row._id,
    logChannelId: row.logChannelId,
    originalMessageId: row.originalMessageId,
    relayedMessageId: row.relayedMessageId,
    status: row.status,
    stickerIds: row.stickerIds
  };
}

function normalizeSnowflake(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^\d{5,32}$/.test(trimmed) ? trimmed : null;
}

function emitPoliceHiddenChannelUpdated(botId: string, guildId: string) {
  const payload = { botId, guildId };
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "police-hidden-channel:settings_updated", payload);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "police-hidden-channel:settings_updated", payload);
}
