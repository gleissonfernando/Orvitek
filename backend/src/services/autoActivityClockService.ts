import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoAutoActivityClockCity,
  type MongoAutoActivityClockSession,
  type MongoAutoActivityClockSettings
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";

export const AUTO_ACTIVITY_CLOCK_MODULE_ID = "auto-activity-clock";

export type AutoActivityClockSettingsDto = Omit<MongoAutoActivityClockSettings, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export type AutoActivityClockCityDto = Omit<MongoAutoActivityClockCity, "_id" | "createdAt" | "updatedAt"> & { id: string; createdAt: string; updatedAt: string };
export type AutoActivityClockSessionDto = Omit<MongoAutoActivityClockSession, "_id" | "startedAt" | "endedAt" | "createdAt" | "updatedAt"> & {
  id: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AutoActivityClockDashboard = {
  active: AutoActivityClockSessionDto[];
  cities: AutoActivityClockCityDto[];
  history: AutoActivityClockSessionDto[];
  settings: AutoActivityClockSettingsDto;
  summary: { activeCount: number; averageDurationMs: number; totalDurationMs: number; totalEntries: number };
};

export async function getAutoActivityClockDashboard(botId: string, guildId: string): Promise<AutoActivityClockDashboard> {
  const settings = await getAutoActivityClockSettings(botId, guildId);
  const { autoActivityClockCities, autoActivityClockSessions } = await getMongoCollections();
  const [cities, activeDocs, historyDocs] = await Promise.all([
    autoActivityClockCities.find({ botId, guildId }).sort({ name: 1 }).toArray(),
    autoActivityClockSessions.find({ botId, guildId, status: "open" }).sort({ startedAt: 1 }).limit(200).toArray(),
    autoActivityClockSessions.find({ botId, guildId, status: { $ne: "open" } }).sort({ startedAt: -1 }).limit(100).toArray()
  ]);
  const history = historyDocs.map(toSessionDto);
  const totalDurationMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  return {
    active: activeDocs.map(toSessionDto),
    cities: cities.map(toCityDto),
    history,
    settings,
    summary: {
      activeCount: activeDocs.length,
      averageDurationMs: history.length ? Math.round(totalDurationMs / history.length) : 0,
      totalDurationMs,
      totalEntries: history.length
    }
  };
}

export async function getAutoActivityClockSettings(botId: string, guildId: string): Promise<AutoActivityClockSettingsDto> {
  const { autoActivityClockSettings } = await getMongoCollections();
  const doc = await autoActivityClockSettings.findOne({ botId, guildId });
  if (doc) return toSettingsDto(doc);
  const now = new Date();
  return toSettingsDto({
    botId,
    guildId,
    enabled: false,
    panelChannelId: null,
    panelMessageId: null,
    logChannelId: null,
    viewRoleIds: [],
    manualEntryRoleIds: [],
    manualExitRoleIds: [],
    closeRoleIds: [],
    historyRoleIds: [],
    exportRoleIds: [],
    updatePanelRoleIds: [],
    adminRoleIds: [],
    cityManagerRoleIds: [],
    allowedUserIds: [],
    blockedUserIds: [],
    minMinutes: 0,
    maxHours: 16,
    autoUpdatePanel: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: null
  });
}

export async function saveAutoActivityClockSettings(botId: string, guildId: string, input: Partial<AutoActivityClockSettingsDto>, actorId: string | null) {
  const current = await getAutoActivityClockSettings(botId, guildId);
  const { autoActivityClockSettings } = await getMongoCollections();
  const now = new Date();
  const next = {
    enabled: input.enabled ?? current.enabled,
    panelChannelId: clean(input.panelChannelId !== undefined ? input.panelChannelId : current.panelChannelId),
    panelMessageId: clean(input.panelMessageId !== undefined ? input.panelMessageId : current.panelMessageId),
    logChannelId: clean(input.logChannelId !== undefined ? input.logChannelId : current.logChannelId),
    viewRoleIds: ids(input.viewRoleIds ?? current.viewRoleIds),
    manualEntryRoleIds: ids(input.manualEntryRoleIds ?? current.manualEntryRoleIds),
    manualExitRoleIds: ids(input.manualExitRoleIds ?? current.manualExitRoleIds),
    closeRoleIds: ids(input.closeRoleIds ?? current.closeRoleIds),
    historyRoleIds: ids(input.historyRoleIds ?? current.historyRoleIds),
    exportRoleIds: ids(input.exportRoleIds ?? current.exportRoleIds),
    updatePanelRoleIds: ids(input.updatePanelRoleIds ?? current.updatePanelRoleIds),
    adminRoleIds: ids(input.adminRoleIds ?? current.adminRoleIds),
    cityManagerRoleIds: ids(input.cityManagerRoleIds ?? current.cityManagerRoleIds),
    allowedUserIds: ids(input.allowedUserIds ?? current.allowedUserIds),
    blockedUserIds: ids(input.blockedUserIds ?? current.blockedUserIds),
    minMinutes: Math.max(0, Number(input.minMinutes ?? current.minMinutes) || 0),
    maxHours: input.maxHours === undefined ? current.maxHours : input.maxHours,
    autoUpdatePanel: input.autoUpdatePanel ?? current.autoUpdatePanel,
    updatedAt: now,
    updatedBy: actorId
  };
  await autoActivityClockSettings.updateOne({ botId, guildId }, { $set: next, $setOnInsert: { _id: randomUUID(), botId, guildId, createdAt: now } }, { upsert: true });
  const saved = await getAutoActivityClockSettings(botId, guildId);
  emitRealtime("auto-activity-clock:settings_updated", saved);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "auto-activity-clock:settings_updated", saved);
  await logAutoActivityClock(botId, guildId, null, actorId, "settings_updated", "success", "Configuração do Ponto Automático atualizada.", saved);
  return saved;
}

export async function saveAutoActivityClockCity(botId: string, guildId: string, input: { aliases?: string[]; cityId?: string | null; enabled?: boolean; name: string }, actorId: string | null) {
  const { autoActivityClockCities } = await getMongoCollections();
  const now = new Date();
  const name = input.name.trim();
  if (!name) throw serviceError("Nome da cidade obrigatório.", 400);
  const id = clean(input.cityId) ?? randomUUID();
  await autoActivityClockCities.updateOne(
    { _id: id, botId, guildId },
    {
      $set: { aliases: normalizeAliases(input.aliases), enabled: input.enabled ?? true, name, updatedAt: now, updatedBy: actorId },
      $setOnInsert: { _id: id, botId, guildId, createdAt: now }
    },
    { upsert: true }
  );
  const saved = await autoActivityClockCities.findOne({ _id: id, botId, guildId });
  emitRealtime("auto-activity-clock:cities_updated", { botId, guildId });
  return toCityDto(saved!);
}

export async function deleteAutoActivityClockCity(botId: string, guildId: string, cityId: string) {
  const { autoActivityClockCities } = await getMongoCollections();
  await autoActivityClockCities.deleteOne({ _id: cityId, botId, guildId });
  emitRealtime("auto-activity-clock:cities_updated", { botId, guildId });
}

export async function matchAutoActivityCity(botId: string, guildId: string, activityName: string) {
  const { autoActivityClockCities } = await getMongoCollections();
  const cities = await autoActivityClockCities.find({ botId, guildId, enabled: true }).toArray();
  const source = normalize(activityName);
  return cities.find((city) => [city.name, ...city.aliases].some((item) => source.includes(normalize(item)))) ?? null;
}

export async function openAutoActivityClockSession(botId: string, guildId: string, input: { cityId: string; cityName: string; statusDiscord: string; userId: string; username: string }) {
  const settings = await getAutoActivityClockSettings(botId, guildId);
  if (!settings.enabled) throw serviceError("Sistema de Ponto Automático desativado.", 403);
  if (settings.blockedUserIds.includes(input.userId)) throw serviceError("Usuário bloqueado no Ponto Automático.", 403);
  if (settings.allowedUserIds.length && !settings.allowedUserIds.includes(input.userId)) throw serviceError("Usuário não liberado no Ponto Automático.", 403);
  const { autoActivityClockSessions } = await getMongoCollections();
  const existing = await autoActivityClockSessions.findOne({ botId, guildId, userId: input.userId, status: "open" });
  if (existing) {
    if (existing.cityId === input.cityId) return toSessionDto(existing);
    await closeAutoActivityClockSession(botId, guildId, { statusDiscord: input.statusDiscord, userId: input.userId });
  }
  const now = new Date();
  const doc: MongoAutoActivityClockSession = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: input.userId,
    username: input.username,
    cityId: input.cityId,
    cityName: input.cityName,
    statusDiscord: input.statusDiscord,
    status: "open",
    origin: "automatic",
    startedAt: now,
    endedAt: null,
    durationMs: null,
    createdAt: now,
    updatedAt: now
  };
  await autoActivityClockSessions.insertOne(doc);
  await logAutoActivityClock(botId, guildId, input.userId, null, "entry", "success", `${input.username} entrou em ${input.cityName}.`, doc);
  const dto = toSessionDto(doc);
  emitRealtime("auto-activity-clock:session_opened", dto);
  return dto;
}

export async function closeAutoActivityClockSession(botId: string, guildId: string, input: { statusDiscord?: string | null; userId: string }) {
  const { autoActivityClockSessions } = await getMongoCollections();
  const current = await autoActivityClockSessions.findOne({ botId, guildId, userId: input.userId, status: "open" });
  if (!current) throw serviceError("Não existe ponto automático aberto para este usuário.", 404);
  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - current.startedAt.getTime());
  await autoActivityClockSessions.updateOne({ _id: current._id }, { $set: { durationMs, endedAt, status: "closed", statusDiscord: input.statusDiscord ?? current.statusDiscord, updatedAt: endedAt } });
  const saved = await autoActivityClockSessions.findOne({ _id: current._id });
  const dto = toSessionDto(saved!);
  await logAutoActivityClock(botId, guildId, input.userId, null, "exit", "success", `${dto.username} saiu de ${dto.cityName}.`, dto);
  emitRealtime("auto-activity-clock:session_closed", dto);
  return dto;
}

export async function logAutoActivityClock(botId: string, guildId: string, userId: string | null, adminId: string | null, action: string, result: "success" | "error" | "denied" | "info", message: string, metadata?: unknown) {
  const { autoActivityClockLogs } = await getMongoCollections();
  await autoActivityClockLogs.insertOne({ _id: randomUUID(), action, adminId, botId, createdAt: new Date(), guildId, message, metadata, result, userId });
}

function toSettingsDto(doc: MongoAutoActivityClockSettings): AutoActivityClockSettingsDto {
  return { ...doc, createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString() };
}
function toCityDto(doc: MongoAutoActivityClockCity): AutoActivityClockCityDto {
  const { _id, createdAt, updatedAt, ...rest } = doc;
  return { id: _id, ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}
function toSessionDto(doc: MongoAutoActivityClockSession): AutoActivityClockSessionDto {
  const { _id, startedAt, endedAt, createdAt, updatedAt, ...rest } = doc;
  return { id: _id, ...rest, startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString() ?? null, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}
function clean(value: string | null | undefined) { const normalized = value?.trim(); return normalized || null; }
function ids(values: string[] | undefined) { return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))]; }
function normalizeAliases(values?: string[]) { return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))]; }
function normalize(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
function serviceError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
