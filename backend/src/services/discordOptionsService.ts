import { env } from "../config/env";
import { getDiscordAvatarUrl } from "./discordAssetService";

type DiscordChannel = {
  id: string;
  guild_id?: string;
  name: string;
  permission_overwrites?: DiscordPermissionOverwrite[];
  type: number;
  parent_id?: string | null;
  position?: number;
};

type DiscordPermissionOverwrite = {
  allow: string;
  deny: string;
  id: string;
  type: number;
};

type DiscordRole = {
  id: string;
  name: string;
  color: number;
  managed: boolean;
  permissions: string;
  position: number;
};

type DiscordBotUser = {
  id: string;
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string | null;
  avatar?: string | null;
  bot?: boolean;
};

type DiscordGuildMember = {
  avatar?: string | null;
  nick?: string | null;
  roles: string[];
  user?: DiscordUser;
};

export type GuildChannelOptionDto = {
  id: string;
  name: string;
  parentId: string | null;
  type: "text" | "announcement";
};

export type GuildRoleOptionDto = {
  assignable: boolean;
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildLiveOptionsDto = {
  channels: GuildChannelOptionDto[];
  roles: GuildRoleOptionDto[];
};

export type GuildMemberOptionDto = {
  avatarUrl: string | null;
  bot: boolean;
  displayName: string;
  globalName: string | null;
  id: string;
  tag: string;
  username: string;
};

export type GuildPanelChannelValidationDto = {
  missingPermissions: string[];
  ok: boolean;
  reason: string | null;
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const ADMINISTRATOR = 0x8n;
const MANAGE_ROLES = 0x10000000n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const USE_EXTERNAL_EMOJIS = 1n << 18n;
const PIN_MESSAGES = 1n << 51n;
const PANEL_CHANNEL_PERMISSIONS = [
  { bit: VIEW_CHANNEL, label: "View Channel" },
  { bit: SEND_MESSAGES, label: "Send Messages" },
  { bit: EMBED_LINKS, label: "Embed Links" },
  { bit: USE_EXTERNAL_EMOJIS, label: "Use External Emojis" },
  { bit: PIN_MESSAGES, label: "Pin Messages" }
] as const;

export async function getGuildLiveOptions(guildId: string, botToken?: string | null): Promise<GuildLiveOptionsDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return {
      channels: [],
      roles: [createEveryoneRole(guildId)]
    };
  }

  const [channels, roles] = await Promise.all([
    discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`, token),
    getGuildRoleOptions(guildId, token)
  ]);

  return {
    channels: channels
      .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentId: channel.parent_id ?? null,
        type: channel.type === 5 ? "announcement" : "text"
      })),
    roles
  };
}

export async function getGuildRoleOptions(guildId: string, botToken?: string | null): Promise<GuildRoleOptionDto[]> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return [createEveryoneRole(guildId)];
  }

  const bot = await discordFetch<DiscordBotUser>("/users/@me", token);
  const [roles, botMember] = await Promise.all([
    discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token),
    discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${bot.id}`, token)
  ]);
  const botRoleIds = new Set([guildId, ...botMember.roles]);
  const botRoles = roles.filter((role) => botRoleIds.has(role.id));
  const highestBotRolePosition = Math.max(0, ...botRoles.map((role) => role.position));
  const botPermissions = botRoles.reduce((permissions, role) => permissions | parsePermissions(role.permissions), 0n);
  const canManageRoles =
    (botPermissions & ADMINISTRATOR) === ADMINISTRATOR
    || (botPermissions & MANAGE_ROLES) === MANAGE_ROLES;

  return [
    createEveryoneRole(guildId),
    ...roles
      .filter((role) => role.id !== guildId && !role.managed)
      .sort((left, right) => right.position - left.position)
      .map((role) => ({
        assignable: canManageRoles && role.position < highestBotRolePosition,
        id: role.id,
        name: role.name,
        color: role.color,
        managed: role.managed
      }))
  ];
}

export async function getGuildMemberOptions(
  guildId: string,
  query: string,
  botToken?: string | null
): Promise<GuildMemberOptionDto[]> {
  const token = botToken || env.DISCORD_BOT_TOKEN;
  const normalizedQuery = query.trim();

  if (!token || normalizedQuery.length < 2) {
    return [];
  }

  const membersById = new Map<string, GuildMemberOptionDto>();

  if (/^\d{5,32}$/.test(normalizedQuery)) {
    try {
      const member = await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${normalizedQuery}`, token);
      const option = toGuildMemberOption(member, guildId);

      if (option) {
        membersById.set(option.id, option);
      }
    } catch {
      // The search below may still find a member by username.
    }
  }

  try {
    const searchParams = new URLSearchParams({
      limit: "12",
      query: normalizedQuery
    });
    const members = await discordFetch<DiscordGuildMember[]>(
      `/guilds/${guildId}/members/search?${searchParams.toString()}`,
      token
    );

    for (const member of members) {
      const option = toGuildMemberOption(member, guildId);

      if (option) {
        membersById.set(option.id, option);
      }
    }
  } catch (error) {
    if (!membersById.size) {
      throw Object.assign(new Error("Nao foi possivel buscar membros neste servidor pelo Discord."), {
        cause: error,
        statusCode: 502
      });
    }
  }

  return [...membersById.values()]
    .filter((member) => !member.bot)
    .slice(0, 12);
}

export async function isGuildTextChannel(guildId: string, channelId: string, botToken?: string | null) {
  return isGuildChannelType(guildId, channelId, TEXT_CHANNEL_TYPES, botToken);
}

export async function validateGuildPanelChannel(
  guildId: string,
  channelId: string,
  botToken?: string | null
): Promise<GuildPanelChannelValidationDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return {
      missingPermissions: [],
      ok: false,
      reason: "Token do bot nao configurado para validar o canal do painel."
    };
  }

  try {
    const [channel, bot, roles] = await Promise.all([
      discordFetch<DiscordChannel>(`/channels/${channelId}`, token),
      discordFetch<DiscordBotUser>("/users/@me", token),
      discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token)
    ]);

    if (channel.guild_id !== guildId || !TEXT_CHANNEL_TYPES.has(channel.type)) {
      return {
        missingPermissions: [],
        ok: false,
        reason: "O canal configurado nao existe neste servidor ou nao e um canal de texto."
      };
    }

    const botMember = await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${bot.id}`, token);
    const permissions = resolveChannelPermissions(guildId, bot.id, botMember.roles, roles, channel.permission_overwrites ?? []);

    if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
      return {
        missingPermissions: [],
        ok: true,
        reason: null
      };
    }

    const missingPermissions = PANEL_CHANNEL_PERMISSIONS
      .filter((permission) => (permissions & permission.bit) !== permission.bit)
      .map((permission) => permission.label);

    return {
      missingPermissions,
      ok: missingPermissions.length === 0,
      reason: missingPermissions.length
        ? `Bot sem permissao no canal do painel: ${missingPermissions.join(", ")}.`
        : null
    };
  } catch {
    return {
      missingPermissions: [],
      ok: false,
      reason: "Nao foi possivel validar o canal configurado no Discord."
    };
  }
}

export async function isGuildCategoryChannel(guildId: string, channelId: string, botToken?: string | null) {
  return isGuildChannelType(guildId, channelId, new Set([4]), botToken);
}

export async function areGuildRoles(guildId: string, roleIds: string[], botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return false;
  }

  try {
    const roles = await discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token);
    const availableRoleIds = new Set(roles.map((role) => role.id));
    availableRoleIds.add(guildId);
    return roleIds.every((roleId) => availableRoleIds.has(roleId));
  } catch {
    return false;
  }
}

export async function areGuildAssignableRoles(guildId: string, roleIds: string[], botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token || !roleIds.length) {
    return false;
  }

  try {
    const roles = await getGuildRoleOptions(guildId, token);
    const assignableRoleIds = new Set(
      roles
        .filter((role) => role.assignable)
        .map((role) => role.id)
    );

    return roleIds.every((roleId) => assignableRoleIds.has(roleId));
  } catch {
    return false;
  }
}

export async function areGuildMembers(guildId: string, userIds: string[], botToken?: string | null) {
  const normalizedUserIds = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];

  if (!normalizedUserIds.length) {
    return true;
  }

  const checks = await Promise.all(
    normalizedUserIds.map((userId) => isGuildMember(guildId, userId, botToken))
  );

  return checks.every(Boolean);
}

export async function isGuildMember(guildId: string, userId: string, botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token || !/^\d{5,32}$/.test(userId.trim())) {
    return false;
  }

  try {
    await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${userId.trim()}`, token);
    return true;
  } catch {
    return false;
  }
}

export async function userHasAnyGuildRole(guildId: string, userId: string, roleIds: string[], botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;
  const normalizedRoleIds = roleIds.map((roleId) => roleId.trim()).filter(Boolean);

  if (!token || !normalizedRoleIds.length) {
    return false;
  }

  try {
    const member = await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`, token);
    const memberRoleIds = new Set([guildId, ...member.roles]);
    return normalizedRoleIds.some((roleId) => memberRoleIds.has(roleId));
  } catch {
    return false;
  }
}

async function isGuildChannelType(
  guildId: string,
  channelId: string,
  allowedTypes: Set<number>,
  botToken?: string | null
) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return false;
  }

  try {
    const channel = await discordFetch<DiscordChannel>(`/channels/${channelId}`, token);
    return channel.guild_id === guildId && allowedTypes.has(channel.type);
  } catch {
    return false;
  }
}

function createEveryoneRole(guildId: string): GuildRoleOptionDto {
  return {
    assignable: false,
    id: guildId,
    name: "@everyone",
    color: 0,
    managed: false
  };
}

function parsePermissions(value: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function resolveChannelPermissions(
  guildId: string,
  botId: string,
  botRoleIds: string[],
  roles: DiscordRole[],
  overwrites: DiscordPermissionOverwrite[]
) {
  const roleIds = new Set([guildId, ...botRoleIds]);
  let permissions = roles
    .filter((role) => roleIds.has(role.id))
    .reduce((total, role) => total | parsePermissions(role.permissions), 0n);

  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
    return permissions;
  }

  permissions = applyPermissionOverwrite(
    permissions,
    overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0)
  );

  let roleAllow = 0n;
  let roleDeny = 0n;

  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !roleIds.has(overwrite.id) || overwrite.id === guildId) {
      continue;
    }

    roleAllow |= parsePermissions(overwrite.allow);
    roleDeny |= parsePermissions(overwrite.deny);
  }

  permissions = (permissions & ~roleDeny) | roleAllow;
  permissions = applyPermissionOverwrite(
    permissions,
    overwrites.find((overwrite) => overwrite.id === botId && overwrite.type === 1)
  );

  return permissions;
}

function applyPermissionOverwrite(permissions: bigint, overwrite?: DiscordPermissionOverwrite) {
  if (!overwrite) {
    return permissions;
  }

  return (permissions & ~parsePermissions(overwrite.deny)) | parsePermissions(overwrite.allow);
}

function toGuildMemberOption(member: DiscordGuildMember, guildId: string): GuildMemberOptionDto | null {
  const user = member.user;

  if (!user) {
    return null;
  }

  const displayName = member.nick?.trim() || user.global_name?.trim() || user.username;
  const tag = user.discriminator && user.discriminator !== "0"
    ? `${user.username}#${user.discriminator}`
    : `@${user.username}`;

  return {
    avatarUrl: getMemberAvatarUrl(guildId, user.id, member.avatar) ?? getDiscordAvatarUrl(user.id, user.avatar),
    bot: user.bot === true,
    displayName,
    globalName: user.global_name ?? null,
    id: user.id,
    tag,
    username: user.username
  };
}

function getMemberAvatarUrl(guildId: string, userId: string, avatar: string | null | undefined) {
  if (!avatar) {
    return null;
  }

  const extension = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatar}.${extension}?size=128`;
}

async function discordFetch<TResponse>(path: string, token: string) {
  const response = await fetch(`${DISCORD_API_URL}${path}`, {
    headers: {
      Authorization: `Bot ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord API respondeu ${response.status} em ${path}.`);
  }

  return (await response.json()) as TResponse;
}
