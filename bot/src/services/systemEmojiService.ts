import type { Client, Guild } from "discord.js";
import { SYSTEM_EMOJI_BY_KEY, SYSTEM_EMOJIS, type SystemEmojiKey } from "../config/systemEmojis";
import type { BotContext } from "../types";
import { ensureGuildEmojiCache } from "../utils/componentEmoji";

type RuntimeEmoji = {
  key: string;
  name: string;
  emojiId: string | null;
  animated: boolean;
  sourceGuildId: string | null;
  enabled: boolean;
  fallback: string;
};

const runtimeEmojis = new Map<string, RuntimeEmoji>();

export async function refreshSystemEmojis(context: BotContext) {
  const config = await context.api.getSystemEmojis();
  runtimeEmojis.clear();

  for (const item of config.emojis) {
    runtimeEmojis.set(item.key, item);
  }

  return config;
}

export async function validateSystemEmojisOnStartup(client: Client<true>, context: BotContext) {
  let config;

  try {
    config = await refreshSystemEmojis(context);
  } catch (error) {
    console.warn("[system-emojis] nao foi possivel carregar configuracao; usando fallbacks:", error instanceof Error ? error.message : error);
    config = {
      botId: null,
      definitions: SYSTEM_EMOJIS,
      emojis: SYSTEM_EMOJIS.map((item) => ({
        key: item.key,
        name: item.name,
        emojiId: null,
        animated: false,
        sourceGuildId: null,
        enabled: true,
        fallback: item.fallback
      }))
    };
  }

  await Promise.all([...client.guilds.cache.values()].map((guild) => ensureGuildEmojiCache(guild)));

  const validations = config.emojis.map((item) => {
    const resolved = findEmoji(client, null, item);
    return {
      key: item.key,
      name: item.name,
      emojiId: resolved?.id ?? item.emojiId,
      animated: resolved?.animated ?? item.animated,
      found: Boolean(item.enabled && resolved),
      sourceGuildId: resolved?.guild?.id ?? item.sourceGuildId
    };
  });

  const found = validations.filter((item) => item.found).length;
  const missing = validations.length - found;
  console.log(`[system-emojis] validacao concluida: ${found} encontrado(s), ${missing} fallback(s).`);

  try {
    await context.api.reportSystemEmojiValidation({ emojis: validations });
  } catch (error) {
    console.warn("[system-emojis] nao foi possivel registrar validacao:", error instanceof Error ? error.message : error);
  }
}

export function systemEmojiText(key: SystemEmojiKey, guild?: Guild | null, client?: Client | null) {
  const emoji = runtimeEmoji(key);
  const resolved = client ? findEmoji(client, guild ?? null, emoji) : findGuildEmoji(guild ?? null, emoji);

  if (emoji.enabled && resolved) {
    return `<${resolved.animated ? "a" : ""}:${resolved.name}:${resolved.id}>`;
  }

  if (emoji.enabled && emoji.emojiId) {
    return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.emojiId}>`;
  }

  return emoji.fallback;
}

export function systemComponentEmoji(key: SystemEmojiKey, guild?: Guild | null, client?: Client | null) {
  return systemEmojiText(key, guild, client);
}

export function systemActionEmoji(action: "open" | "close" | "save" | "edit" | "approve" | "reject" | "pay" | "settings" | "link" | "help", guild?: Guild | null, client?: Client | null) {
  const keyByAction: Record<typeof action, SystemEmojiKey> = {
    approve: "visto",
    close: "porta",
    edit: "prancheta_caneta",
    help: "interrogacao",
    link: "link",
    open: "acessar",
    pay: "dinheiro",
    reject: "exclamacao",
    save: "prancheta_acertos",
    settings: "engrenagem"
  };

  return systemComponentEmoji(keyByAction[action], guild, client);
}

export function systemStatusEmoji(status: "success" | "warning" | "danger" | "active" | "pending" | "offline", guild?: Guild | null, client?: Client | null) {
  const keyByStatus: Record<typeof status, SystemEmojiKey> = {
    active: "liga",
    danger: "perigo",
    offline: "porta",
    pending: "relogio",
    success: "visto",
    warning: "exclamacao"
  };

  return systemEmojiText(keyByStatus[status], guild, client);
}

function runtimeEmoji(key: SystemEmojiKey): RuntimeEmoji {
  const configured = runtimeEmojis.get(key);
  if (configured) return configured;

  const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
  return {
    key,
    name: definition.name,
    emojiId: null,
    animated: false,
    sourceGuildId: null,
    enabled: true,
    fallback: definition.fallback
  };
}

function findEmoji(client: Client, guild: Guild | null, item: RuntimeEmoji) {
  if (!item.enabled) return null;

  if (item.emojiId) {
    const fromClient = client.emojis.cache.get(item.emojiId);
    if (fromClient) return fromClient;
    const fromGuild = guild?.emojis.cache.get(item.emojiId);
    if (fromGuild) return fromGuild;
  }

  const sourceGuild = item.sourceGuildId ? client.guilds.cache.get(item.sourceGuildId) : null;
  return (
    sourceGuild?.emojis.cache.find((emoji) => emoji.name === item.name) ??
    guild?.emojis.cache.find((emoji) => emoji.name === item.name) ??
    client.emojis.cache.find((emoji) => emoji.name === item.name) ??
    null
  );
}

function findGuildEmoji(guild: Guild | null, item: RuntimeEmoji) {
  if (!item.enabled || !guild) return null;
  if (item.emojiId) return guild.emojis.cache.get(item.emojiId) ?? null;
  return guild.emojis.cache.find((emoji) => emoji.name === item.name) ?? null;
}
