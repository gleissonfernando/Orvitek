import { randomBytes, randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import {
  getMongoCollections,
  type MongoNexTechInvite,
  type MongoNexTechInviteLog,
  type MongoNexTechInviteStatus
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";

export type NexTechInviteDto = Omit<MongoNexTechInvite, "_id" | "createdAt" | "expiresAt" | "updatedAt" | "usages"> & {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  remainingUses: number | null;
  usages: Array<Omit<MongoNexTechInvite["usages"][number], "usedAt"> & { usedAt: string }>;
  updatedAt: string;
};

export type NexTechInviteLogDto = Omit<MongoNexTechInviteLog, "_id" | "createdAt"> & {
  createdAt: string;
  id: string;
};

export type NexTechInviteDashboardDto = {
  invites: NexTechInviteDto[];
  logs: NexTechInviteLogDto[];
  stats: {
    active: number;
    cancelled: number;
    expired: number;
    paused: number;
    remainingUses: number;
    totalUses: number;
  };
};

export type SaveNexTechInviteInput = {
  clientName: string;
  code?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
  name: string;
  notes?: string | null;
  status?: MongoNexTechInviteStatus;
};

type Actor = {
  id: string | null;
  name: string | null;
};

export async function getNexTechInviteDashboard(): Promise<NexTechInviteDashboardDto> {
  await expireDueInvites();
  const collections = await getMongoCollections();
  const [invites, logs] = await Promise.all([
    collections.nexTechInvites.find({}).sort({ createdAt: -1 }).limit(250).toArray(),
    collections.nexTechInviteLogs.find({}).sort({ createdAt: -1 }).limit(80).toArray()
  ]);
  const inviteDtos = invites.map(inviteDto);
  return {
    invites: inviteDtos,
    logs: logs.map(logDto),
    stats: {
      active: inviteDtos.filter((invite) => invite.status === "active").length,
      cancelled: inviteDtos.filter((invite) => invite.status === "cancelled").length,
      expired: inviteDtos.filter((invite) => invite.status === "expired").length,
      paused: inviteDtos.filter((invite) => invite.status === "paused").length,
      remainingUses: inviteDtos.reduce((total, invite) => total + (invite.remainingUses ?? 0), 0),
      totalUses: inviteDtos.reduce((total, invite) => total + invite.usedCount, 0)
    }
  };
}

export async function generateNexTechInviteCode() {
  const collections = await getMongoCollections();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `NEXTECH-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(1).toString("hex").toUpperCase()}`;
    const exists = await collections.nexTechInvites.findOne({ code }, { projection: { _id: 1 } });
    if (!exists) return code;
  }
  return `NEXTECH-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createNexTechInvite(input: SaveNexTechInviteInput, actor: Actor) {
  const collections = await getMongoCollections();
  const now = new Date();
  const invite: MongoNexTechInvite = {
    _id: randomUUID(),
    clientName: normalizeText(input.clientName, 120),
    code: normalizeInviteCode(input.code) || await generateNexTechInviteCode(),
    createdAt: now,
    createdBy: actor.id,
    expiresAt: normalizeOptionalDate(input.expiresAt),
    maxUses: normalizeMaxUses(input.maxUses),
    name: normalizeText(input.name, 120),
    notes: normalizeNullableText(input.notes, 800),
    status: input.status ?? "active",
    updatedAt: now,
    updatedBy: actor.id,
    usages: [],
    usedCount: 0
  };

  if (!invite.name) throw Object.assign(new Error("Informe o nome do convite."), { statusCode: 400 });
  if (!invite.clientName) throw Object.assign(new Error("Informe o cliente responsável."), { statusCode: 400 });
  if (!invite.code) throw Object.assign(new Error("Informe um código válido."), { statusCode: 400 });

  try {
    await collections.nexTechInvites.insertOne(invite);
  } catch (error) {
    if (isDuplicateKey(error)) throw Object.assign(new Error("Já existe um convite com esse código."), { statusCode: 409 });
    throw error;
  }

  await createInviteLog("invite.created", actor, invite, { status: invite.status });
  await emitDashboardUpdated();
  return inviteDto(invite);
}

export async function updateNexTechInvite(inviteId: string, input: Partial<SaveNexTechInviteInput>, actor: Actor) {
  const collections = await getMongoCollections();
  const current = await collections.nexTechInvites.findOne({ _id: inviteId });
  if (!current) throw Object.assign(new Error("Convite não encontrado."), { statusCode: 404 });

  const patch: Partial<MongoNexTechInvite> = {
    updatedAt: new Date(),
    updatedBy: actor.id
  };
  if (input.clientName !== undefined) patch.clientName = normalizeText(input.clientName, 120);
  if (input.code !== undefined) patch.code = normalizeInviteCode(input.code);
  if (input.expiresAt !== undefined) patch.expiresAt = normalizeOptionalDate(input.expiresAt);
  if (input.maxUses !== undefined) patch.maxUses = normalizeMaxUses(input.maxUses);
  if (input.name !== undefined) patch.name = normalizeText(input.name, 120);
  if (input.notes !== undefined) patch.notes = normalizeNullableText(input.notes, 800);
  if (input.status !== undefined) patch.status = input.status;

  if (patch.name !== undefined && !patch.name) throw Object.assign(new Error("Informe o nome do convite."), { statusCode: 400 });
  if (patch.clientName !== undefined && !patch.clientName) throw Object.assign(new Error("Informe o cliente responsável."), { statusCode: 400 });
  if (patch.code !== undefined && !patch.code) throw Object.assign(new Error("Informe um código válido."), { statusCode: 400 });

  try {
    const value = await collections.nexTechInvites.findOneAndUpdate(
      { _id: inviteId },
      { $set: patch },
      { returnDocument: "after" }
    );
    if (!value) throw Object.assign(new Error("Convite não encontrado."), { statusCode: 404 });
    await createInviteLog("invite.updated", actor, value, { changed: Object.keys(input) });
    await emitDashboardUpdated();
    return inviteDto(value);
  } catch (error) {
    if (isDuplicateKey(error)) throw Object.assign(new Error("Já existe um convite com esse código."), { statusCode: 409 });
    throw error;
  }
}

export async function deleteNexTechInvite(inviteId: string, actor: Actor) {
  const collections = await getMongoCollections();
  const current = await collections.nexTechInvites.findOne({ _id: inviteId });
  if (!current) throw Object.assign(new Error("Convite não encontrado."), { statusCode: 404 });
  await collections.nexTechInvites.deleteOne({ _id: inviteId });
  await createInviteLog("invite.deleted", actor, current, {});
  await emitDashboardUpdated();
  return inviteDto(current);
}

async function expireDueInvites() {
  const collections = await getMongoCollections();
  await collections.nexTechInvites.updateMany(
    {
      expiresAt: { $lte: new Date() },
      status: { $in: ["active", "paused"] }
    } satisfies Filter<MongoNexTechInvite>,
    {
      $set: {
        status: "expired",
        updatedAt: new Date()
      }
    }
  );
}

async function createInviteLog(action: string, actor: Actor, invite: MongoNexTechInvite, data: Record<string, unknown>) {
  const collections = await getMongoCollections();
  const log: MongoNexTechInviteLog = {
    _id: randomUUID(),
    action,
    actorId: actor.id,
    actorName: actor.name,
    createdAt: new Date(),
    data,
    guildId: null,
    guildName: null,
    inviteCode: invite.code,
    inviteId: invite._id
  };
  await collections.nexTechInviteLogs.insertOne(log);
}

async function emitDashboardUpdated() {
  emitRealtime("nextech-invites:updated", await getNexTechInviteDashboard());
}

function inviteDto(invite: MongoNexTechInvite): NexTechInviteDto {
  return {
    clientName: invite.clientName,
    code: invite.code,
    createdAt: invite.createdAt.toISOString(),
    createdBy: invite.createdBy,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    id: invite._id,
    maxUses: invite.maxUses,
    name: invite.name,
    notes: invite.notes,
    remainingUses: invite.maxUses === null ? null : Math.max(invite.maxUses - invite.usedCount, 0),
    status: invite.status,
    updatedAt: invite.updatedAt.toISOString(),
    updatedBy: invite.updatedBy,
    usages: invite.usages.map((usage) => ({ ...usage, usedAt: usage.usedAt.toISOString() })),
    usedCount: invite.usedCount
  };
}

function logDto(log: MongoNexTechInviteLog): NexTechInviteLogDto {
  return {
    action: log.action,
    actorId: log.actorId,
    actorName: log.actorName,
    createdAt: log.createdAt.toISOString(),
    data: log.data,
    guildId: log.guildId,
    guildName: log.guildName,
    id: log._id,
    inviteCode: log.inviteCode,
    inviteId: log.inviteId
  };
}

function normalizeInviteCode(value: string | null | undefined) {
  return normalizeText(value ?? "", 80).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function normalizeMaxUses(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.trunc(value), 1), 100000);
}

function normalizeNullableText(value: string | null | undefined, max: number) {
  const normalized = normalizeText(value ?? "", max);
  return normalized || null;
}

function normalizeOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function isDuplicateKey(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}
