import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoSelfBotProtectionIncident,
  type MongoSelfBotProtectionModuleId,
  type MongoSelfBotProtectionSettings,
  type MongoSelfBotPunishmentAction
} from "../database/mongo";

export type SelfBotProtectionModuleId = MongoSelfBotProtectionModuleId;
export type SelfBotPunishmentAction = MongoSelfBotPunishmentAction;

export type SelfBotProtectionSettingsDto = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  moduleToggles: Record<SelfBotProtectionModuleId, boolean>;
  ignoredChannelIds: string[];
  protectedChannelIds: string[];
  mediaChannelIds: string[];
  linkChannelIds: string[];
  logChannelId: string | null;
  punishmentLogChannelId: string | null;
  logWebhookUrl: string | null;
  embedColor: string;
  punishmentSequence: SelfBotPunishmentAction[];
  addRoleId: string | null;
  removeRoleId: string | null;
  timeoutSeconds: number;
  floodLimit: number;
  floodWindowSeconds: number;
  imageLimit: number;
  imageWindowSeconds: number;
  mentionLimit: number;
  emojiLimit: number;
  capsMinLength: number;
  capsPercentage: number;
  repeatedTextLimit: number;
  repeatedTextWindowSeconds: number;
  multiChannelLimit: number;
  multiChannelWindowSeconds: number;
  raidJoinLimit: number;
  raidWindowSeconds: number;
  newAccountMaxAgeHours: number;
  suspiciousDomains: string[];
  blockedTerms: string[];
  createdAt: string;
  updatedAt: string;
};

export type SelfBotProtectionIncidentDto = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  channelId: string | null;
  messageId: string | null;
  messageContent: string | null;
  moduleId: SelfBotProtectionModuleId;
  infractionType: string;
  punishmentActions: SelfBotPunishmentAction[];
  punishmentSucceeded: boolean;
  punishmentError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SelfBotProtectionStatsDto = {
  blockedSpam: number;
  removedImages: number;
  blockedLinks: number;
  punishedUsers: number;
  infractionsToday: number;
  infractionsWeek: number;
  infractionsMonth: number;
  byModule: Array<{
    moduleId: SelfBotProtectionModuleId;
    total: number;
  }>;
  daily: Array<{
    label: string;
    value: number;
  }>;
};

export type SelfBotProtectionDashboardDto = {
  incidents: SelfBotProtectionIncidentDto[];
  settings: SelfBotProtectionSettingsDto;
  stats: SelfBotProtectionStatsDto;
};

export type SaveSelfBotProtectionSettingsInput = Partial<Omit<
  SelfBotProtectionSettingsDto,
  "id" | "botId" | "guildId" | "createdAt" | "updatedAt" | "moduleToggles"
>> & {
  moduleToggles?: Partial<Record<SelfBotProtectionModuleId, boolean>>;
};

export type RecordSelfBotProtectionIncidentInput = {
  botId: string;
  guildId: string;
  userId: string;
  username?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  messageContent?: string | null;
  moduleId: SelfBotProtectionModuleId;
  infractionType: string;
  punishmentActions: SelfBotPunishmentAction[];
  punishmentSucceeded: boolean;
  punishmentError?: string | null;
  metadata?: Record<string, unknown>;
};

export const SELF_BOT_PROTECTION_MODULES: Array<{
  id: SelfBotProtectionModuleId;
  label: string;
}> = [
  { id: "anti-spam", label: "Anti Spam" },
  { id: "anti-flood", label: "Anti Flood" },
  { id: "anti-imagens", label: "Anti-Spam de Imagens" },
  { id: "anti-gif", label: "Anti GIF" },
  { id: "anti-mencoes", label: "Anti Mencoes" },
  { id: "anti-emojis", label: "Anti Emojis" },
  { id: "anti-convites", label: "Anti Convites" },
  { id: "anti-links", label: "Anti-Flood de Links" },
  { id: "anti-scam", label: "Anti Scam" },
  { id: "anti-raid", label: "Anti Raid" },
  { id: "anti-caps-lock", label: "Anti Caps Lock" },
  { id: "anti-texto-repetido", label: "Anti Texto Repetido" },
  { id: "anti-copypasta", label: "Anti Copypasta" },
  { id: "anti-flood-multi-canais", label: "Anti Flood Multi-Canais" },
  { id: "anti-anexos", label: "Anti Anexos" },
  { id: "anti-webhook", label: "Anti Webhook" },
  { id: "anti-bots", label: "Anti Bots" },
  { id: "anti-contas-novas", label: "Anti Contas Novas" },
  { id: "anti-token-grabber", label: "Anti Token Grabber" },
  { id: "anti-phishing", label: "Anti Phishing" },
  { id: "anti-nitro-scam", label: "Anti Nitro Scam" },
  { id: "anti-mass-ping", label: "Anti Mass Ping" },
  { id: "anti-divulgacao", label: "Anti Divulgacao" },
  { id: "anti-auto-spam", label: "Anti Auto Spam" },
  { id: "anti-comandos-em-massa", label: "Anti Comandos em Massa" }
];

export const SELF_BOT_PUNISHMENT_ACTIONS: SelfBotPunishmentAction[] = [
  "delete_message",
  "warn",
  "log",
  "add_role",
  "timeout",
  "remove_role",
  "kick",
  "ban"
];

const moduleIds = SELF_BOT_PROTECTION_MODULES.map((module) => module.id);
const moduleIdSet = new Set<SelfBotProtectionModuleId>(moduleIds);
const punishmentActionSet = new Set<SelfBotPunishmentAction>(SELF_BOT_PUNISHMENT_ACTIONS);
const DEFAULT_EMBED_COLOR = "#7c3aed";
const DEFAULT_SUSPICIOUS_DOMAINS = [
  "discord-gift.com",
  "discord-nitro.com",
  "discordnitro",
  "discorcl",
  "dlscord",
  "steamcomminuty",
  "steamcommunlty",
  "robloxgift",
  "mercadopago-pix",
  "pix-premiado"
];
const DEFAULT_BLOCKED_TERMS = [
  "nitro gratis",
  "free nitro",
  "discord gift",
  "steam gift",
  "robux gratis",
  "pix dobrado",
  "mercado pago gratis",
  "token grabber"
];

export function defaultSelfBotProtectionSettings(guildId: string, botId: string): SelfBotProtectionSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    moduleToggles: defaultSafeBotModuleToggles(),
    ignoredChannelIds: [],
    protectedChannelIds: [],
    mediaChannelIds: [],
    linkChannelIds: [],
    logChannelId: null,
    punishmentLogChannelId: null,
    logWebhookUrl: null,
    embedColor: DEFAULT_EMBED_COLOR,
    punishmentSequence: ["delete_message", "log", "ban"] as SelfBotPunishmentAction[],
    addRoleId: null,
    removeRoleId: null,
    timeoutSeconds: 300,
    floodLimit: 5,
    floodWindowSeconds: 10,
    imageLimit: 3,
    imageWindowSeconds: 15,
    mentionLimit: 5,
    emojiLimit: 12,
    capsMinLength: 12,
    capsPercentage: 70,
    repeatedTextLimit: 3,
    repeatedTextWindowSeconds: 60,
    multiChannelLimit: 4,
    multiChannelWindowSeconds: 15,
    raidJoinLimit: 8,
    raidWindowSeconds: 30,
    newAccountMaxAgeHours: 72,
    suspiciousDomains: DEFAULT_SUSPICIOUS_DOMAINS,
    blockedTerms: DEFAULT_BLOCKED_TERMS,
    createdAt: now,
    updatedAt: now
  };
}

export async function getSelfBotProtectionDashboard(guildId: string, botId: string): Promise<SelfBotProtectionDashboardDto> {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const [settings, incidents, stats] = await Promise.all([
    getSelfBotProtectionSettings(guildId, botId),
    selfBotProtectionIncidents
      .find({ botId, guildId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
    getSelfBotProtectionStats(guildId, botId)
  ]);

  return {
    incidents: incidents.map(toIncidentDto),
    settings,
    stats
  };
}

export async function getSelfBotProtectionSettings(guildId: string, botId: string) {
  const { selfBotProtectionSettings } = await getMongoCollections();
  const settings = await selfBotProtectionSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultSelfBotProtectionSettings(guildId, botId);
}

export async function saveSelfBotProtectionSettings(
  guildId: string,
  botId: string,
  input: SaveSelfBotProtectionSettingsInput,
  actorId: string | null
) {
  const current = await getSelfBotProtectionSettings(guildId, botId);
  const now = new Date();
  const next = normalizeSettings({
    ...current,
    ...input,
    botId,
    guildId,
    moduleToggles: {
      ...current.moduleToggles,
      ...(input.moduleToggles ?? {})
    }
  });

  await ensureGuild(guildId);
  const { selfBotProtectionSettings } = await getMongoCollections();
  await selfBotProtectionSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        botId,
        guildId,
        enabled: next.enabled,
        moduleToggles: next.moduleToggles,
        ignoredChannelIds: next.ignoredChannelIds,
        protectedChannelIds: next.protectedChannelIds,
        mediaChannelIds: next.mediaChannelIds,
        linkChannelIds: next.linkChannelIds,
        logChannelId: next.logChannelId,
        punishmentLogChannelId: next.punishmentLogChannelId,
        logWebhookUrl: next.logWebhookUrl,
        embedColor: next.embedColor,
        punishmentSequence: next.punishmentSequence,
        addRoleId: next.addRoleId,
        removeRoleId: next.removeRoleId,
        timeoutSeconds: next.timeoutSeconds,
        floodLimit: next.floodLimit,
        floodWindowSeconds: next.floodWindowSeconds,
        imageLimit: next.imageLimit,
        imageWindowSeconds: next.imageWindowSeconds,
        mentionLimit: next.mentionLimit,
        emojiLimit: next.emojiLimit,
        capsMinLength: next.capsMinLength,
        capsPercentage: next.capsPercentage,
        repeatedTextLimit: next.repeatedTextLimit,
        repeatedTextWindowSeconds: next.repeatedTextWindowSeconds,
        multiChannelLimit: next.multiChannelLimit,
        multiChannelWindowSeconds: next.multiChannelWindowSeconds,
        raidJoinLimit: next.raidJoinLimit,
        raidWindowSeconds: next.raidWindowSeconds,
        newAccountMaxAgeHours: next.newAccountMaxAgeHours,
        suspiciousDomains: next.suspiciousDomains,
        blockedTerms: next.blockedTerms,
        updatedBy: actorId,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdBy: actorId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  return getSelfBotProtectionSettings(guildId, botId);
}

export async function recordSelfBotProtectionIncident(input: RecordSelfBotProtectionIncidentInput) {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const now = new Date();
  const incident: MongoSelfBotProtectionIncident = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    username: normalizeText(input.username, 120),
    channelId: normalizeSnowflake(input.channelId),
    messageId: normalizeSnowflake(input.messageId),
    messageContent: normalizeText(input.messageContent, 1900),
    moduleId: moduleIdSet.has(input.moduleId) ? input.moduleId : "anti-spam",
    infractionType: normalizeText(input.infractionType, 120) ?? input.moduleId,
    punishmentActions: normalizePunishmentSequence(input.punishmentActions),
    punishmentSucceeded: input.punishmentSucceeded,
    punishmentError: normalizeText(input.punishmentError, 500),
    metadata: input.metadata ?? {},
    createdAt: now
  };

  await selfBotProtectionIncidents.insertOne(incident);

  return toIncidentDto(incident);
}

export async function getSelfBotProtectionStats(guildId: string, botId: string): Promise<SelfBotProtectionStatsDto> {
  const { selfBotProtectionIncidents } = await getMongoCollections();
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const monthStart = new Date(now.getTime() - 30 * 86_400_000);
  const baseQuery = { botId, guildId };
  const [
    infractionsToday,
    infractionsWeek,
    infractionsMonth,
    blockedSpam,
    removedImages,
    blockedLinks,
    punishedUsers,
    byModule,
    daily
  ] = await Promise.all([
    selfBotProtectionIncidents.countDocuments({ ...baseQuery, createdAt: { $gte: todayStart } }),
    selfBotProtectionIncidents.countDocuments({ ...baseQuery, createdAt: { $gte: weekStart } }),
    selfBotProtectionIncidents.countDocuments({ ...baseQuery, createdAt: { $gte: monthStart } }),
    selfBotProtectionIncidents.countDocuments({
      ...baseQuery,
      moduleId: { $in: ["anti-spam", "anti-flood", "anti-texto-repetido", "anti-copypasta", "anti-auto-spam", "anti-flood-multi-canais"] }
    }),
    selfBotProtectionIncidents.countDocuments({
      ...baseQuery,
      moduleId: { $in: ["anti-imagens", "anti-gif", "anti-anexos"] }
    }),
    selfBotProtectionIncidents.countDocuments({
      ...baseQuery,
      moduleId: { $in: ["anti-links", "anti-convites", "anti-divulgacao", "anti-scam", "anti-phishing", "anti-token-grabber", "anti-nitro-scam"] }
    }),
    selfBotProtectionIncidents.distinct("userId", baseQuery),
    selfBotProtectionIncidents.aggregate<{ _id: SelfBotProtectionModuleId; total: number }>([
      { $match: baseQuery },
      { $group: { _id: "$moduleId", total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 12 }
    ]).toArray(),
    selfBotProtectionIncidents.aggregate<{ _id: string; total: number }>([
      { $match: { ...baseQuery, createdAt: { $gte: weekStart } } },
      {
        $group: {
          _id: {
            $dateToString: {
              date: "$createdAt",
              format: "%d/%m",
              timezone: "America/Sao_Paulo"
            }
          },
          total: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);

  return {
    blockedSpam,
    removedImages,
    blockedLinks,
    punishedUsers: punishedUsers.length,
    infractionsToday,
    infractionsWeek,
    infractionsMonth,
    byModule: byModule.map((entry) => ({
      moduleId: entry._id,
      total: entry.total
    })),
    daily: daily.map((entry) => ({
      label: entry._id,
      value: entry.total
    }))
  };
}

function toSettingsDto(settings: MongoSelfBotProtectionSettings): SelfBotProtectionSettingsDto {
  return normalizeSettings({
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    moduleToggles: {
      ...emptyModuleToggles(),
      ...(settings.moduleToggles ?? {})
    },
    ignoredChannelIds: settings.ignoredChannelIds ?? [],
    protectedChannelIds: settings.protectedChannelIds ?? [],
    mediaChannelIds: settings.mediaChannelIds ?? [],
    linkChannelIds: settings.linkChannelIds ?? [],
    logChannelId: settings.logChannelId,
    punishmentLogChannelId: settings.punishmentLogChannelId ?? null,
    logWebhookUrl: settings.logWebhookUrl,
    embedColor: settings.embedColor,
    punishmentSequence: settings.punishmentSequence ?? [],
    addRoleId: settings.addRoleId,
    removeRoleId: settings.removeRoleId,
    timeoutSeconds: settings.timeoutSeconds,
    floodLimit: settings.floodLimit,
    floodWindowSeconds: settings.floodWindowSeconds,
    imageLimit: settings.imageLimit,
    imageWindowSeconds: settings.imageWindowSeconds,
    mentionLimit: settings.mentionLimit,
    emojiLimit: settings.emojiLimit,
    capsMinLength: settings.capsMinLength,
    capsPercentage: settings.capsPercentage,
    repeatedTextLimit: settings.repeatedTextLimit,
    repeatedTextWindowSeconds: settings.repeatedTextWindowSeconds,
    multiChannelLimit: settings.multiChannelLimit,
    multiChannelWindowSeconds: settings.multiChannelWindowSeconds,
    raidJoinLimit: settings.raidJoinLimit,
    raidWindowSeconds: settings.raidWindowSeconds,
    newAccountMaxAgeHours: settings.newAccountMaxAgeHours,
    suspiciousDomains: settings.suspiciousDomains ?? [],
    blockedTerms: settings.blockedTerms ?? [],
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  });
}

function toIncidentDto(incident: MongoSelfBotProtectionIncident): SelfBotProtectionIncidentDto {
  return {
    id: incident._id,
    botId: incident.botId,
    guildId: incident.guildId,
    userId: incident.userId,
    username: incident.username,
    channelId: incident.channelId,
    messageId: incident.messageId,
    messageContent: incident.messageContent,
    moduleId: incident.moduleId,
    infractionType: incident.infractionType,
    punishmentActions: incident.punishmentActions ?? [],
    punishmentSucceeded: incident.punishmentSucceeded,
    punishmentError: incident.punishmentError,
    metadata: incident.metadata ?? {},
    createdAt: incident.createdAt.toISOString()
  };
}

function normalizeSettings(settings: SelfBotProtectionSettingsDto): SelfBotProtectionSettingsDto {
  const defaults = defaultSelfBotProtectionSettings(settings.guildId, settings.botId);

  return {
    ...defaults,
    ...settings,
    moduleToggles: normalizeModuleToggles(settings.moduleToggles),
    ignoredChannelIds: normalizeSnowflakes(settings.ignoredChannelIds),
    protectedChannelIds: normalizeSnowflakes(settings.protectedChannelIds),
    mediaChannelIds: normalizeSnowflakes(settings.mediaChannelIds),
    linkChannelIds: normalizeSnowflakes(settings.linkChannelIds),
    logChannelId: normalizeSnowflake(settings.logChannelId),
    punishmentLogChannelId: normalizeSnowflake(settings.punishmentLogChannelId),
    logWebhookUrl: normalizeWebhookUrl(settings.logWebhookUrl),
    embedColor: normalizeColor(settings.embedColor),
    punishmentSequence: normalizePunishmentSequence(settings.punishmentSequence),
    addRoleId: normalizeSnowflake(settings.addRoleId),
    removeRoleId: normalizeSnowflake(settings.removeRoleId),
    timeoutSeconds: clampInteger(settings.timeoutSeconds, 5, 2_419_200, defaults.timeoutSeconds),
    floodLimit: clampInteger(settings.floodLimit, 2, 50, defaults.floodLimit),
    floodWindowSeconds: clampInteger(settings.floodWindowSeconds, 1, 3_600, defaults.floodWindowSeconds),
    imageLimit: clampInteger(settings.imageLimit, 1, 50, defaults.imageLimit),
    imageWindowSeconds: clampInteger(settings.imageWindowSeconds, 1, 3_600, defaults.imageWindowSeconds),
    mentionLimit: clampInteger(settings.mentionLimit, 1, 100, defaults.mentionLimit),
    emojiLimit: clampInteger(settings.emojiLimit, 1, 200, defaults.emojiLimit),
    capsMinLength: clampInteger(settings.capsMinLength, 4, 500, defaults.capsMinLength),
    capsPercentage: clampInteger(settings.capsPercentage, 40, 100, defaults.capsPercentage),
    repeatedTextLimit: clampInteger(settings.repeatedTextLimit, 2, 25, defaults.repeatedTextLimit),
    repeatedTextWindowSeconds: clampInteger(settings.repeatedTextWindowSeconds, 1, 3_600, defaults.repeatedTextWindowSeconds),
    multiChannelLimit: clampInteger(settings.multiChannelLimit, 2, 100, defaults.multiChannelLimit),
    multiChannelWindowSeconds: clampInteger(settings.multiChannelWindowSeconds, 1, 3_600, defaults.multiChannelWindowSeconds),
    raidJoinLimit: clampInteger(settings.raidJoinLimit, 2, 500, defaults.raidJoinLimit),
    raidWindowSeconds: clampInteger(settings.raidWindowSeconds, 5, 3_600, defaults.raidWindowSeconds),
    newAccountMaxAgeHours: clampInteger(settings.newAccountMaxAgeHours, 1, 87_600, defaults.newAccountMaxAgeHours),
    suspiciousDomains: normalizeTextList(settings.suspiciousDomains, 250),
    blockedTerms: normalizeTextList(settings.blockedTerms, 250)
  };
}

function emptyModuleToggles(): Record<SelfBotProtectionModuleId, boolean> {
  return Object.fromEntries(moduleIds.map((moduleId) => [moduleId, false])) as Record<SelfBotProtectionModuleId, boolean>;
}

function defaultSafeBotModuleToggles(): Record<SelfBotProtectionModuleId, boolean> {
  return {
    ...emptyModuleToggles(),
    "anti-anexos": true,
    "anti-auto-spam": true,
    "anti-convites": true,
    "anti-flood": true,
    "anti-flood-multi-canais": true,
    "anti-gif": true,
    "anti-imagens": true,
    "anti-links": true,
    "anti-mencoes": true,
    "anti-spam": true,
    "anti-texto-repetido": true
  };
}

function normalizeModuleToggles(value: Partial<Record<SelfBotProtectionModuleId, boolean>> | undefined) {
  const normalized = emptyModuleToggles();

  for (const [moduleId, enabled] of Object.entries(value ?? {})) {
    if (moduleIdSet.has(moduleId as SelfBotProtectionModuleId)) {
      normalized[moduleId as SelfBotProtectionModuleId] = enabled === true;
    }
  }

  return normalized;
}

function normalizePunishmentSequence(value: readonly string[]) {
  const normalized = value.filter((action): action is SelfBotPunishmentAction => punishmentActionSet.has(action as SelfBotPunishmentAction));
  return normalized.length ? [...new Set(normalized)] : ["delete_message", "log", "ban"] as SelfBotPunishmentAction[];
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))];
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeTextList(values: string[], maxItems: number) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, maxItems);
}

function normalizeWebhookUrl(value: string | null | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,32}\/[-_a-zA-Z0-9]+/.test(normalized)
    ? normalized.slice(0, 500)
    : null;
}

function normalizeColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : DEFAULT_EMBED_COLOR;
}

function clampInteger(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(Number(value))));
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}
