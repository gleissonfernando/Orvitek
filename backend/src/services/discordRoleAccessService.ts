import { env } from "../config/env";
import { listGuildBotRuntimeConfigs } from "./devBotService";
import { getGuildSettings } from "./settingsService";

type DiscordGuildMember = {
  roles: string[];
};

type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
};

export type DiscordRoleAccess = {
  administratorRole: boolean;
  configuredPanelRole: boolean;
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const ADMINISTRATOR = 0x8n;

const noRoleAccess: DiscordRoleAccess = {
  administratorRole: false,
  configuredPanelRole: false
};

export async function getDiscordRoleAccess(guildId: string, userId: string): Promise<DiscordRoleAccess> {
  const customBots = await listGuildBotRuntimeConfigs(guildId).catch(() => []);
  const scopes = [
    ...(env.DISCORD_BOT_TOKEN ? [{ botId: null, token: env.DISCORD_BOT_TOKEN }] : []),
    ...customBots.map((bot) => ({
      botId: bot.id,
      token: bot.token
    }))
  ];

  if (!scopes.length) {
    return noRoleAccess;
  }

  const results = await Promise.all(
    scopes.map(async (scope) => {
      try {
        const settings = await getGuildSettings(guildId, scope.botId);

        if (!settings.verificationEnabled || !settings.verificationRoleId) {
          return noRoleAccess;
        }

        const [member, roles] = await Promise.all([
          discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`, scope.token),
          discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, scope.token)
        ]);
        const memberRoleIds = new Set(member.roles);
        memberRoleIds.add(guildId);

        return {
          configuredPanelRole: memberRoleIds.has(settings.verificationRoleId),
          administratorRole: roles.some(
            (role) => memberRoleIds.has(role.id) && hasAdministratorPermission(role.permissions)
          )
        };
      } catch (error) {
        if (!(error instanceof Error && /Discord API respondeu (403|404)/.test(error.message))) {
          console.warn(
            `[discord] nao foi possivel validar cargos em ${guildId}:`,
            error instanceof Error ? error.message : error
          );
        }

        return noRoleAccess;
      }
    }
  ));

  return {
    administratorRole: results.some((result) => result.administratorRole),
    configuredPanelRole: results.some((result) => result.configuredPanelRole)
  };
}

function hasAdministratorPermission(permissionsValue: string) {
  try {
    const permissions = BigInt(permissionsValue || "0");
    return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
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
