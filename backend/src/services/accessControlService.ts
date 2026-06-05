import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";

export type GuildAccessCheck = {
  guildId: string;
  guildName: string;
  administrator: boolean;
  owner: boolean;
  configuredPanelRole: boolean;
};

export type AccessValidationResult = {
  allowed: boolean;
  mode: "temporary" | "roles";
  temporaryAccess: boolean;
  checks: GuildAccessCheck[];
};

export async function evaluateDashboardAccess(user: AuthSessionUser): Promise<AccessValidationResult> {
  const checks = user.guilds.map((guild) => ({
    guildId: guild.id,
    guildName: guild.name,
    administrator: guild.isAdmin,
    owner: guild.owner,
    configuredPanelRole: false
  }));

  if (env.DASHBOARD_VERIFICATION_MODE === "temporary") {
    return {
      allowed: true,
      mode: "temporary",
      temporaryAccess: true,
      checks
    };
  }

  return {
    allowed: checks.some((check) => check.administrator || check.owner || check.configuredPanelRole),
    mode: "roles",
    temporaryAccess: false,
    checks
  };
}
