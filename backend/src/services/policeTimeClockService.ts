import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoPoliceTimeClockSession, type MongoPoliceTimeClockSettings } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";

export const POLICE_TIME_CLOCK_MODULE_ID = "police-time-clock";

export type PoliceTimeClockSettingsDto = Omit<MongoPoliceTimeClockSettings, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export type PoliceTimeClockSessionDto = Omit<MongoPoliceTimeClockSession, "_id" | "startedAt" | "endedAt" | "createdAt" | "updatedAt"> & {
  id: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PoliceTimeClockDashboard = {
  active: PoliceTimeClockSessionDto[];
  history: PoliceTimeClockSessionDto[];
  settings: PoliceTimeClockSettingsDto;
  summary: {
    activeCount: number;
    averageDurationMs: number;
    totalDurationMs: number;
    totalEntries: number;
  };
};

export async function getPoliceTimeClockDashboard(botId: string, guildId: string): Promise<PoliceTimeClockDashboard> {
  const settings = await getPoliceTimeClockSettings(botId, guildId);
  const { policeTimeClockSessions } = await getMongoCollections();
  const [activeDocs, historyDocs] = await Promise.all([
    policeTimeClockSessions.find({ botId, guildId, status: "open" }).sort({ startedAt: 1 }).limit(200).toArray(),
    policeTimeClockSessions.find({ botId, guildId, status: { $ne: "open" } }).sort({ startedAt: -1 }).limit(100).toArray()
  ]);
  const history = historyDocs.map(toSessionDto);
  const totalDurationMs = history.reduce((total, item) => total + (item.durationMs ?? 0), 0);

  return {
    active: activeDocs.map(toSessionDto),
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

export async function getPoliceTimeClockSettings(botId: string, guildId: string): Promise<PoliceTimeClockSettingsDto> {
  const { policeTimeClockSettings } = await getMongoCollections();
  const doc = await policeTimeClockSettings.findOne({ botId, guildId });
  if (doc) return toSettingsDto(doc);

  const now = new Date();
  return toSettingsDto({
    botId,
    guildId,
    enabled: false,
    panelChannelId: null,
    panelMessageId: null,
    logChannelId: null,
    managerRoleId: null,
    closeRoleId: null,
    reportRoleId: null,
    exportRoleId: null,
    adminRoleId: null,
    allowManualEntry: true,
    allowManualExit: true,
    allowAutomaticEntry: false,
    allowForcedClose: true,
    allowHistory: true,
    allowExport: false,
    maxHours: 16,
    timezone: "America/Sao_Paulo",
    timeFormat: "24h",
    autoUpdatePanel: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: null
  });
}

export async function savePoliceTimeClockSettings(botId: string, guildId: string, input: Partial<PoliceTimeClockSettingsDto>, actorId: string | null) {
  const current = await getPoliceTimeClockSettings(botId, guildId);
  const { policeTimeClockSettings } = await getMongoCollections();
  const now = new Date();
  const next = {
    enabled: input.enabled ?? current.enabled,
    panelChannelId: clean(input.panelChannelId !== undefined ? input.panelChannelId : current.panelChannelId),
    panelMessageId: clean(input.panelMessageId !== undefined ? input.panelMessageId : current.panelMessageId),
    logChannelId: clean(input.logChannelId !== undefined ? input.logChannelId : current.logChannelId),
    managerRoleId: clean(input.managerRoleId !== undefined ? input.managerRoleId : current.managerRoleId),
    closeRoleId: clean(input.closeRoleId !== undefined ? input.closeRoleId : current.closeRoleId),
    reportRoleId: clean(input.reportRoleId !== undefined ? input.reportRoleId : current.reportRoleId),
    exportRoleId: clean(input.exportRoleId !== undefined ? input.exportRoleId : current.exportRoleId),
    adminRoleId: clean(input.adminRoleId !== undefined ? input.adminRoleId : current.adminRoleId),
    allowManualEntry: input.allowManualEntry ?? current.allowManualEntry,
    allowManualExit: input.allowManualExit ?? current.allowManualExit,
    allowAutomaticEntry: input.allowAutomaticEntry ?? current.allowAutomaticEntry,
    allowForcedClose: input.allowForcedClose ?? current.allowForcedClose,
    allowHistory: input.allowHistory ?? current.allowHistory,
    allowExport: input.allowExport ?? current.allowExport,
    maxHours: input.maxHours === undefined ? current.maxHours : input.maxHours,
    timezone: clean(input.timezone) ?? current.timezone,
    timeFormat: input.timeFormat ?? current.timeFormat,
    autoUpdatePanel: input.autoUpdatePanel ?? current.autoUpdatePanel,
    updatedAt: now,
    updatedBy: actorId
  };

  await policeTimeClockSettings.updateOne(
    { botId, guildId },
    { $set: next, $setOnInsert: { _id: randomUUID(), botId, guildId, createdAt: now } },
    { upsert: true }
  );

  const saved = await getPoliceTimeClockSettings(botId, guildId);
  emitRealtime("police-time-clock:settings_updated", saved);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "police-time-clock:settings_updated", saved);
  await logPoliceTimeClock(botId, guildId, actorId, actorId, "settings_updated", "success", "Configuração do Relógio de Ponto atualizada.", saved);
  return saved;
}

export async function openPoliceTimeClockSession(botId: string, guildId: string, input: { createdBy?: string | null; origin?: "manual" | "automatic"; roleNames?: string[]; userId: string; username: string }) {
  const settings = await getPoliceTimeClockSettings(botId, guildId);
  if (!settings.enabled) throw serviceError("Sistema de Relógio de Ponto desativado.", 403);
  if (input.origin !== "automatic" && !settings.allowManualEntry) throw serviceError("Entrada manual desativada.", 403);
  const { policeTimeClockSessions } = await getMongoCollections();
  const existing = await policeTimeClockSessions.findOne({ botId, guildId, userId: input.userId, status: "open" });
  if (existing) throw serviceError("Este usuário já está em serviço.", 409);
  const now = new Date();
  const doc: MongoPoliceTimeClockSession = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: input.userId,
    username: input.username,
    roleNames: input.roleNames ?? [],
    status: "open",
    origin: input.origin ?? "manual",
    startedAt: now,
    endedAt: null,
    durationMs: null,
    netDurationMs: null,
    createdBy: input.createdBy ?? input.userId,
    closedBy: null,
    closeReason: null,
    createdAt: now,
    updatedAt: now
  };
  await policeTimeClockSessions.insertOne(doc);
  await logPoliceTimeClock(botId, guildId, input.userId, input.createdBy ?? input.userId, "entry", "success", `${input.username} entrou em serviço.`, doc);
  const dto = toSessionDto(doc);
  emitRealtime("police-time-clock:session_opened", dto);
  return dto;
}

export async function closePoliceTimeClockSession(botId: string, guildId: string, input: { closedBy?: string | null; forced?: boolean; reason?: string | null; userId: string }) {
  const settings = await getPoliceTimeClockSettings(botId, guildId);
  if (!settings.enabled) throw serviceError("Sistema de Relógio de Ponto desativado.", 403);
  if (!input.forced && !settings.allowManualExit) throw serviceError("Saída manual desativada.", 403);
  if (input.forced && !settings.allowForcedClose) throw serviceError("Fechamento forçado desativado.", 403);
  const { policeTimeClockSessions } = await getMongoCollections();
  const current = await policeTimeClockSessions.findOne({ botId, guildId, userId: input.userId, status: "open" });
  if (!current) throw serviceError("Não existe ponto aberto para este usuário.", 404);
  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - current.startedAt.getTime());
  await policeTimeClockSessions.updateOne(
    { _id: current._id },
    { $set: { closedBy: input.closedBy ?? input.userId, closeReason: clean(input.reason), durationMs, endedAt, netDurationMs: durationMs, status: input.forced ? "forced" : "closed", updatedAt: endedAt } }
  );
  const saved = await policeTimeClockSessions.findOne({ _id: current._id });
  const dto = toSessionDto(saved!);
  await logPoliceTimeClock(botId, guildId, input.userId, input.closedBy ?? input.userId, input.forced ? "forced_close" : "exit", "success", `${dto.username} saiu de serviço.`, dto);
  emitRealtime("police-time-clock:session_closed", dto);
  return dto;
}

export async function logPoliceTimeClock(botId: string, guildId: string, userId: string | null, adminId: string | null, action: string, result: "success" | "error" | "denied" | "info", message: string, metadata?: unknown) {
  const { policeTimeClockLogs } = await getMongoCollections();
  await policeTimeClockLogs.insertOne({ _id: randomUUID(), action, adminId, botId, createdAt: new Date(), guildId, message, metadata, result, userId });
}

function toSettingsDto(doc: MongoPoliceTimeClockSettings): PoliceTimeClockSettingsDto {
  return { ...doc, createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString() };
}

function toSessionDto(doc: MongoPoliceTimeClockSession): PoliceTimeClockSessionDto {
  const { _id, startedAt, endedAt, createdAt, updatedAt, ...rest } = doc;
  return { id: _id, ...rest, startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString() ?? null, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
