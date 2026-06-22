import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoDashboardAuditLog } from "../database/mongo";

export type CreateDashboardAuditLogInput = {
  action: string;
  userId?: string | null;
  botId?: string | null;
  guildId?: string | null;
  dashboardSlug?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createDashboardAuditLog(input: CreateDashboardAuditLogInput) {
  const now = new Date();
  const doc: MongoDashboardAuditLog = {
    _id: randomUUID(),
    action: input.action,
    userId: normalizeNullable(input.userId),
    botId: normalizeNullable(input.botId),
    guildId: normalizeNullable(input.guildId),
    dashboardSlug: normalizeNullable(input.dashboardSlug),
    ip: normalizeNullable(input.ip),
    userAgent: normalizeNullable(input.userAgent),
    createdAt: now
  };

  if (input.metadata && Object.keys(input.metadata).length) {
    doc.metadata = sanitizeMetadata(input.metadata);
  }

  const { dashboardAuditLogs } = await getMongoCollections();
  await dashboardAuditLogs.insertOne(doc);

  return {
    id: doc._id,
    action: doc.action,
    userId: doc.userId,
    botId: doc.botId ?? null,
    guildId: doc.guildId ?? null,
    dashboardSlug: doc.dashboardSlug ?? null,
    ip: doc.ip ?? null,
    userAgent: doc.userAgent ?? null,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString()
  };
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function sanitizeMetadata(metadata: Record<string, unknown>) {
  const blockedKeys = new Set(["token", "accessToken", "refreshToken", "secret", "password"]);
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = blockedKeys.has(key) ? "[protected]" : value;
  }

  return sanitized;
}
