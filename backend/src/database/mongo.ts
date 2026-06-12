import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "../config/env";

export type MongoUser = {
  _id: string;
  discordId: string;
  username: string;
  globalName?: string | null;
  discriminator?: string | null;
  avatar: string | null;
  avatarUrl?: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  discordRoleIdsByGuild?: Record<string, string[]>;
  accessStatus?: "allowed" | "denied" | "pending";
  permissionLevel?: "admin" | "moderator" | "premium" | "basic" | "viewer";
  lastAccessSyncAt?: Date | null;
  selectedGuildId?: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGuild = {
  _id: string;
  name: string;
  icon: string | null;
  ownerId: string | null;
  botEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGuildSettings = {
  _id: string;
  botId?: string | null;
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId?: string | null;
  welcomeImageUrl?: string | null;
  welcomeTitle?: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle?: string | null;
  welcomeRules?: string | null;
  welcomeChannelLabel?: string | null;
  welcomeFooterText?: string | null;
  leaveEnabled?: boolean;
  leaveChannelId?: string | null;
  leaveDisplayChannelId?: string | null;
  leaveImageUrl?: string | null;
  leaveTitle?: string | null;
  leaveMessage?: string | null;
  leaveRulesTitle?: string | null;
  leaveRules?: string | null;
  leaveChannelLabel?: string | null;
  leaveFooterText?: string | null;
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
  verificationRoleIds?: string[];
  dashboardRolePermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  dashboardUserPermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  updatedAt: Date;
};

export type MongoTicket = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string | null;
  openerId: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: Date;
  closedAt: Date | null;
};

export type MongoLogEntry = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoSocialNotification = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId: string;
  createdBy?: string;
  updatedBy?: string | null;
  platform: "twitch" | "kick";
  twitchChannelName?: string | null;
  twitchChannelUrl?: string | null;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  kickChannelName?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickBanner?: string | null;
  kickFollowers?: number | null;
  kickVerified?: boolean | null;
  kickCategory?: string | null;
  discordChannelId: string;
  mentionRoleId: string | null;
  customMessage: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: Date | null;
  lastEndedAt?: Date | null;
  lastStreamId: string | null;
  lastMessageId: string | null;
  peakViewers?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSocialMember = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  discordId?: string | null;
  name: string;
  avatar: string | null;
  role?: string | null;
  twitter: string | null;
  instagram: string | null;
  twitch: string | null;
  youtube: string | null;
  tiktok: string | null;
  kick: string | null;
  facebook: string | null;
  website: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSocialPanel = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string | null;
  messageId: string | null;
  embedColor: string | null;
  published: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastPublishedAt?: Date | null;
};

export type MongoXAccount = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  lastPostId: string | null;
  lastPostAt: Date | null;
  lastApiStatus: "idle" | "ok" | "error";
  lastApiError: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoXPostSent = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  accountId: string;
  xPostId: string;
  xPostUrl: string;
  discordMessageId: string | null;
  sentAt: Date;
};

export type MongoClipMentionType = "none" | "everyone" | "role";

export type MongoClipsConfig = {
  _id: string;
  guildId: string;
  botId?: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName?: string | null;
  twitchAvatar?: string | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: MongoClipMentionType;
  mentionRoleId: string | null;
  embedColor: string | null;
  customMessage: string | null;
  checkInterval: number;
  lastCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoClipSent = {
  _id: string;
  guildId: string;
  botId?: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  createdAtTwitch: Date;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: Date;
};

export type MongoClipLog = {
  _id: string;
  guildId: string;
  botId?: string | null;
  action: string;
  userId: string | null;
  message: string;
  createdAt: Date;
};

export type MongoGiveawayStatus = "waiting" | "running" | "ended";

export type MongoGiveawayParticipant = {
  id: string;
  username: string;
  displayName: string;
  subscriber: boolean;
  source: "twitch";
  validatedAt: Date;
};

export type MongoGiveawayWinner = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: Date;
};

export type MongoGiveaway = {
  _id: string;
  botId?: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch";
  twitchBroadcasterId: string;
  prizeName: string;
  participants: MongoGiveawayParticipant[];
  winners: MongoGiveawayWinner[];
  status: MongoGiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  customMessage: string | null;
  schedulerError?: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
};

export type MongoFivemFacMessages = {
  panelTitle: string;
  panelDescription: string;
  requestCreated: string;
  approved: string;
  rejected: string;
  started: string;
  finished: string;
};

export type MongoFivemFacSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  absenceRoleId: string | null;
  viewerRoleIds: string[];
  approverRoleIds: string[];
  memberRoleIds?: string[];
  logChannelId: string | null;
  messages: MongoFivemFacMessages;
  lastPanelRequestedAt?: Date | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFivemFacAbsenceStatus = "pending" | "approved" | "active" | "rejected" | "finished" | "closed";

export type MongoFivemFacAuditEntry = {
  action: string;
  actorId: string | null;
  reason: string | null;
  status: MongoFivemFacAbsenceStatus;
  createdAt: Date;
};

export type MongoFivemFacAbsence = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  photoUrl?: string | null;
  status: MongoFivemFacAbsenceStatus;
  privateChannelId: string | null;
  requestMessageId: string | null;
  moderatorId: string | null;
  rejectionReason: string | null;
  roleAddedAt: Date | null;
  roleRemovedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  closedAt: Date | null;
  audit: MongoFivemFacAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export type MongoDevBotStatus = "online" | "offline" | "invalid_token" | "error";

export type MongoDevBot = {
  _id: string;
  name: string;
  slug?: string | null;
  clientId: string;
  tokenEncrypted: string;
  tokenLast4?: string | null;
  secretEncrypted: string | null;
  avatarUrl: string | null;
  botCreatedAt?: Date | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  mainGuildName?: string;
  mainGuildIconUrl?: string | null;
  mainGuildMemberCount?: number;
  mainGuildChannelCount?: number;
  status: MongoDevBotStatus;
  statusMessage?: string | null;
  enabledModules: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoBotGuildModuleConfig = {
  enabled?: boolean;
  channelId?: string | null;
  message?: string | null;
  interval?: number | null;
  roleId?: string | null;
  [key: string]: unknown;
};

export type MongoBotGuildConfig = {
  _id: string;
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, MongoBotGuildModuleConfig>;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoDevPermission = {
  _id: string;
  userId: string;
  role: "owner" | "dev" | "admin";
  canCreateBot: boolean;
  canEditBot: boolean;
  canDeleteBot: boolean;
  canManageModules: boolean;
  createdAt: Date;
};

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoIndexes?: Promise<void>;
};

function databaseNameFromUri(uri: string) {
  try {
    const url = new URL(uri);
    const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
    return dbName || "ricardinho98";
  } catch {
    return "ricardinho98";
  }
}

function getMongoClient() {
  if (!env.MONGODB_URI) {
    throw new Error("MONGODB_URI nao configurada.");
  }

  if (!globalForMongo.mongoClient) {
    globalForMongo.mongoClient = new MongoClient(env.MONGODB_URI);
  }

  return globalForMongo.mongoClient;
}

export async function getMongoDb() {
  const client = getMongoClient();
  await client.connect();
  return client.db(databaseNameFromUri(env.MONGODB_URI));
}

export async function getMongoCollections() {
  const db = await getMongoDb();
  await ensureMongoIndexes(db);

  return {
    users: db.collection<MongoUser>("User"),
    guilds: db.collection<MongoGuild>("Guild"),
    guildSettings: db.collection<MongoGuildSettings>("GuildSettings"),
    tickets: db.collection<MongoTicket>("Ticket"),
    logEntries: db.collection<MongoLogEntry>("LogEntry"),
    socialNotifications: db.collection<MongoSocialNotification>("social_notifications"),
    socialMembers: db.collection<MongoSocialMember>("social_members"),
    socialPanels: db.collection<MongoSocialPanel>("social_panels"),
    xAccounts: db.collection<MongoXAccount>("x_accounts"),
    xPostsSent: db.collection<MongoXPostSent>("x_posts_sent"),
    clipsConfig: db.collection<MongoClipsConfig>("clips_config"),
    clipsSent: db.collection<MongoClipSent>("clips_sent"),
    clipsLogs: db.collection<MongoClipLog>("clips_logs"),
    giveaways: db.collection<MongoGiveaway>("giveaways"),
    fivemFacSettings: db.collection<MongoFivemFacSettings>("fivem_fac_settings"),
    fivemFacAbsences: db.collection<MongoFivemFacAbsence>("fivem_fac_absences"),
    devBots: db.collection<MongoDevBot>("Bot"),
    botGuildConfigs: db.collection<MongoBotGuildConfig>("BotGuildConfig"),
    devPermissions: db.collection<MongoDevPermission>("DevPermission")
  };
}

export async function ensureGuild(guildId: string) {
  const { guilds } = await getMongoCollections();
  const now = new Date();

  await guilds.updateOne(
    {
      _id: guildId
    },
    {
      $set: {
        updatedAt: now
      },
      $setOnInsert: {
        _id: guildId,
        name: `Guild ${guildId}`,
        icon: null,
        ownerId: null,
        botEnabled: false,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );
}

async function ensureMongoIndexes(db: Db) {
  if (!globalForMongo.mongoIndexes) {
    globalForMongo.mongoIndexes = createMongoIndexes(db).catch((error) => {
      console.warn("[mongo] nao foi possivel criar indices:", error instanceof Error ? error.message : error);
    });
  }

  await globalForMongo.mongoIndexes;
}

async function createMongoIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoUser>("User").createIndex(
      { discordId: 1 },
      {
        name: "User_discordId_key",
        unique: true
      }
    ),
    ensureGuildSettingsIndexes(db),
    db.collection<MongoTicket>("Ticket").createIndex({ guildId: 1, createdAt: -1 }),
    db.collection<MongoLogEntry>("LogEntry").createIndex({ guildId: 1, createdAt: -1 }),
    ensureSocialNotificationIndexes(db),
    ensureSocialNetworkIndexes(db),
    ensureXMonitorIndexes(db),
    ensureClipsIndexes(db),
    ensureGiveawayIndexes(db),
    ensureFivemFacIndexes(db),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        guildId: 1,
        platform: 1
      },
      {
        name: "social_notifications_guildId_platform_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        platform: 1,
        enabled: 1
      },
      {
        name: "social_notifications_platform_enabled_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        botId: 1,
        platform: 1,
        enabled: 1,
        updatedAt: 1
      },
      {
        name: "social_notifications_bot_platform_enabled_updated_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        botId: 1,
        guildId: 1,
        platform: 1,
        createdAt: -1
      },
      {
        name: "social_notifications_bot_guild_platform_created_idx"
      }
    ),
    ensureDevBotIndexes(db),
    db.collection<MongoBotGuildConfig>("BotGuildConfig").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoDevPermission>("DevPermission").createIndex({ userId: 1 }, { unique: true })
  ]);
}

async function ensureDevBotIndexes(db: Db) {
  const collection = db.collection<MongoDevBot>("Bot");

  await ensureDevBotSlugs(collection);
  await collection.createIndex({ clientId: 1 }, { unique: true });
  await collection.createIndex({ slug: 1 }, { unique: true });
}

async function ensureDevBotSlugs(collection: Collection<MongoDevBot>) {
  const bots = await collection
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          slug: 1,
          createdAt: 1
        }
      }
    )
    .sort({ createdAt: 1 })
    .toArray();
  const reservedSlugs = new Set<string>();

  for (const bot of bots) {
    const currentSlug = bot.slug ? slugifyBotName(bot.slug) : "";
    const baseSlug = currentSlug || slugifyBotName(bot.name);
    const nextSlug = uniqueSlugFromReserved(baseSlug, reservedSlugs);

    reservedSlugs.add(nextSlug);

    if (bot.slug !== nextSlug) {
      await collection.updateOne(
        {
          _id: bot._id
        },
        {
          $set: {
            slug: nextSlug,
            updatedAt: new Date()
          }
        }
      );
    }
  }
}

function uniqueSlugFromReserved(baseSlug: string, reservedSlugs: Set<string>) {
  const base = baseSlug || "bot";
  let slug = base;
  let suffix = 2;

  while (reservedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function slugifyBotName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "bot";
}

async function ensureGuildSettingsIndexes(db: Db) {
  const collection = db.collection<MongoGuildSettings>("GuildSettings");

  await Promise.all([
    collection.dropIndex("guildId_1").catch(() => undefined),
    collection.dropIndex("GuildSettings_guildId_key").catch(() => undefined)
  ]);
  await collection.createIndex({ botId: 1, guildId: 1 }, { unique: true });
}

async function ensureSocialNotificationIndexes(db: Db) {
  const collection = db.collection<MongoSocialNotification>("social_notifications");

  await collection.dropIndex("guildId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_userId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_platform_1_kickChannelName_1").catch(() => undefined);
  await collection.createIndex({
    botId: 1,
    guildId: 1
  });
  await collection.createIndex(
    {
      botId: 1,
      guildId: 1,
      platform: 1,
      twitchChannelName: 1
    },
    {
      name: "social_notifications_twitch_channel_unique",
      partialFilterExpression: {
        platform: "twitch",
        twitchChannelName: {
          $type: "string"
        }
      },
      unique: true
    }
  );
  await collection.createIndex(
    {
      botId: 1,
      guildId: 1,
      platform: 1,
      kickChannelName: 1
    },
    {
      name: "social_notifications_kick_channel_unique",
      partialFilterExpression: {
        platform: "kick",
        kickChannelName: {
          $type: "string"
        }
      },
      unique: true
    }
  );
}

async function ensureSocialNetworkIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSocialMember>("social_members").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoSocialMember>("social_members").createIndex({
      botId: 1,
      guildId: 1,
      name: 1
    }),
    db.collection<MongoSocialPanel>("social_panels").createIndex(
      {
        botId: 1,
        guildId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoSocialPanel>("social_panels").createIndex({
      botId: 1,
      published: 1,
      updatedAt: 1
    })
  ]);
}

async function ensureXMonitorIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoXAccount>("x_accounts").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoXAccount>("x_accounts").createIndex(
      {
        botId: 1,
        guildId: 1,
        username: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoXAccount>("x_accounts").createIndex({
      botId: 1,
      active: 1,
      lastSyncAt: 1
    }),
    db.collection<MongoXPostSent>("x_posts_sent").createIndex(
      {
        botId: 1,
        accountId: 1,
        xPostId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoXPostSent>("x_posts_sent").createIndex({
      botId: 1,
      guildId: 1,
      sentAt: -1
    })
  ]);
}

async function ensureClipsIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoClipsConfig>("clips_config").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoClipsConfig>("clips_config").createIndex({ enabled: 1, botId: 1, lastCheckAt: 1 }),
    db.collection<MongoClipSent>("clips_sent").createIndex({ botId: 1, guildId: 1, clipId: 1 }, { unique: true }),
    db.collection<MongoClipSent>("clips_sent").createIndex({ botId: 1, guildId: 1, sentAt: -1 }),
    db.collection<MongoClipLog>("clips_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 })
  ]);
}

async function ensureGiveawayIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, status: 1, scheduledStartAt: 1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, status: 1, scheduledEndAt: 1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ rouletteToken: 1 }, { unique: true })
  ]);
}

async function ensureFivemFacIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoFivemFacSettings>("fivem_fac_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFivemFacSettings>("fivem_fac_settings").createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, guildId: 1, userId: 1, status: 1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, status: 1, startDate: 1, endDate: 1 })
  ]);
}
