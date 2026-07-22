import type { Guild, GuildEmoji } from "discord.js";

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

  const customEmoji = normalized.match(/^<(a?):([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/);
  if (customEmoji) {
    const animatedFlag = customEmoji[1] ?? "";
    const name = customEmoji[2] ?? "";
    const id = customEmoji[3] ?? "";
    const byId = guild?.emojis.cache.get(id);
    if (byId && isGuildEmojiUsable(byId)) {
      return emojiMarkdown(byId);
    }

    const byName = findGuildEmojiByName(guild, name);
    if (byName) {
      return emojiMarkdown(byName);
    }

    return `<${animatedFlag}:${name}:${id}>`;
  }

  const namedEmoji = normalized.match(/^:([a-zA-Z0-9_]{2,32}):$/)?.[1] ?? normalized;

  if (/^[a-zA-Z0-9_]{2,32}$/.test(namedEmoji)) {
    const emoji = findGuildEmojiByName(guild, namedEmoji);
    return emoji ? emojiMarkdown(emoji) : fallback;
  }

  return normalized;
}

function findGuildEmojiByName(guild: Guild | null | undefined, name: string) {
  if (!guild) return null;
  const exact = guild.emojis.cache.find((emoji) => emoji.name === name && isGuildEmojiUsable(emoji));
  if (exact) return exact;

  const normalizedName = name.toLowerCase();
  return guild.emojis.cache.find((emoji) => emoji.name?.toLowerCase() === normalizedName && isGuildEmojiUsable(emoji)) ?? null;
}

function isGuildEmojiUsable(emoji: GuildEmoji) {
  if (emoji.available === false) return false;
  if (!emoji.roles.cache.size) return true;
  const botMember = emoji.guild.members.me;
  return Boolean(botMember && emoji.roles.cache.some((role) => botMember.roles.cache.has(role.id)));
}

function emojiMarkdown(emoji: GuildEmoji) {
  const name = (emoji.name ?? "emoji").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32) || "emoji";
  return `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`;
}
