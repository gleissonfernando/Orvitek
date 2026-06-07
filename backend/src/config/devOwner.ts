export const DASHBOARD_SYSTEM_OWNER_ID = "1426287249020158018";

export function isDevOwnerUserId(discordId: string | null | undefined) {
  return discordId === DASHBOARD_SYSTEM_OWNER_ID;
}
