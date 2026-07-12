import type { Guild } from "discord.js";

export function resolveComponentEmoji(guild: Guild | null | undefined, value: string, fallback: string) {
  const normalized = value.trim();
  if (!normalized) return fallback;

  if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{5,32}>$/.test(normalized)) {
    return normalized;
  }

  if (/^[a-zA-Z0-9_]{2,32}$/.test(normalized)) {
    const emoji = guild?.emojis.cache.find((item) => item.name === normalized);
    return emoji ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : fallback;
  }

  return normalized;
}
