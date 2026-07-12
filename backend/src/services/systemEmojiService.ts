import { getMongoCollections, type MongoSystemEmoji } from "../database/mongo";
import {
  isSystemEmojiKey,
  SYSTEM_EMOJI_BY_KEY,
  SYSTEM_EMOJIS,
  type SystemEmojiKey
} from "../config/systemEmojis";

export type SystemEmojiDto = {
  key: SystemEmojiKey;
  name: string;
  emojiId: string | null;
  animated: boolean;
  sourceGuildId: string | null;
  enabled: boolean;
  fallback: string;
  scope: "global" | "bot" | "default";
  botId: string | null;
  preview: string;
  found: boolean;
  missing: boolean;
  updatedAt: string | null;
  lastFoundAt: string | null;
  lastMissingAt: string | null;
  lastValidatedAt: string | null;
  label: string;
  description: string;
};

export type SystemEmojiDashboard = {
  botId: string | null;
  definitions: typeof SYSTEM_EMOJIS;
  emojis: SystemEmojiDto[];
  summary: {
    total: number;
    configured: number;
    found: number;
    missing: number;
    disabled: number;
    fallbacks: number;
  };
};

type UpdateSystemEmojiInput = {
  animated?: boolean;
  emojiId?: string | null;
  enabled?: boolean;
  fallback?: string | null;
  name?: string | null;
  sourceGuildId?: string | null;
};

type ValidationInput = {
  botId: string | null;
  emojis: Array<{
    key: string;
    name?: string | null;
    emojiId?: string | null;
    animated?: boolean;
    found: boolean;
    sourceGuildId?: string | null;
  }>;
};

export async function getSystemEmojiDashboard(botId?: string | null): Promise<SystemEmojiDashboard> {
  const emojis = await listSystemEmojis(botId ?? null);
  const summary = {
    total: emojis.length,
    configured: emojis.filter((item) => Boolean(item.emojiId)).length,
    found: emojis.filter((item) => item.found).length,
    missing: emojis.filter((item) => item.missing).length,
    disabled: emojis.filter((item) => !item.enabled).length,
    fallbacks: emojis.filter((item) => !item.emojiId || item.missing || !item.enabled).length
  };

  return {
    botId: botId ?? null,
    definitions: SYSTEM_EMOJIS,
    emojis,
    summary
  };
}

export async function getSystemEmojiRuntimeConfig(botId?: string | null) {
  const dashboard = await getSystemEmojiDashboard(botId ?? null);

  return {
    botId: botId ?? null,
    definitions: dashboard.definitions,
    emojis: dashboard.emojis.map((item) => ({
      key: item.key,
      name: item.name,
      emojiId: item.emojiId,
      animated: item.animated,
      sourceGuildId: item.sourceGuildId,
      enabled: item.enabled,
      fallback: item.fallback,
      scope: item.scope
    }))
  };
}

export async function updateSystemEmojiConfig(key: string, input: UpdateSystemEmojiInput, actorId: string | null, botId?: string | null) {
  if (!isSystemEmojiKey(key)) {
    throw new Error("Emoji do sistema invalido.");
  }

  const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
  const now = new Date();
  const normalizedBotId = normalizeBotId(botId);
  const name = normalizeEmojiName(input.name ?? definition.name);
  const emojiId = normalizeSnowflake(input.emojiId ?? null);
  const sourceGuildId = normalizeSnowflake(input.sourceGuildId ?? null);
  const fallback = normalizeFallback(input.fallback ?? definition.fallback, definition.fallback);
  const { systemEmojis } = await getMongoCollections();

  await systemEmojis.updateOne(
    { botId: normalizedBotId, key },
    {
      $set: {
        animated: Boolean(input.animated),
        botId: normalizedBotId,
        emojiId,
        enabled: input.enabled ?? true,
        fallback,
        key,
        name,
        sourceGuildId,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: documentId(normalizedBotId, key),
        createdAt: now
      }
    },
    { upsert: true }
  );

  return getSystemEmojiDashboard(normalizedBotId);
}

export async function resetSystemEmojiConfig(key: string, botId?: string | null) {
  if (!isSystemEmojiKey(key)) {
    throw new Error("Emoji do sistema invalido.");
  }

  const normalizedBotId = normalizeBotId(botId);
  const { systemEmojis } = await getMongoCollections();
  await systemEmojis.deleteOne({ botId: normalizedBotId, key });
  return getSystemEmojiDashboard(normalizedBotId);
}

export async function ensureSystemEmojiDefaults(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  return getSystemEmojiDashboard(normalizedBotId);
}

export async function recordSystemEmojiValidation(input: ValidationInput) {
  const normalizedBotId = normalizeBotId(input.botId);
  const now = new Date();
  const { systemEmojis } = await getMongoCollections();
  const operations = input.emojis
    .filter((item) => isSystemEmojiKey(item.key))
    .map((item) => {
      const key = item.key as SystemEmojiKey;
      const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
      const foundUpdate = item.found ? { lastFoundAt: now, lastMissingAt: null } : { lastMissingAt: now };

      return systemEmojis.updateOne(
        { botId: normalizedBotId, key },
        {
          $set: {
            animated: Boolean(item.animated),
            botId: normalizedBotId,
            enabled: true,
            fallback: definition.fallback,
            key,
            lastValidatedAt: now,
            lastValidationBotId: normalizedBotId,
            name: normalizeEmojiName(item.name || definition.name),
            sourceGuildId: normalizeSnowflake(item.sourceGuildId ?? null),
            updatedAt: now,
            updatedBy: "bot-runtime",
            ...(item.emojiId ? { emojiId: normalizeSnowflake(item.emojiId) } : {}),
            ...foundUpdate
          },
          $setOnInsert: {
            _id: documentId(normalizedBotId, key),
            createdAt: now
          }
        },
        { upsert: true }
      );
    });

  await Promise.all(operations);
  return getSystemEmojiDashboard(normalizedBotId);
}

async function listSystemEmojis(botId: string | null) {
  const { systemEmojis } = await getMongoCollections();
  const docs = await systemEmojis.find({ botId: { $in: [null, botId].filter((item) => item !== undefined) as Array<string | null> } }).toArray();
  const globalDocs = new Map(docs.filter((item) => item.botId === null).map((item) => [item.key, item]));
  const botDocs = new Map(docs.filter((item) => item.botId === botId && botId !== null).map((item) => [item.key, item]));

  return SYSTEM_EMOJIS.map((definition) => {
    const doc = (botDocs.get(definition.key) ?? globalDocs.get(definition.key) ?? null) as MongoSystemEmoji | null;
    return toDto(definition.key, doc, botId);
  });
}

function toDto(key: SystemEmojiKey, doc: MongoSystemEmoji | null, requestedBotId: string | null): SystemEmojiDto {
  const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
  const name = doc?.name || definition.name;
  const emojiId = doc?.emojiId || null;
  const enabled = doc?.enabled ?? true;
  const lastMissingAt = doc?.lastMissingAt ?? null;
  const lastFoundAt = doc?.lastFoundAt ?? null;
  const missing = enabled && Boolean(emojiId) && lastMissingAt !== null && (!lastFoundAt || lastMissingAt > lastFoundAt);

  return {
    key,
    name,
    emojiId,
    animated: doc?.animated ?? false,
    sourceGuildId: doc?.sourceGuildId ?? null,
    enabled,
    fallback: doc?.fallback || definition.fallback,
    scope: doc ? (doc.botId ? "bot" : "global") : "default",
    botId: doc?.botId ?? requestedBotId,
    preview: emojiId && enabled ? `<${doc?.animated ? "a" : ""}:${name}:${emojiId}>` : (doc?.fallback || definition.fallback),
    found: Boolean(enabled && emojiId && lastFoundAt && !missing),
    missing,
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
    lastFoundAt: lastFoundAt ? lastFoundAt.toISOString() : null,
    lastMissingAt: lastMissingAt ? lastMissingAt.toISOString() : null,
    lastValidatedAt: doc?.lastValidatedAt ? doc.lastValidatedAt.toISOString() : null,
    label: definition.label,
    description: definition.description
  };
}

function normalizeBotId(botId?: string | null) {
  const value = (botId ?? "").trim();
  return value || null;
}

function normalizeEmojiName(value: string) {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(normalized)) {
    throw new Error("Nome de emoji invalido.");
  }
  return normalized;
}

function normalizeSnowflake(value?: string | null) {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  if (!/^\d{5,32}$/.test(normalized)) {
    throw new Error("ID de emoji/servidor invalido.");
  }
  return normalized;
}

function normalizeFallback(value: string | null, defaultValue: string) {
  const normalized = (value ?? "").trim();
  return normalized.slice(0, 16) || defaultValue;
}

function documentId(botId: string | null, key: string) {
  return `${botId ?? "global"}:${key}`;
}
