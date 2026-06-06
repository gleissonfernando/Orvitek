export type DashboardGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  isAdmin: boolean;
  botEnabled: boolean;
  memberCount: number;
  channelCount: number;
};

export type AuthUser = {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  discriminator: string | null;
  tag: string;
  avatar: string | null;
  avatarUrl: string | null;
  email: string | null;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  accessLevel: "admin" | "viewer";
  authorized: boolean;
  lastLoginAt: string;
};

export type AuthResponse = {
  user: AuthUser;
  guilds: DashboardGuild[];
  permissions: {
    canManageGuilds: boolean;
    canManageDashboard: boolean;
    canConfigureGuilds: boolean;
  };
  access: {
    authenticated: boolean;
    verified: boolean;
    level: "admin" | "viewer";
    verificationMode: "temporary" | "roles";
    tokenExpiresAt: string;
  };
  validation?: {
    allowed: boolean;
    mode: "temporary" | "roles";
    temporaryAccess: boolean;
    accessLevel: "admin" | "viewer";
    authorizedUser: boolean;
    canManageDashboard: boolean;
  };
};

export type BotStatus = {
  online: boolean;
  latency: number;
  guilds: number;
  users: number;
  botGuilds: Array<{
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount?: number;
    channelCount?: number;
  }>;
  updatedAt: string;
};

export type GuildSettings = {
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
};

export type LogEntry = {
  id: string;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type LiveEvent = {
  id: string;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
  createdAt: string;
};

export type Ticket = {
  id: string;
  guildId: string;
  channelId?: string | null;
  openerId: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: string;
  closedAt?: string | null;
};

export type GuildChannelOption = {
  id: string;
  name: string;
  parentId: string | null;
  type: "text" | "announcement";
};

export type GuildRoleOption = {
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildLiveOptions = {
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
};

export type SocialNotification = {
  id: string;
  guildId: string;
  userId: string;
  platform: "twitch";
  twitchChannelName: string;
  twitchChannelUrl: string;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTwitchNotificationPayload = {
  twitchChannelInput: string;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
};

export type UpdateTwitchNotificationPayload = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled?: boolean;
};

export type TwitchChannelPreview = {
  twitchId: string;
  twitchUsername: string;
  twitchDisplayName: string;
  twitchAvatar: string | null;
  twitchUrl: string;
};

export type DashboardMeUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
};

export type DashboardMeBot = {
  id: string | null;
  username: string;
  avatarUrl: string | null;
  connected: boolean;
};

export type DashboardMeGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
  botInGuild: boolean;
};

export type DashboardMeResponse = {
  user: DashboardMeUser;
  bot: DashboardMeBot;
  selectedGuildId: string | null;
  guilds: DashboardMeGuild[];
};

export type DevModuleDefinition = {
  id: string;
  label: string;
};

export type DevBotStatus = "online" | "offline" | "invalid_token" | "error";

export type DevBot = {
  id: string;
  name: string;
  clientId: string;
  tokenMasked: string;
  secretConfigured: boolean;
  avatarUrl: string | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  status: DevBotStatus;
  statusMessage: string | null;
  enabledModules: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDevBotPayload = {
  name: string;
  clientId: string;
  token: string;
  secret?: string | null;
  avatarUrl?: string | null;
  ownerName: string;
  ownerId: string;
  mainGuildId: string;
  enabledModules: string[];
};

export type BotConnectionTest = {
  status: DevBotStatus;
  message: string;
  avatarUrl: string | null;
};
