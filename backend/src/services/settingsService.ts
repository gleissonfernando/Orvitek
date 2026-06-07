import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoGuildSettings } from "../database/mongo";

export type GuildSettingsDto = {
  botId: string | null;
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
  welcomeMessage: string | null;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveDisplayChannelId: string | null;
  leaveImageUrl: string | null;
  leaveMessage: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  logChannelId: string | null;
  moderationEnabled: boolean;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds: string[];
};

export type PersistedDashboardAccess = {
  botId: string;
  guildId: string;
  enabled: boolean;
  roleIds: string[];
};

const memorySettings = new Map<string, GuildSettingsDto>();
const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";
export const DEFAULT_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, a nossa comunidade de lives.",
  "Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
export const DEFAULT_LEAVE_MESSAGE = [
  "Ate mais, {user}. Obrigado por ter feito parte da nossa comunidade de lives.",
  "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera."
].join("\n");
const LEGACY_WELCOME_MESSAGE = "Bem-vindo(a), {user}!";
const LEGACY_LEAVE_MESSAGE = "Ate mais, {user}.";
export const MAX_AUTOMATIC_ROLES = 2;

export function defaultSettings(guildId: string, botId: string | null = null): GuildSettingsDto {
  return {
    botId,
    guildId,
    welcomeEnabled: true,
    welcomeChannelId: null,
    welcomeDisplayChannelId: null,
    welcomeImageUrl: DEFAULT_WELCOME_IMAGE_URL,
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    leaveEnabled: true,
    leaveChannelId: null,
    leaveDisplayChannelId: null,
    leaveImageUrl: DEFAULT_WELCOME_IMAGE_URL,
    leaveMessage: DEFAULT_LEAVE_MESSAGE,
    autoRoleEnabled: false,
    autoRoleIds: [],
    twitchRoleId: null,
    boosterRoleId: null,
    ticketEnabled: true,
    ticketCategoryId: null,
    logChannelId: null,
    moderationEnabled: true,
    verificationEnabled: false,
    verificationRoleId: null,
    verificationRoleIds: []
  };
}

export async function getGuildSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { guildSettings } = await getMongoCollections();
    const settings = await guildSettings.findOne(settingsQuery(guildId, normalizedBotId));

    if (settings) {
      return toDto(settings);
    }
  } catch (error) {
    console.warn("[mongo] usando settings em memoria:", error instanceof Error ? error.message : error);
  }

  return memorySettings.get(settingsKey(guildId, normalizedBotId)) ?? defaultSettings(guildId, normalizedBotId);
}

export async function getPersistedDashboardAccess(
  guildId: string,
  botId: string
): Promise<PersistedDashboardAccess | null> {
  const normalizedBotId = normalizeBotId(botId);

  if (!normalizedBotId) {
    return null;
  }

  const { guildSettings } = await getMongoCollections();
  const settings = await guildSettings.findOne(
    {
      botId: normalizedBotId,
      guildId
    },
    {
      projection: {
        botId: 1,
        guildId: 1,
        verificationEnabled: 1,
        verificationRoleId: 1,
        verificationRoleIds: 1
      }
    }
  );

  if (!settings) {
    return null;
  }

  const roleIds = normalizeRoleIds(
    Array.isArray(settings.verificationRoleIds) && settings.verificationRoleIds.length
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );

  return {
    botId: normalizedBotId,
    guildId,
    enabled: settings.verificationEnabled === true,
    roleIds
  };
}

export async function updateGuildSettings(guildId: string, input: Partial<GuildSettingsDto>, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getGuildSettings(guildId, normalizedBotId);
  const autoRoleIds = "autoRoleIds" in input
    ? normalizeRoleIds(input.autoRoleIds ?? []).slice(0, MAX_AUTOMATIC_ROLES)
    : current.autoRoleIds;
  const verificationRoleIds = "verificationRoleIds" in input
    ? normalizeRoleIds(input.verificationRoleIds ?? [])
    : "verificationRoleId" in input
      ? normalizeRoleIds(input.verificationRoleId ? [input.verificationRoleId] : [])
      : current.verificationRoleIds;
  const next = normalizeVerificationRoles({
    ...current,
    ...input,
    autoRoleIds,
    welcomeMessage: normalizePanelMessage(
      "welcomeMessage" in input ? input.welcomeMessage : current.welcomeMessage,
      DEFAULT_WELCOME_MESSAGE,
      LEGACY_WELCOME_MESSAGE
    ),
    leaveMessage: normalizePanelMessage(
      "leaveMessage" in input ? input.leaveMessage : current.leaveMessage,
      DEFAULT_LEAVE_MESSAGE,
      LEGACY_LEAVE_MESSAGE
    ),
    verificationRoleIds,
    botId: normalizedBotId,
    guildId
  });

  try {
    await ensureGuild(guildId);

    const { guildSettings } = await getMongoCollections();
    await guildSettings.updateOne(
      {
        botId: normalizedBotId,
        guildId
      },
      {
        $set: {
          botId: normalizedBotId,
          guildId,
          welcomeEnabled: next.welcomeEnabled,
          welcomeChannelId: next.welcomeChannelId,
          welcomeDisplayChannelId: next.welcomeDisplayChannelId,
          welcomeImageUrl: next.welcomeImageUrl,
          welcomeMessage: next.welcomeMessage,
          leaveEnabled: next.leaveEnabled,
          leaveChannelId: next.leaveChannelId,
          leaveDisplayChannelId: next.leaveDisplayChannelId,
          leaveImageUrl: next.leaveImageUrl,
          leaveMessage: next.leaveMessage,
          autoRoleEnabled: next.autoRoleEnabled,
          autoRoleIds: next.autoRoleIds,
          twitchRoleId: next.twitchRoleId,
          boosterRoleId: next.boosterRoleId,
          ticketEnabled: next.ticketEnabled,
          ticketCategoryId: next.ticketCategoryId,
          logChannelId: next.logChannelId,
          moderationEnabled: next.moderationEnabled,
          verificationEnabled: next.verificationEnabled,
          verificationRoleId: next.verificationRoleId,
          verificationRoleIds: next.verificationRoleIds,
          updatedAt: new Date()
        },
        $setOnInsert: {
          _id: randomUUID()
        }
      },
      {
        upsert: true
      }
    );
  } catch (error) {
    console.error("[mongo] nao foi possivel persistir settings:", error);
    throw createSettingsPersistenceError(error);
  }

  memorySettings.set(settingsKey(guildId, normalizedBotId), next);
  return next;
}

function toDto(settings: MongoGuildSettings): GuildSettingsDto {
  const botId = normalizeBotId(settings.botId);
  const defaults = defaultSettings(settings.guildId, botId);
  const verificationRoleIds = normalizeRoleIds(
    Array.isArray(settings.verificationRoleIds)
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );

  return normalizeVerificationRoles({
    botId,
    guildId: settings.guildId,
    welcomeEnabled: settings.welcomeEnabled,
    welcomeChannelId: settings.welcomeChannelId,
    welcomeDisplayChannelId: settings.welcomeDisplayChannelId ?? null,
    welcomeImageUrl: normalizeWelcomeImageUrl(settings.welcomeImageUrl),
    welcomeMessage: normalizePanelMessage(
      settings.welcomeMessage,
      DEFAULT_WELCOME_MESSAGE,
      LEGACY_WELCOME_MESSAGE
    ),
    leaveEnabled: settings.leaveEnabled ?? defaults.leaveEnabled,
    leaveChannelId: settings.leaveChannelId ?? defaults.leaveChannelId,
    leaveDisplayChannelId: settings.leaveDisplayChannelId ?? defaults.leaveDisplayChannelId,
    leaveImageUrl: normalizeWelcomeImageUrl(settings.leaveImageUrl ?? defaults.leaveImageUrl),
    leaveMessage: normalizePanelMessage(
      settings.leaveMessage,
      DEFAULT_LEAVE_MESSAGE,
      LEGACY_LEAVE_MESSAGE
    ),
    autoRoleEnabled: settings.autoRoleEnabled,
    autoRoleIds: normalizeRoleIds(settings.autoRoleIds ?? []).slice(0, MAX_AUTOMATIC_ROLES),
    twitchRoleId: settings.twitchRoleId,
    boosterRoleId: settings.boosterRoleId,
    ticketEnabled: settings.ticketEnabled,
    ticketCategoryId: settings.ticketCategoryId,
    logChannelId: settings.logChannelId,
    moderationEnabled: settings.moderationEnabled,
    verificationEnabled: settings.verificationEnabled,
    verificationRoleId: verificationRoleIds[0] ?? null,
    verificationRoleIds
  });
}

function normalizeVerificationRoles(settings: GuildSettingsDto): GuildSettingsDto {
  const verificationRoleIds = normalizeRoleIds(
    settings.verificationRoleIds.length
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );

  return {
    ...settings,
    verificationRoleId: verificationRoleIds[0] ?? null,
    verificationRoleIds
  };
}

function normalizeRoleIds(roleIds: string[]) {
  return [...new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean))];
}

function createSettingsPersistenceError(cause: unknown) {
  return Object.assign(new Error("Nao foi possivel salvar a configuracao no banco de dados. Tente novamente."), {
    cause,
    statusCode: 503
  });
}

function normalizeWelcomeImageUrl(value: string | null | undefined) {
  return !value || value === "/uploads/welcome/default.gif" ? DEFAULT_WELCOME_IMAGE_URL : value;
}

function normalizePanelMessage(value: string | null | undefined, fallback: string, legacyValue: string) {
  const normalized = value?.trim();
  return !normalized || normalized === legacyValue ? fallback : normalized;
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function settingsKey(guildId: string, botId: string | null) {
  return `${botId ?? "default"}:${guildId}`;
}

function settingsQuery(guildId: string, botId: string | null) {
  if (botId) {
    return {
      guildId,
      botId
    };
  }

  return {
    guildId,
    $or: [
      {
        botId: null
      },
      {
        botId: {
          $exists: false
        }
      }
    ]
  };
}
