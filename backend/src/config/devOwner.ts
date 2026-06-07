import { env } from "./env";

export function isDevOwnerUserId(discordId: string | null | undefined) {
  if (!discordId) {
    return false;
  }

  return env.DASHBOARD_DEV_USER_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(discordId);
}
