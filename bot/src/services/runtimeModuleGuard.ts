import { currentRuntimeBotId, env } from "../config/env";
import type { BotContext } from "../types";
import type { BotRuntimeModuleAuthorization } from "./apiClient";

type CachedAuthorization = {
  authorization: BotRuntimeModuleAuthorization;
  expiresAt: number;
};

const AUTHORIZATION_CACHE_MS = 15_000;
const authorizationCache = new Map<string, CachedAuthorization>();
const authorizationRequests = new Map<string, Promise<boolean>>();

export async function isRuntimeModuleAuthorized(context: BotContext, guildId: string, moduleId: string) {
  const botId = currentRuntimeBotId();

  if (!botId) {
    return false;
  }

  const key = runtimeModuleCacheKey(botId, guildId, moduleId);
  const cached = authorizationCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.authorization.allowed;
  }

  const pending = authorizationRequests.get(key);

  if (pending) {
    return pending;
  }

  const request = context.api.authorizeRuntimeModule(guildId, moduleId)
    .then((authorization) => {
      if (authorization.botId && authorization.botId !== botId) {
        return false;
      }

      authorizationCache.set(key, {
        authorization,
        expiresAt: Date.now() + AUTHORIZATION_CACHE_MS
      });
      return authorization.allowed;
    })
    .catch((error) => {
      console.warn(
        `[runtime] modulo ${moduleId} bloqueado em ${guildId}:`,
        error instanceof Error ? error.message : error
      );
      authorizationCache.delete(key);
      return false;
    })
    .finally(() => {
      if (authorizationRequests.get(key) === request) {
        authorizationRequests.delete(key);
      }
    });

  authorizationRequests.set(key, request);
  return request;
}

export function clearRuntimeModuleAuthorization(guildId?: string | null, moduleId?: string | null) {
  const botId = currentRuntimeBotId();

  if (!botId) {
    authorizationCache.clear();
    authorizationRequests.clear();
    return;
  }

  const prefix = guildId ? `${botId}:${guildId}:` : `${botId}:`;

  for (const key of authorizationCache.keys()) {
    if (key.startsWith(prefix) && (!moduleId || key.endsWith(`:${moduleId}`))) {
      authorizationCache.delete(key);
    }
  }

  for (const key of authorizationRequests.keys()) {
    if (key.startsWith(prefix) && (!moduleId || key.endsWith(`:${moduleId}`))) {
      authorizationRequests.delete(key);
    }
  }
}

export function runtimeScopeKey(...parts: Array<string | null | undefined>) {
  const botId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID.trim()) || "unknown";
  return [botId, ...parts].join(":");
}

function runtimeModuleCacheKey(botId: string, guildId: string, moduleId: string) {
  return `${botId}:${guildId}:${moduleId.trim().toLowerCase()}`;
}
