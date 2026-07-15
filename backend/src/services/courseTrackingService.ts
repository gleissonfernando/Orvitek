import { randomUUID } from "crypto";
import { getMongoCollections, type MongoCourseHistorySettings, type MongoCourseInstructorEvent, type MongoCourseInstructorSettings, type MongoCourseStudentHistory } from "../database/mongo";
import { logCourseAction } from "./courseService";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

type Scope = { botId: string | null; guildId: string };

export type CourseInstructorEventInput = {
  courseId: string;
  courseName: string;
  instructorId: string;
  instructorName?: string | null;
  publicationId?: string | null;
  status: MongoCourseInstructorEvent["status"];
  timestamp?: string | Date | null;
};

export type ApprovedCourseHistoryInput = {
  attemptId?: string | null;
  courseId: string;
  courseName: string;
  instructorId: string;
  instructorName?: string | null;
  publicationId?: string | null;
  score: number;
  studentId: string;
  studentName?: string | null;
  timestamp?: string | Date | null;
};

export async function getInstructorTrackingSettings(botId: string | null, guildId: string) {
  const { courseInstructorSettings } = await getMongoCollections();
  const existing = await courseInstructorSettings.findOne(scope(botId, guildId));
  return mapInstructorSettings(existing ?? defaultInstructorSettings(botId, guildId));
}

export async function saveInstructorTrackingSettings(botId: string | null, guildId: string, input: Partial<ReturnType<typeof mapInstructorSettings>>, actorId: string | null) {
  const { courseInstructorSettings } = await getMongoCollections();
  const now = new Date();
  const patch: Partial<MongoCourseInstructorSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };
  if ("enabled" in input) patch.enabled = input.enabled !== false;
  if ("authorizedRoleIds" in input) patch.authorizedRoleIds = cleanIds(input.authorizedRoleIds);
  if ("logChannelId" in input) patch.logChannelId = cleanNullable(input.logChannelId);
  if ("autoWeeklyReset" in input) patch.autoWeeklyReset = input.autoWeeklyReset !== false;
  if ("timezone" in input) patch.timezone = validTimezone(input.timezone) ? String(input.timezone) : DEFAULT_TIMEZONE;
  const existing = await courseInstructorSettings.findOne(scope(botId, guildId));
  if (existing) {
    await courseInstructorSettings.updateOne(scope(botId, guildId), { $set: patch });
  } else {
    await courseInstructorSettings.insertOne({ ...defaultInstructorSettings(botId, guildId), _id: randomUUID(), ...patch, botId, guildId, updatedAt: now, updatedBy: actorId });
  }
  await logCourseAction(botId, guildId, "course.instructor_settings_updated", actorId, null, null, { fields: Object.keys(input) });
  return getInstructorTrackingSettings(botId, guildId);
}

export async function recordInstructorCourseEvent(botId: string | null, guildId: string, input: CourseInstructorEventInput) {
  const { courseInstructorEvents } = await getMongoCollections();
  const settings = await getInstructorTrackingSettings(botId, guildId);
  if (!settings.enabled) return null;
  const now = toDate(input.timestamp) ?? new Date();
  const week = weekInfo(now, settings.timezone);
  const doc: MongoCourseInstructorEvent = {
    _id: randomUUID(),
    botId,
    guildId,
    instructorId: input.instructorId,
    instructorName: cleanText(input.instructorName) || input.instructorId,
    courseId: input.courseId,
    courseName: cleanText(input.courseName) || input.courseId,
    publicationId: input.publicationId ?? null,
    status: input.status,
    statusLabel: instructorStatusLabel(input.status),
    weekKey: week.weekKey,
    weekNumber: week.weekNumber,
    year: week.year,
    date: formatDate(now, settings.timezone),
    time: formatTime(now, settings.timezone),
    timestamp: now,
    createdAt: now,
    updatedAt: now
  };
  const { _id: eventId, createdAt, ...eventPatch } = doc;
  await courseInstructorEvents.updateOne(
    { ...scope(botId, guildId), publicationId: input.publicationId ?? null, status: input.status },
    { $set: eventPatch, $setOnInsert: { _id: eventId, createdAt } },
    { upsert: true }
  );
  await logCourseAction(botId, guildId, "course.instructor_event", input.instructorId, input.courseId, input.publicationId ?? null, {
    courseName: doc.courseName,
    date: doc.date,
    instructorName: doc.instructorName,
    status: doc.statusLabel,
    time: doc.time,
    weekKey: doc.weekKey
  });
  return doc;
}

export async function getInstructorWeeklyReport(botId: string | null, guildId: string, weekKey?: string | null) {
  const { courseInstructorEvents } = await getMongoCollections();
  const settings = await getInstructorTrackingSettings(botId, guildId);
  const targetWeek = weekKey || weekInfo(new Date(), settings.timezone).weekKey;
  const events = await courseInstructorEvents.find({ ...scope(botId, guildId), weekKey: targetWeek }).sort({ timestamp: -1 }).toArray();
  const byInstructor = new Map<string, {
    instructorId: string;
    instructorName: string;
    started: number;
    cancelled: number;
    finished: number;
    closed: number;
    total: number;
    lastEventAt: string | null;
  }>();
  for (const event of events) {
    const current = byInstructor.get(event.instructorId) ?? {
      instructorId: event.instructorId,
      instructorName: event.instructorName,
      started: 0,
      cancelled: 0,
      finished: 0,
      closed: 0,
      total: 0,
      lastEventAt: null
    };
    current[event.status] += 1;
    current.total += 1;
    current.lastEventAt ||= event.timestamp.toISOString();
    byInstructor.set(event.instructorId, current);
  }
  return {
    events: events.map(mapInstructorEvent),
    instructors: [...byInstructor.values()].sort((a, b) => b.total - a.total || a.instructorName.localeCompare(b.instructorName)),
    settings,
    weekKey: targetWeek
  };
}

export async function getCourseHistorySettings(botId: string | null, guildId: string) {
  const { courseHistorySettings } = await getMongoCollections();
  const existing = await courseHistorySettings.findOne(scope(botId, guildId));
  return mapHistorySettings(existing ?? defaultHistorySettings(botId, guildId));
}

export async function saveCourseHistorySettings(botId: string | null, guildId: string, input: Partial<ReturnType<typeof mapHistorySettings>>, actorId: string | null) {
  const { courseHistorySettings } = await getMongoCollections();
  const now = new Date();
  const patch: Partial<MongoCourseHistorySettings> = {
    updatedAt: now,
    updatedBy: actorId
  };
  if ("enabled" in input) patch.enabled = input.enabled !== false;
  if ("viewRoleIds" in input) patch.viewRoleIds = cleanIds(input.viewRoleIds);
  if ("removeRoleIds" in input) patch.removeRoleIds = cleanIds(input.removeRoleIds);
  if ("logChannelId" in input) patch.logChannelId = cleanNullable(input.logChannelId);
  if ("retentionDays" in input) patch.retentionDays = input.retentionDays ? Math.max(1, Math.floor(Number(input.retentionDays))) : null;
  const existing = await courseHistorySettings.findOne(scope(botId, guildId));
  if (existing) {
    await courseHistorySettings.updateOne(scope(botId, guildId), { $set: patch });
  } else {
    await courseHistorySettings.insertOne({ ...defaultHistorySettings(botId, guildId), _id: randomUUID(), ...patch, botId, guildId, updatedAt: now, updatedBy: actorId });
  }
  await logCourseAction(botId, guildId, "course.history_settings_updated", actorId, null, null, { fields: Object.keys(input) });
  return getCourseHistorySettings(botId, guildId);
}

export async function recordApprovedCourseHistory(botId: string | null, guildId: string, input: ApprovedCourseHistoryInput) {
  const { courseStudentHistory } = await getMongoCollections();
  const settings = await getCourseHistorySettings(botId, guildId);
  if (!settings.enabled) return null;
  const now = toDate(input.timestamp) ?? new Date();
  const doc: MongoCourseStudentHistory = {
    _id: randomUUID(),
    botId,
    guildId,
    studentId: input.studentId,
    studentName: cleanText(input.studentName) || input.studentId,
    instructorId: input.instructorId,
    instructorName: cleanText(input.instructorName) || input.instructorId,
    courseId: input.courseId,
    courseName: cleanText(input.courseName) || input.courseId,
    publicationId: input.publicationId ?? null,
    attemptId: input.attemptId ?? null,
    score: Number(input.score) || 0,
    result: "approved",
    status: "approved",
    date: formatDate(now, DEFAULT_TIMEZONE),
    time: formatTime(now, DEFAULT_TIMEZONE),
    timestamp: now,
    removedAt: null,
    removedBy: null,
    removalReason: null,
    createdAt: now,
    updatedAt: now
  };
  const { _id: historyId, createdAt, ...historyPatch } = doc;
  await courseStudentHistory.updateOne(
    { ...scope(botId, guildId), attemptId: input.attemptId ?? null },
    { $set: historyPatch, $setOnInsert: { _id: historyId, createdAt } },
    { upsert: true }
  );
  await logCourseAction(botId, guildId, "course.history_approved", input.instructorId, input.courseId, input.publicationId ?? null, {
    attemptId: input.attemptId,
    score: doc.score,
    studentId: input.studentId,
    studentName: doc.studentName
  });
  return doc;
}

export async function recordApprovedCourseHistoryFromAttempt(botId: string | null, guildId: string, attemptId: string) {
  const { courses, courseExamAttempts, courseEnrollments } = await getMongoCollections();
  const attempt = await courseExamAttempts.findOne({ ...scope(botId, guildId), _id: attemptId, result: "approved" });
  if (!attempt) return null;
  const [course, enrollment] = await Promise.all([
    courses.findOne({ ...scope(botId, guildId), _id: attempt.courseId }),
    courseEnrollments.findOne({ ...scope(botId, guildId), publicationId: attempt.publicationId, studentId: attempt.studentId })
  ]);
  return recordApprovedCourseHistory(botId, guildId, {
    attemptId,
    courseId: attempt.courseId,
    courseName: course?.name ?? attempt.courseId,
    instructorId: attempt.instructorId,
    instructorName: attempt.instructorId,
    publicationId: attempt.publicationId,
    score: Number(attempt.finalScore ?? attempt.score ?? 0) || 0,
    studentId: attempt.studentId,
    studentName: attempt.studentIdentification?.guildNickname || attempt.studentIdentification?.discordDisplayName || enrollment?.studentName || attempt.studentId,
    timestamp: attempt.correctedAt ?? attempt.finishedAt ?? new Date()
  });
}

export async function listStudentCourseHistory(botId: string | null, guildId: string, studentId: string, page = 0, pageSize = 5) {
  const { courseStudentHistory } = await getMongoCollections();
  const normalizedPageSize = Math.max(1, Math.min(10, Math.floor(pageSize)));
  const normalizedPage = Math.max(0, Math.floor(page));
  const filter = { ...scope(botId, guildId), studentId, removedAt: null };
  const [items, total] = await Promise.all([
    courseStudentHistory.find(filter).sort({ timestamp: -1 }).skip(normalizedPage * normalizedPageSize).limit(normalizedPageSize).toArray(),
    courseStudentHistory.countDocuments(filter)
  ]);
  return {
    items: items.map(mapStudentHistory),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize))
  };
}

export async function removeStudentCourseHistory(botId: string | null, guildId: string, historyId: string, actorId: string, reason?: string | null) {
  const { courseStudentHistory } = await getMongoCollections();
  const now = new Date();
  const existing = await courseStudentHistory.findOne({ ...scope(botId, guildId), _id: historyId, removedAt: null });
  if (!existing) return null;
  await courseStudentHistory.updateOne(
    { ...scope(botId, guildId), _id: historyId, removedAt: null },
    { $set: { removedAt: now, removedBy: actorId, removalReason: cleanText(reason) || null, updatedAt: now } }
  );
  await logCourseAction(botId, guildId, "course.history_removed", actorId, existing.courseId, existing.publicationId, {
    courseName: existing.courseName,
    historyId,
    reason: cleanText(reason) || null,
    studentId: existing.studentId,
    studentName: existing.studentName
  });
  return mapStudentHistory({ ...existing, removedAt: now, removedBy: actorId, removalReason: cleanText(reason) || null, updatedAt: now });
}

function defaultInstructorSettings(botId: string | null, guildId: string): MongoCourseInstructorSettings {
  const now = new Date();
  return { _id: "", authorizedRoleIds: [], autoWeeklyReset: true, botId, enabled: true, guildId, logChannelId: null, timezone: DEFAULT_TIMEZONE, updatedAt: now, updatedBy: null };
}

function defaultHistorySettings(botId: string | null, guildId: string): MongoCourseHistorySettings {
  const now = new Date();
  return { _id: "", botId, enabled: true, guildId, logChannelId: null, removeRoleIds: [], retentionDays: null, updatedAt: now, updatedBy: null, viewRoleIds: [] };
}

function mapInstructorSettings(settings: MongoCourseInstructorSettings) {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    authorizedRoleIds: settings.authorizedRoleIds ?? [],
    logChannelId: settings.logChannelId ?? null,
    autoWeeklyReset: settings.autoWeeklyReset !== false,
    timezone: settings.timezone || DEFAULT_TIMEZONE,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy ?? null
  };
}

function mapHistorySettings(settings: MongoCourseHistorySettings) {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    viewRoleIds: settings.viewRoleIds ?? [],
    removeRoleIds: settings.removeRoleIds ?? [],
    logChannelId: settings.logChannelId ?? null,
    retentionDays: settings.retentionDays ?? null,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy ?? null
  };
}

function mapInstructorEvent(event: MongoCourseInstructorEvent) {
  return { ...event, createdAt: event.createdAt.toISOString(), timestamp: event.timestamp.toISOString(), updatedAt: event.updatedAt.toISOString() };
}

function mapStudentHistory(item: MongoCourseStudentHistory) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    removedAt: item.removedAt?.toISOString() ?? null,
    timestamp: item.timestamp.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

function instructorStatusLabel(status: MongoCourseInstructorEvent["status"]) {
  if (status === "started") return "Curso iniciado";
  if (status === "cancelled") return "Curso cancelado";
  if (status === "finished") return "Curso finalizado";
  return "Curso encerrado normalmente";
}

function scope(botId: string | null, guildId: string): Scope {
  return { botId, guildId };
}

function cleanIds(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => /^\d{5,32}$/.test(item)) : [];
}

function cleanNullable(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" }).format(date);
}

function formatTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}

function validTimezone(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function weekInfo(date: Date, timeZone: string) {
  const local = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" }).formatToParts(date);
  const year = Number(local.find((part) => part.type === "year")?.value ?? date.getUTCFullYear());
  const month = Number(local.find((part) => part.type === "month")?.value ?? 1);
  const day = Number(local.find((part) => part.type === "day")?.value ?? 1);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek);
  const weekYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { weekKey: `${weekYear}-W${String(weekNumber).padStart(2, "0")}`, weekNumber, year: weekYear };
}
