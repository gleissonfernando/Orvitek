export const DEV_OWNER_USER_ID = "1426287249020158018";

export function isDevOwnerUserId(discordId: string | null | undefined) {
  return discordId === DEV_OWNER_USER_ID;
}
