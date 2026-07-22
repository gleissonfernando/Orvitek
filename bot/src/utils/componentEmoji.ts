import type { Guild } from "discord.js";

const emojiFetchCache = new Map<string, number>();
const EMOJI_FETCH_TTL_MS = 60_000;

export async function ensureGuildEmojiCache(guild: Guild | null | undefined) {
  if (!guild) return;

  const lastFetch = emojiFetchCache.get(guild.id) ?? 0;
  if (Date.now() - lastFetch < EMOJI_FETCH_TTL_MS && guild.emojis.cache.size > 0) {
    return;
  }

  await guild.emojis.fetch().then(() => {
    emojiFetchCache.set(guild.id, Date.now());
  }).catch(() => undefined);
}

export function resolveComponentEmoji(guild: Guild | null | undefined, value: string, fallback: string) {
  const normalized = value.trim();
  if (!normalized) return fallback;

  if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{5,32}>$/.test(normalized)) {
    return normalized;
  }

  const namedEmoji = normalized.match(/^:([a-zA-Z0-9_]{2,32}):$/)?.[1] ?? normalized;

  if (/^[a-zA-Z0-9_]{2,32}$/.test(namedEmoji)) {
    const emoji = guild?.emojis.cache.find((item) => item.name === namedEmoji);
    return emoji ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : fallback;
  }

  return normalized;
}
