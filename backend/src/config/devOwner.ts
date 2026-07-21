const DASHBOARD_DEV_USER_ID = "1426287249020158018";

export function isDashboardDevUserId(discordId: string | null | undefined) {
  if (!discordId) return false;
  return dashboardDevUserIds().has(discordId);
}

function dashboardDevUserIds() {
  return new Set([
    DASHBOARD_DEV_USER_ID,
    ...csvIds(process.env.DASHBOARD_DEV_USER_IDS),
    ...csvIds(process.env.DEV_DISCORD_IDS)
  ]);
}

function csvIds(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{5,32}$/.test(item));
}
