import { env } from "../config/env";

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position?: number;
};

type DiscordRole = {
  id: string;
  name: string;
  color: number;
  managed: boolean;
  position: number;
};

export type GuildChannelOptionDto = {
  id: string;
  name: string;
  parentId: string | null;
  type: "text" | "announcement";
};

export type GuildRoleOptionDto = {
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildLiveOptionsDto = {
  channels: GuildChannelOptionDto[];
  roles: GuildRoleOptionDto[];
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const TEXT_CHANNEL_TYPES = new Set([0, 5]);

export async function getGuildLiveOptions(guildId: string): Promise<GuildLiveOptionsDto> {
  if (!env.DISCORD_BOT_TOKEN) {
    return {
      channels: [],
      roles: [createEveryoneRole(guildId)]
    };
  }

  const [channels, roles] = await Promise.all([
    discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`),
    discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`)
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
    roles: [
      createEveryoneRole(guildId),
      ...roles
        .filter((role) => role.id !== guildId && !role.managed)
        .sort((left, right) => right.position - left.position)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          managed: role.managed
        }))
    ]
  };
}

function createEveryoneRole(guildId: string): GuildRoleOptionDto {
  return {
    id: guildId,
    name: "@everyone",
    color: 0,
    managed: false
  };
}

async function discordFetch<TResponse>(path: string) {
  const response = await fetch(`${DISCORD_API_URL}${path}`, {
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord API respondeu ${response.status} em ${path}.`);
  }

  return (await response.json()) as TResponse;
}
