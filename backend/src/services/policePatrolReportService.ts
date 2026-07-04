import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { getMongoCollections, type MongoPolicePatrolMessage, type MongoPolicePatrolSettings } from "../database/mongo";

export const POLICE_PATROL_MODULE_ID = "police-patrol-reports";
type SettingsInput = Partial<Pick<MongoPolicePatrolSettings, "enabled" | "creatorRoleIds" | "viewerRoleIds" | "deleteRoleIds" | "supervisorRoleIds" | "logChannelId" | "temporaryCategoryId" | "deleteDelayMinutes" | "defaultExportFormat">>;

export async function getPolicePatrolSettings(botId: string, guildId: string) {
  const { policePatrolSettings } = await getMongoCollections();
  const found = await policePatrolSettings.findOne({ botId, guildId }); if (found) return settingsDto(found);
  const now = new Date();
  const settings: MongoPolicePatrolSettings = { _id: randomUUID(), botId, guildId, enabled: false, creatorRoleIds: [], viewerRoleIds: [], deleteRoleIds: [], supervisorRoleIds: [], logChannelId: null, temporaryCategoryId: null, deleteDelayMinutes: 5, defaultExportFormat: "html", createdAt: now, updatedAt: now, updatedBy: null };
  await policePatrolSettings.updateOne({ botId, guildId }, { $setOnInsert: settings }, { upsert: true });
  return settingsDto((await policePatrolSettings.findOne({ botId, guildId })) ?? settings);
}

export async function savePolicePatrolSettings(botId: string, guildId: string, input: SettingsInput, actorId: string | null) {
  await getPolicePatrolSettings(botId, guildId); const { policePatrolSettings } = await getMongoCollections();
  await policePatrolSettings.updateOne({ botId, guildId }, { $set: { ...input, updatedAt: new Date(), updatedBy: actorId } });
  return settingsDto((await policePatrolSettings.findOne({ botId, guildId }))!);
}

export async function createPolicePatrolReport(input: { botId: string; guildId: string; officerId: string; officerName: string; authorId: string; authorName: string; patrolType?: string | null; initialNotes?: string | null }) {
  const { policePatrolReports } = await getMongoCollections(); const now = new Date();
  const openKey = `${input.botId}:${input.guildId}:${input.authorId}:${input.officerId}`;
  const existing = await policePatrolReports.findOne({ botId: input.botId, guildId: input.guildId, authorId: input.authorId, officerId: input.officerId, status: { $in: ["draft", "active"] } });
  if (existing) return reportDto(existing);
  const report = { _id: randomUUID(), ...input, openKey, patrolType: input.patrolType ?? null, initialNotes: input.initialNotes ?? null, patrolStart: null, patrolEnd: null, durationMinutes: null, channelId: null, panelMessageId: null, lastAuthorMessageId: null, messageCount: 0, attachmentCount: 0, status: "draft" as const, createdAt: now, startedAt: null, finishedAt: null, cancelledAt: null, deleteAt: null, updatedAt: now };
  try { await policePatrolReports.insertOne(report); } catch (error: any) { if (error?.code === 11000) { const duplicate = await policePatrolReports.findOne({ openKey }); if (duplicate) return reportDto(duplicate); } throw error; } await audit(report._id, input.botId, input.guildId, input.authorId, "created", {}); return reportDto(report);
}

export async function setPolicePatrolChannel(botId: string, reportId: string, channelId: string, panelMessageId: string) {
  const { policePatrolReports } = await getMongoCollections(); await policePatrolReports.updateOne({ _id: reportId, botId }, { $set: { channelId, panelMessageId, updatedAt: new Date() } }); return requireReport(botId, reportId);
}

export async function startPolicePatrolReport(botId: string, reportId: string, actorId: string, patrolStart: string, patrolEnd: string) {
  const { policePatrolReports } = await getMongoCollections(); const report = await policePatrolReports.findOne({ _id: reportId, botId });
  if (!report) throw serviceError("Relatório não encontrado.", 404); if (report.authorId !== actorId) throw serviceError("Somente o responsável pode iniciar este relatório.", 403);
  const durationMinutes = timeMinutes(patrolStart, patrolEnd); const now = new Date();
  await policePatrolReports.updateOne({ _id: reportId, botId, status: "draft" }, { $set: { patrolStart, patrolEnd, durationMinutes, status: "active", startedAt: now, updatedAt: now } });
  await audit(reportId, botId, report.guildId, actorId, "started", { patrolStart, patrolEnd }); return requireReport(botId, reportId);
}

export async function appendPolicePatrolMessage(botId: string, reportId: string, input: Omit<MongoPolicePatrolMessage, "_id" | "reportId" | "botId" | "guildId" | "createdAt"> & { createdAt: Date }) {
  const { policePatrolReports, policePatrolMessages } = await getMongoCollections(); const report = await policePatrolReports.findOne({ _id: reportId, botId, status: "active", authorId: input.authorId });
  if (!report) throw serviceError("Relatório ativo não encontrado para esta mensagem.", 404);
  const item: MongoPolicePatrolMessage = { _id: randomUUID(), reportId, botId, guildId: report.guildId, ...input };
  try { await policePatrolMessages.insertOne(item); } catch (error: any) { if (error?.code === 11000) return messageDto((await policePatrolMessages.findOne({ botId, discordMessageId: input.discordMessageId }))!); throw error; }
  await policePatrolReports.updateOne({ _id: reportId, botId }, { $set: { lastAuthorMessageId: input.discordMessageId, updatedAt: new Date() }, $inc: { messageCount: 1, attachmentCount: input.attachments.length } }); return messageDto(item);
}

export async function finishPolicePatrolReport(botId: string, reportId: string, actorId: string, deleteDelayMinutes: number) {
  const { policePatrolReports } = await getMongoCollections(); const report = await policePatrolReports.findOne({ _id: reportId, botId });
  if (!report) throw serviceError("Relatório não encontrado.", 404); if (report.authorId !== actorId) throw serviceError("Somente o responsável pode finalizar este relatório.", 403);
  const now = new Date(); const deleteAt = new Date(now.getTime() + Math.max(0, deleteDelayMinutes) * 60_000);
  const result = await policePatrolReports.updateOne({ _id: reportId, botId, status: "active" }, { $set: { status: "finished", finishedAt: now, deleteAt, updatedAt: now }, $unset: { openKey: "" } }); if (!result.matchedCount) throw serviceError("Este relatório não está em andamento.", 409); await audit(reportId, botId, report.guildId, actorId, "finished", {}); return getPolicePatrolReport(botId, reportId);
}

export async function cancelPolicePatrolReport(botId: string, reportId: string, actorId: string, deleteDelayMinutes: number) {
  const { policePatrolReports } = await getMongoCollections(); const report = await policePatrolReports.findOne({ _id: reportId, botId }); if (!report) throw serviceError("Relatório não encontrado.", 404);
  if (report.authorId !== actorId) throw serviceError("Somente o responsável pode cancelar este relatório.", 403); const now = new Date();
  const result = await policePatrolReports.updateOne({ _id: reportId, botId, status: { $in: ["draft", "active"] } }, { $set: { status: "cancelled", cancelledAt: now, deleteAt: new Date(now.getTime() + deleteDelayMinutes * 60_000), updatedAt: now }, $unset: { openKey: "" } }); if (!result.matchedCount) throw serviceError("Este relatório já foi encerrado.", 409); await audit(reportId, botId, report.guildId, actorId, "cancelled", {}); return requireReport(botId, reportId);
}

export async function getPolicePatrolReport(botId: string, reportId: string) { const report = await requireReport(botId, reportId); const { policePatrolMessages } = await getMongoCollections(); const messages = await policePatrolMessages.find({ reportId, botId }).sort({ createdAt: 1, _id: 1 }).toArray(); return { report, messages: messages.map(messageDto) }; }
export async function getPolicePatrolReportByChannel(botId: string, channelId: string) { const { policePatrolReports } = await getMongoCollections(); const report = await policePatrolReports.findOne({ botId, channelId, status: "active" }); return report ? reportDto(report) : null; }
export async function listPolicePatrolReports(botId: string, guildId: string, officerId?: string | null, limit = 100) { const { policePatrolReports } = await getMongoCollections(); return (await policePatrolReports.find({ botId, guildId, ...(officerId ? { officerId } : {}) }).sort({ createdAt: -1 }).limit(Math.min(500, limit)).toArray()).map(reportDto); }
export async function deletePolicePatrolReport(botId: string, reportId: string, actorId: string) { const { policePatrolReports, policePatrolMessages, policePatrolFiles } = await getMongoCollections(); const report = await policePatrolReports.findOne({ _id: reportId, botId }); if (!report) return null; await Promise.all([policePatrolMessages.deleteMany({ reportId, botId }), policePatrolFiles.deleteMany({ reportId, botId })]); await policePatrolReports.deleteOne({ _id: reportId, botId }); await audit(reportId, botId, report.guildId, actorId, "deleted", {}); return reportDto(report); }
export async function listPolicePatrolChannelsDue(botId: string) { const { policePatrolReports } = await getMongoCollections(); return (await policePatrolReports.find({ botId, channelId: { $ne: null }, deleteAt: { $lte: new Date() }, status: { $in: ["finished", "cancelled"] } }).limit(100).toArray()).map(reportDto); }
export async function clearPolicePatrolChannel(botId: string, reportId: string) { const { policePatrolReports } = await getMongoCollections(); await policePatrolReports.updateOne({ _id: reportId, botId }, { $set: { channelId: null, panelMessageId: null, updatedAt: new Date() } }); }
export async function savePolicePatrolFile(botId: string, reportId: string, input: { discordAttachmentId: string; name: string; mimeType: string; buffer: Buffer }) { const { policePatrolReports, policePatrolFiles } = await getMongoCollections(); const report = await policePatrolReports.findOne({ _id: reportId, botId }); if (!report) throw serviceError("Relatório não encontrado.", 404); const existing = await policePatrolFiles.findOne({ botId, discordAttachmentId: input.discordAttachmentId }); if (existing) return fileDto(existing); const file = { _id: randomUUID(), reportId, botId, guildId: report.guildId, ...input, size: input.buffer.length, createdAt: new Date() }; await policePatrolFiles.insertOne(file); return fileDto(file); }
export async function getPolicePatrolFile(fileId: string) { const { policePatrolFiles } = await getMongoCollections(); return policePatrolFiles.findOne({ _id: fileId }); }

async function requireReport(botId: string, reportId: string) { const { policePatrolReports } = await getMongoCollections(); const value = await policePatrolReports.findOne({ _id: reportId, botId }); if (!value) throw serviceError("Relatório não encontrado.", 404); return reportDto(value); }
async function audit(reportId: string, botId: string, guildId: string, actorId: string | null, action: string, metadata: Record<string, unknown>) { const { policePatrolAudits } = await getMongoCollections(); await policePatrolAudits.insertOne({ _id: randomUUID(), reportId, botId, guildId, actorId, action, metadata, createdAt: new Date() }); }
function timeMinutes(start: string, end: string) { const parse = (value: string) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw serviceError("Horário inválido. Use HH:mm.", 400); const [h, m] = value.split(":").map(Number); return h! * 60 + m!; }; const a = parse(start); let b = parse(end); if (b < a) b += 1440; return b - a; }
function settingsDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function reportDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), startedAt: value.startedAt?.toISOString() ?? null, finishedAt: value.finishedAt?.toISOString() ?? null, cancelledAt: value.cancelledAt?.toISOString() ?? null, deleteAt: value.deleteAt?.toISOString() ?? null, updatedAt: value.updatedAt.toISOString() }; }
function messageDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString() }; }
function fileDto(value: any) { const path = `/api/police-patrol-reports/files/${value._id}`; return { id: value._id, name: value.name, mimeType: value.mimeType, size: value.size, url: new URL(path, env.FRONTEND_URL).toString() }; }
function serviceError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
