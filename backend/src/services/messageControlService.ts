import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoMessageControlSettings, type MongoMessageControlUser } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export const MESSAGE_CONTROL_MODULE_ID = "message-control";

export type MessageControlStatus = "equipe" | "pessoal";

export type MessageControlUserDto = {
  autorizado: boolean;
  avatarUrl: string | null;
  botId: string;
  createdAt: string;
  createdBy: string | null;
  discordId: string;
  guildId: string;
  id: string;
  status: MessageControlStatus;
  updatedAt: string;
  updatedBy: string | null;
  username: string | null;
};

export type MessageControlSettingsDto = {
  botId: string;
  guildId: string;
  managerRoleIds: string[];
  managerUserIds: string[];
  updatedAt: string;
  updatedBy: string | null;
};

export type MessageControlDashboardDto = {
  settings: MessageControlSettingsDto;
  users: MessageControlUserDto[];
};

export type SaveMessageControlUserInput = {
  avatarUrl?: string | null;
  discordId: string;
  username?: string | null;
};

export async function getMessageControlDashboard(botId: string, guildId: string): Promise<MessageControlDashboardDto> {
  return {
    settings: await getMessageControlSettings(botId, guildId),
    users: await listMessageControlUsers(botId, guildId)
  };
}

export async function getMessageControlSettings(botId: string, guildId: string): Promise<MessageControlSettingsDto> {
  const { messageControlSettings } = await getMongoCollections();
  const row = await messageControlSettings.findOne({ botId, guildId });
  return toSettingsDto(row ?? defaultSettings(botId, guildId));
}

export async function saveMessageControlSettings(
  botId: string,
  guildId: string,
  input: Partial<Pick<MessageControlSettingsDto, "managerRoleIds" | "managerUserIds">>,
  actorId: string | null
) {
  const { messageControlSettings } = await getMongoCollections();
  const now = new Date();
  const current = await messageControlSettings.findOne({ botId, guildId });
  const row: MongoMessageControlSettings = {
    _id: current?._id ?? randomUUID(),
    botId,
    createdAt: current?.createdAt ?? now,
    guildId,
    managerRoleIds: normalizeIds(input.managerRoleIds ?? current?.managerRoleIds ?? []),
    managerUserIds: normalizeIds(input.managerUserIds ?? current?.managerUserIds ?? []),
    updatedAt: now,
    updatedBy: actorId
  };

  await ensureGuild(guildId);
  await messageControlSettings.updateOne({ botId, guildId }, { $set: row }, { upsert: true });
  emitMessageControlUpdated(botId, guildId);
  return toSettingsDto(row);
}

export async function listMessageControlUsers(botId: string, guildId: string) {
  const { messageControlUsers } = await getMongoCollections();
  const rows = await messageControlUsers
    .find({ botId, guildId, autorizado: true })
    .sort({ updatedAt: -1 })
    .limit(5000)
    .toArray();
  return rows.map(toUserDto);
}

export async function getMessageControlUser(botId: string, guildId: string, discordId: string) {
  const { messageControlUsers } = await getMongoCollections();
  const row = await messageControlUsers.findOne({ botId, guildId, discordId, autorizado: true });
  return row ? toUserDto(row) : null;
}

export async function addMessageControlUser(
  botId: string,
  guildId: string,
  input: SaveMessageControlUserInput,
  actorId: string | null
) {
  const { messageControlUsers } = await getMongoCollections();
  const now = new Date();
  const current = await messageControlUsers.findOne({ botId, guildId, discordId: input.discordId });
  const row: MongoMessageControlUser = {
    _id: current?._id ?? randomUUID(),
    autorizado: true,
    avatarUrl: normalizeNullable(input.avatarUrl ?? current?.avatarUrl ?? null, 500),
    botId,
    createdAt: current?.createdAt ?? now,
    createdBy: current?.createdBy ?? actorId,
    discordId: input.discordId,
    guildId,
    status: current?.status === "pessoal" ? "pessoal" : "equipe",
    updatedAt: now,
    updatedBy: actorId,
    username: normalizeNullable(input.username ?? current?.username ?? null, 120)
  };

  await ensureGuild(guildId);
  await messageControlUsers.updateOne({ botId, guildId, discordId: input.discordId }, { $set: row }, { upsert: true });
  emitMessageControlUpdated(botId, guildId);
  return toUserDto(row);
}

export async function removeMessageControlUser(botId: string, guildId: string, discordId: string, actorId: string | null) {
  const { messageControlUsers } = await getMongoCollections();
  const row = await messageControlUsers.findOneAndUpdate(
    { botId, guildId, discordId },
    { $set: { autorizado: false, updatedAt: new Date(), updatedBy: actorId } },
    { returnDocument: "after" }
  );

  emitMessageControlUpdated(botId, guildId);
  return row ? toUserDto(row) : null;
}

export async function setMessageControlUserStatus(
  botId: string,
  guildId: string,
  discordId: string,
  status: MessageControlStatus,
  actorId: string | null
) {
  const { messageControlUsers } = await getMongoCollections();
  const row = await messageControlUsers.findOneAndUpdate(
    { botId, guildId, discordId, autorizado: true },
    { $set: { status, updatedAt: new Date(), updatedBy: actorId } },
    { returnDocument: "after" }
  );

  if (!row) throw serviceError("Usuário não cadastrado no /mensagem config.", 403);

  emitMessageControlUpdated(botId, guildId);
  await createLog({
    action: status === "pessoal" ? "modo_pessoal" : "modo_equipe",
    botId,
    guildId,
    message: status === "pessoal"
      ? `Usuário ${discordId} ativou modo pessoal no /mensagem.`
      : `Usuário ${discordId} ativou modo oculto no /mensagem.`,
    metadata: { status, modo: status === "pessoal" ? "pessoal" : "oculto" },
    module: "Sistema de Controle de Mensagem Individual",
    status: "info",
    type: "message_control.status_updated",
    userId: discordId
  }).catch(() => null);
  return toUserDto(row);
}

export async function clearMessageControlUsers(botId: string, guildId: string, actorId: string | null) {
  const { messageControlUsers } = await getMongoCollections();
  await messageControlUsers.updateMany(
    { botId, guildId, autorizado: true },
    { $set: { autorizado: false, updatedAt: new Date(), updatedBy: actorId } }
  );
  emitMessageControlUpdated(botId, guildId);
  return listMessageControlUsers(botId, guildId);
}

function toUserDto(row: MongoMessageControlUser): MessageControlUserDto {
  return {
    autorizado: row.autorizado,
    avatarUrl: row.avatarUrl,
    botId: row.botId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    discordId: row.discordId,
    guildId: row.guildId,
    id: row._id,
    status: row.status === "pessoal" ? "pessoal" : "equipe",
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    username: row.username
  };
}

function toSettingsDto(row: MongoMessageControlSettings): MessageControlSettingsDto {
  return {
    botId: row.botId,
    guildId: row.guildId,
    managerRoleIds: row.managerRoleIds,
    managerUserIds: row.managerUserIds,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
  };
}

function defaultSettings(botId: string, guildId: string): MongoMessageControlSettings {
  const now = new Date(0);
  return {
    _id: "",
    botId,
    createdAt: now,
    guildId,
    managerRoleIds: [],
    managerUserIds: [],
    updatedAt: now,
    updatedBy: null
  };
}

function normalizeNullable(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))].slice(0, 100);
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function emitMessageControlUpdated(botId: string, guildId: string) {
  const payload = { botId, guildId };
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "message-control:users_updated", payload);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "message-control:users_updated", payload);
}
