import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import axios from "axios";
import { env } from "../config/env";
import { getMongoCollections, type MongoBotGuildConfig, type MongoDevBot, type MongoDevBotStatus } from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";
import { getDiscordAvatarUrl } from "./discordAssetService";

const DISCORD_API = "https://discord.com/api/v10";

export const DEV_MODULES = [
  { id: "live", label: "Sistema de Live" },
  { id: "clips", label: "Sistema de Clipes" },
  { id: "avisos", label: "Sistema de Avisos" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "noc_magnatas", label: "Sistema de NOC Magnatas" },
  { id: "maintenance", label: "Sistema de Manutencao" },
  { id: "bot_api", label: "Sistema de API do Bot" }
] as const;

const DEV_MODULE_IDS = new Set(DEV_MODULES.map((module) => module.id));

type DiscordBotUser = {
  id: string;
  username: string;
  avatar: string | null;
};

export type DevBotDto = {
  id: string;
  name: string;
  clientId: string;
  tokenMasked: string;
  secretConfigured: boolean;
  avatarUrl: string | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  status: MongoDevBotStatus;
  statusMessage: string | null;
  enabledModules: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type CreateDevBotInput = {
  name: string;
  clientId: string;
  token: string;
  secret?: string | null;
  avatarUrl?: string | null;
  ownerName: string;
  ownerId: string;
  mainGuildId: string;
  enabledModules: string[];
  createdBy: string;
};

type UpdateDevBotInput = Partial<Omit<CreateDevBotInput, "createdBy" | "token">> & {
  token?: string;
};

export async function listDevBots() {
  const { devBots } = await getMongoCollections();
  const bots = await devBots.find().sort({ createdAt: -1 }).toArray();

  return bots.map(toDevBotDto);
}

export async function listAccessibleDevBots(user: AuthSessionUser) {
  if (user.authorized) {
    return listDevBots();
  }

  const { devBots } = await getMongoCollections();
  const bots = await devBots
    .find({
      $or: [
        {
          ownerId: user.discordId
        },
        {
          createdBy: user.discordId
        }
      ]
    })
    .sort({ createdAt: -1 })
    .toArray();

  return bots.map(toDevBotDto);
}

export async function userHasAccessibleDevBot(user: AuthSessionUser) {
  if (user.authorized) {
    return true;
  }

  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      $or: [
        {
          ownerId: user.discordId
        },
        {
          createdBy: user.discordId
        }
      ]
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function getDevBot(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  return bot ? toDevBotDto(bot) : null;
}

export async function canManageDevBot(user: AuthSessionUser, botId: string) {
  if (user.authorized) {
    return true;
  }

  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      _id: botId,
      $or: [
        {
          ownerId: user.discordId
        },
        {
          createdBy: user.discordId
        }
      ]
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function canManageDevBotGuild(user: AuthSessionUser, botId: string | null, guildId: string) {
  if (!botId) {
    return false;
  }

  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return false;
  }

  if (!user.authorized && bot.ownerId !== user.discordId && bot.createdBy !== user.discordId) {
    return false;
  }

  if (bot.mainGuildId === guildId) {
    return true;
  }

  const config = await botGuildConfigs.findOne(
    {
      botId,
      guildId
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(config);
}

export async function createDevBot(input: CreateDevBotInput) {
  const { devBots } = await getMongoCollections();
  const now = new Date();
  const connection = await testDiscordBotToken(input.token);
  const bot: MongoDevBot = {
    _id: randomUUID(),
    name: input.name,
    clientId: input.clientId,
    tokenEncrypted: encryptSecret(input.token),
    secretEncrypted: input.secret ? encryptSecret(input.secret) : null,
    avatarUrl: input.avatarUrl || connection.avatarUrl,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    mainGuildId: input.mainGuildId,
    status: connection.status,
    statusMessage: connection.message,
    enabledModules: sanitizeModules(input.enabledModules),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  };

  await devBots.insertOne(bot);
  emitRealtime("dev:bot_created", toDevBotDto(bot));

  return toDevBotDto(bot);
}

export async function updateDevBot(botId: string, input: UpdateDevBotInput) {
  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne({ _id: botId });

  if (!current) {
    return null;
  }

  const $set: Partial<MongoDevBot> = {
    updatedAt: new Date()
  };

  if (input.name !== undefined) $set.name = input.name;
  if (input.clientId !== undefined) $set.clientId = input.clientId;
  if (input.secret !== undefined) $set.secretEncrypted = input.secret ? encryptSecret(input.secret) : null;
  if (input.avatarUrl !== undefined) $set.avatarUrl = input.avatarUrl;
  if (input.ownerName !== undefined) $set.ownerName = input.ownerName;
  if (input.ownerId !== undefined) $set.ownerId = input.ownerId;
  if (input.mainGuildId !== undefined) $set.mainGuildId = input.mainGuildId;
  if (input.enabledModules !== undefined) $set.enabledModules = sanitizeModules(input.enabledModules);

  if (input.token) {
    const connection = await testDiscordBotToken(input.token);
    $set.tokenEncrypted = encryptSecret(input.token);
    $set.status = connection.status;
    $set.statusMessage = connection.message;
    $set.avatarUrl = input.avatarUrl || connection.avatarUrl || current.avatarUrl;
  }

  await devBots.updateOne({ _id: botId }, { $set });
  const updated = await devBots.findOne({ _id: botId });

  if (!updated) {
    return null;
  }

  emitRealtime("dev:bot_updated", toDevBotDto(updated));
  return toDevBotDto(updated);
}

export async function deleteDevBot(botId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return null;
  }

  await Promise.all([
    devBots.deleteOne({ _id: botId }),
    botGuildConfigs.deleteMany({ botId })
  ]);

  const dto = toDevBotDto(bot);
  emitRealtime("dev:bot_deleted", dto);
  return dto;
}

export async function updateDevBotModules(botId: string, enabledModules: string[]) {
  const bot = await updateDevBot(botId, {
    enabledModules
  });

  if (bot) {
    emitRealtime("dev:module_updated", {
      type: "MODULE_UPDATED",
      botId,
      enabledModules: bot.enabledModules
    });
  }

  return bot;
}

export async function restartDevBot(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return null;
  }

  const connection = await testDiscordBotToken(decryptSecret(bot.tokenEncrypted));

  await devBots.updateOne(
    { _id: botId },
    {
      $set: {
        status: connection.status,
        statusMessage: connection.message,
        avatarUrl: connection.avatarUrl ?? bot.avatarUrl,
        updatedAt: new Date()
      }
    }
  );

  const updated = await devBots.findOne({ _id: botId });
  const dto = updated ? toDevBotDto(updated) : toDevBotDto(bot);
  emitRealtime("dev:bot_restarted", dto);

  return dto;
}

export async function testDiscordBotToken(token: string) {
  if (!token.trim()) {
    return {
      status: "invalid_token" as const,
      message: "Token invalido.",
      avatarUrl: null
    };
  }

  try {
    const { data } = await axios.get<DiscordBotUser>(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bot ${token.trim()}`
      },
      timeout: 3500
    });

    return {
      status: "online" as const,
      message: `Bot conectado como ${data.username}.`,
      avatarUrl: getDiscordAvatarUrl(data.id, data.avatar, "bot")
    };
  } catch (error) {
    const status = axios.isAxiosError(error) && error.response?.status === 401 ? "invalid_token" : "error";

    return {
      status: status as MongoDevBotStatus,
      message: status === "invalid_token" ? "Token invalido. Verifique os dados do bot." : "Erro ao conectar com a API do Discord.",
      avatarUrl: null
    };
  }
}

export async function listBotGuildConfigs(botId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const configs = await botGuildConfigs.find({ botId }).sort({ updatedAt: -1 }).toArray();

  return configs.map(toBotGuildConfigDto);
}

export async function getBotGuildConfig(botId: string, guildId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const config = await botGuildConfigs.findOne({ botId, guildId });

  return config ? toBotGuildConfigDto(config) : defaultBotGuildConfig(botId, guildId);
}

export async function updateBotGuildConfig(input: {
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, Record<string, unknown>>;
}) {
  const { botGuildConfigs } = await getMongoCollections();
  const now = new Date();

  await botGuildConfigs.updateOne(
    {
      botId: input.botId,
      guildId: input.guildId
    },
    {
      $set: {
        guildName: input.guildName,
        modules: input.modules,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        botId: input.botId,
        guildId: input.guildId,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );

  const config = await botGuildConfigs.findOne({
    botId: input.botId,
    guildId: input.guildId
  });
  const dto = config ? toBotGuildConfigDto(config) : defaultBotGuildConfig(input.botId, input.guildId);

  emitRealtime("dev:config_updated", {
    type: "CONFIG_UPDATED",
    botId: input.botId,
    guildId: input.guildId
  });

  return dto;
}

export async function getBotApiPermissions(botId: string) {
  const bot = await getDevBot(botId);

  if (!bot) {
    return null;
  }

  return {
    botId: bot.id,
    enabledModules: bot.enabledModules,
    status: bot.status
  };
}

function sanitizeModules(modules: string[]) {
  return [...new Set(modules.filter((module) => DEV_MODULE_IDS.has(module as (typeof DEV_MODULES)[number]["id"])))];
}

function toDevBotDto(bot: MongoDevBot): DevBotDto {
  return {
    id: bot._id,
    name: bot.name,
    clientId: bot.clientId,
    tokenMasked: bot.tokenEncrypted ? "******** protegido" : "",
    secretConfigured: Boolean(bot.secretEncrypted),
    avatarUrl: bot.avatarUrl ?? null,
    ownerId: bot.ownerId,
    ownerName: bot.ownerName,
    mainGuildId: bot.mainGuildId,
    status: bot.status,
    statusMessage: bot.statusMessage ?? null,
    enabledModules: bot.enabledModules,
    createdBy: bot.createdBy,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString()
  };
}

function toBotGuildConfigDto(config: MongoBotGuildConfig) {
  return {
    id: config._id,
    botId: config.botId,
    guildId: config.guildId,
    guildName: config.guildName,
    modules: config.modules,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function defaultBotGuildConfig(botId: string, guildId: string) {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    guildName: `Servidor ${guildId}`,
    modules: {},
    createdAt: now,
    updatedAt: now
  };
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Token protegido invalido.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  return createHash("sha256").update(env.JWT_SECRET || env.SESSION_SECRET).digest();
}
