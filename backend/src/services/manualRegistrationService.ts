import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoManualRegistrationSettings, type MongoManualRegistrationSubmission } from "../database/mongo";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

export type ManualRegistrationFieldDto = {
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  name: string;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type ManualRegistrationSettingsDto = {
  approvalChannelId: string | null;
  autoRoleIds: string[];
  bannerPosition: "top" | "bottom" | "none";
  botId: string | null;
  color: string;
  description: string | null;
  enabled: boolean;
  emoji: string | null;
  fields: ManualRegistrationFieldDto[];
  footerText: string | null;
  guildId: string;
  name: string;
  panelImage: PanelImageSettingsDto | null;
  removeRoleIds: string[];
  thumbnailUrl: string | null;
  title: string;
  updatedAt: string | null;
};

export type ManualRegistrationSubmissionDto = {
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string | null;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  messageId: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  status: "pending" | "approved" | "rejected";
  updatedAt: string;
  userAvatar: string | null;
  userId: string;
  username: string;
};

export type SaveManualRegistrationSettingsInput = Partial<Omit<ManualRegistrationSettingsDto, "botId" | "guildId" | "updatedAt">>;

const DEFAULT_FIELDS: ManualRegistrationFieldDto[] = [
  { id: "nome", label: "Nome", maxLength: 80, minLength: 2, name: "nome", placeholder: "Seu nome", required: true, style: "short" },
  { id: "idade", label: "Idade", maxLength: 3, minLength: 1, name: "idade", placeholder: "Sua idade", required: true, style: "short" },
  { id: "id_fivem", label: "ID do FiveM", maxLength: 32, minLength: 1, name: "id_fivem", placeholder: "Seu ID", required: true, style: "short" },
  { id: "experiencia", label: "Conte sobre voce", maxLength: 1000, minLength: 10, name: "experiencia", placeholder: "Explique seu objetivo no servidor", required: true, style: "paragraph" }
];

export function defaultManualRegistrationSettings(guildId: string, botId: string | null = null): ManualRegistrationSettingsDto {
  return {
    approvalChannelId: null,
    autoRoleIds: [],
    bannerPosition: "top",
    botId,
    color: "#7c3aed",
    description: "Preencha o cadastro abaixo. A equipe vai analisar suas respostas e retornar em breve.",
    enabled: false,
    emoji: "📝",
    fields: DEFAULT_FIELDS.map((field) => ({ ...field })),
    footerText: "Cadastro enviado para analise da equipe.",
    guildId,
    name: "Cadastro Manual",
    panelImage: null,
    removeRoleIds: [],
    thumbnailUrl: null,
    title: "Cadastro Manual",
    updatedAt: null
  };
}

export async function getManualRegistrationSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { manualRegistrationSettings } = await getMongoCollections();
  const settings = await manualRegistrationSettings.findOne(scopeQuery(guildId, normalizedBotId));
  const dto = settings ? toSettingsDto(settings) : defaultManualRegistrationSettings(guildId, normalizedBotId);
  return withPanelImage(dto);
}

export async function saveManualRegistrationSettings(
  guildId: string,
  botId: string | null,
  input: SaveManualRegistrationSettingsInput,
  actorId: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getManualRegistrationSettings(guildId, normalizedBotId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId });
  const now = new Date();
  const { manualRegistrationSettings } = await getMongoCollections();

  await ensureGuild(guildId);
  await manualRegistrationSettings.updateOne(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: {
        ...next,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID()
      }
    },
    { upsert: true }
  );

  return getManualRegistrationSettings(guildId, normalizedBotId);
}

export async function createManualRegistrationSubmission(input: {
  botId?: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  messageId?: string | null;
  userAvatar?: string | null;
  userId: string;
  username: string;
}) {
  const now = new Date();
  const normalizedBotId = normalizeBotId(input.botId);
  const submission: MongoManualRegistrationSubmission = {
    _id: randomUUID(),
    approvedAt: null,
    approvedBy: null,
    botId: normalizedBotId,
    createdAt: now,
    fields: input.fields.map((field) => ({
      id: field.id,
      label: field.label.slice(0, 100),
      value: field.value.slice(0, 1500)
    })),
    guildId: input.guildId,
    messageId: input.messageId ?? null,
    rejectedAt: null,
    rejectedBy: null,
    status: "pending",
    updatedAt: now,
    userAvatar: input.userAvatar ?? null,
    userId: input.userId,
    username: input.username
  };
  const { manualRegistrationSubmissions } = await getMongoCollections();

  await ensureGuild(input.guildId);
  await manualRegistrationSubmissions.insertOne(submission);
  return toSubmissionDto(submission);
}

export async function updateManualRegistrationSubmissionMessage(id: string, botId: string | null, messageId: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  await manualRegistrationSubmissions.updateOne(
    { _id: id, botId: normalizeBotId(botId) },
    { $set: { messageId, updatedAt: new Date() } }
  );
}

export async function updateManualRegistrationSubmissionStatus(input: {
  actorId: string;
  botId?: string | null;
  id: string;
  status: "approved" | "rejected";
}) {
  const now = new Date();
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const update = input.status === "approved"
    ? { status: input.status, approvedAt: now, approvedBy: input.actorId, rejectedAt: null, rejectedBy: null, updatedAt: now }
    : { status: input.status, rejectedAt: now, rejectedBy: input.actorId, approvedAt: null, approvedBy: null, updatedAt: now };
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, botId: normalizeBotId(input.botId) },
    { $set: update },
    { returnDocument: "after" }
  );

  if (!saved) {
    throw Object.assign(new Error("Solicitacao nao encontrada."), { statusCode: 404 });
  }

  return toSubmissionDto(saved);
}

export async function listManualRegistrationSubmissions(guildId: string, botId?: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const rows = await manualRegistrationSubmissions
    .find(scopeQuery(guildId, normalizeBotId(botId)))
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return rows.map(toSubmissionDto);
}

function normalizeSettings(settings: ManualRegistrationSettingsDto): ManualRegistrationSettingsDto {
  return {
    ...settings,
    approvalChannelId: normalizeSnowflake(settings.approvalChannelId),
    autoRoleIds: normalizeSnowflakes(settings.autoRoleIds).slice(0, 20),
    bannerPosition: ["top", "bottom", "none"].includes(settings.bannerPosition) ? settings.bannerPosition : "top",
    color: /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : "#7c3aed",
    description: normalizeText(settings.description, 1200),
    emoji: normalizeText(settings.emoji, 80),
    fields: normalizeFields(settings.fields),
    footerText: normalizeText(settings.footerText, 180),
    name: normalizeText(settings.name, 80) || "Cadastro Manual",
    panelImage: settings.panelImage ?? null,
    removeRoleIds: normalizeSnowflakes(settings.removeRoleIds).slice(0, 20),
    thumbnailUrl: normalizeUrl(settings.thumbnailUrl),
    title: normalizeText(settings.title, 120) || "Cadastro Manual"
  };
}

function normalizeFields(fields: ManualRegistrationFieldDto[]) {
  const items = Array.isArray(fields) ? fields : [];
  const normalized = items.map((field, index) => {
    const label = normalizeText(field.label, 80) || `Campo ${index + 1}`;
    const id = normalizeText(field.id, 80) || slug(label) || `campo-${index + 1}`;
    return {
      id,
      label,
      maxLength: clamp(field.maxLength, 1, 1500),
      minLength: clamp(field.minLength, 0, 1500),
      name: normalizeText(field.name, 80) || id,
      placeholder: normalizeText(field.placeholder, 100),
      required: field.required !== false,
      style: field.style === "paragraph" ? "paragraph" as const : "short" as const
    };
  }).filter((field) => field.label).slice(0, 25);

  return normalized.length ? normalized : DEFAULT_FIELDS.map((field) => ({ ...field }));
}

function toSettingsDto(settings: MongoManualRegistrationSettings): ManualRegistrationSettingsDto {
  return normalizeSettings({
    approvalChannelId: settings.approvalChannelId,
    autoRoleIds: settings.autoRoleIds ?? [],
    bannerPosition: settings.bannerPosition ?? "top",
    botId: normalizeBotId(settings.botId),
    color: settings.color ?? "#7c3aed",
    description: settings.description,
    enabled: settings.enabled === true,
    emoji: settings.emoji,
    fields: (settings.fields ?? []) as ManualRegistrationFieldDto[],
    footerText: settings.footerText,
    guildId: settings.guildId,
    name: settings.name,
    panelImage: null,
    removeRoleIds: settings.removeRoleIds ?? [],
    thumbnailUrl: settings.thumbnailUrl,
    title: settings.title,
    updatedAt: settings.updatedAt?.toISOString() ?? null
  });
}

async function withPanelImage(settings: ManualRegistrationSettingsDto): Promise<ManualRegistrationSettingsDto> {
  if (!settings.botId) return settings;
  const panelImage = await getPanelImageSettings(settings.guildId, settings.botId, "manual-registration").catch(() => null);
  return {
    ...settings,
    panelImage: panelImage?.imageEnabled ? panelImage : null
  };
}

function toSubmissionDto(submission: MongoManualRegistrationSubmission): ManualRegistrationSubmissionDto {
  return {
    approvedAt: submission.approvedAt?.toISOString() ?? null,
    approvedBy: submission.approvedBy ?? null,
    botId: normalizeBotId(submission.botId),
    createdAt: submission.createdAt.toISOString(),
    fields: submission.fields,
    guildId: submission.guildId,
    id: submission._id,
    messageId: submission.messageId ?? null,
    rejectedAt: submission.rejectedAt?.toISOString() ?? null,
    rejectedBy: submission.rejectedBy ?? null,
    status: submission.status,
    updatedAt: submission.updatedAt.toISOString(),
    userAvatar: submission.userAvatar ?? null,
    userId: submission.userId,
    username: submission.username
  };
}

function scopeQuery(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = normalizeText(value, 2048);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? normalized : null;
  } catch {
    return normalized.startsWith("/uploads/") ? normalized : null;
  }
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set((values ?? []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))];
}

function clamp(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
