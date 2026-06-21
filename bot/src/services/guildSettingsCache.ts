import { currentRuntimeBotId } from "../config/env";
import type { BotContext, GuildSettings } from "../types";
import { runtimeScopeKey } from "./runtimeModuleGuard";

type CachedSettings = {
  expiresAt: number;
  settings: GuildSettings;
};

const SETTINGS_CACHE_MS = 30_000;
const settingsCache = new Map<string, CachedSettings>();
const settingsRequests = new Map<string, Promise<GuildSettings>>();
let serviceStarted = false;

export function startGuildSettingsCache(context: BotContext) {
  if (serviceStarted) {
    return;
  }

  serviceStarted = true;
  context.socket.onSettingsUpdated((settings) => {
    if (!settingsBelongsToRuntime(settings)) {
      return;
    }

    setCachedGuildSettings(settings);
  });
}

export async function getCachedGuildSettings(
  context: BotContext,
  guildId: string,
  discordBotClientId?: string | null
) {
  const key = settingsCacheKey(guildId);
  const cached = settingsCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  const pending = settingsRequests.get(key);

  if (pending) {
    return pending;
  }

  const request = context.api.getSettings(guildId, discordBotClientId)
    .then((settings) => {
      setCachedGuildSettings(settings);
      return settings;
    })
    .finally(() => {
      if (settingsRequests.get(key) === request) {
        settingsRequests.delete(key);
      }
    });

  settingsRequests.set(key, request);
  return request;
}

export async function getFreshGuildSettings(
  context: BotContext,
  guildId: string,
  discordBotClientId?: string | null
) {
  const key = settingsCacheKey(guildId);
  settingsRequests.delete(key);

  const settings = await context.api.getSettings(guildId, discordBotClientId);
  setCachedGuildSettings(settings);
  return settings;
}

export function clearCachedGuildSettings(guildId?: string | null) {
  if (!guildId) {
    settingsCache.clear();
    settingsRequests.clear();
    return;
  }

  const key = settingsCacheKey(guildId);
  settingsCache.delete(key);
  settingsRequests.delete(key);
}

function setCachedGuildSettings(settings: GuildSettings) {
  settingsCache.set(settingsCacheKey(settings.guildId), {
    expiresAt: Date.now() + SETTINGS_CACHE_MS,
    settings
  });
}

function settingsBelongsToRuntime(settings: GuildSettings) {
  const botId = currentRuntimeBotId();

  if (botId) {
    return settings.botId === botId;
  }

  return !settings.botId;
}

function settingsCacheKey(guildId: string) {
  return runtimeScopeKey(guildId, "settings");
}
