import { createHash } from "node:crypto";

export type FivemHierarchyDedupeIdentity = {
  botId: string | null;
  guildId: string;
  panelChannelId: string | null;
  roleIds: string[];
};

export function hierarchyConfigFingerprint(value: unknown) {
  return createHash("sha256").update(stableHierarchyStringify(value)).digest("hex");
}

export function sameHierarchyConfig(left: unknown, right: unknown) {
  return hierarchyConfigFingerprint(left) === hierarchyConfigFingerprint(right);
}

export function hierarchyDedupeFingerprint(input: FivemHierarchyDedupeIdentity) {
  const botId = input.botId?.trim() ?? "";
  const guildId = input.guildId.trim();
  const panelChannelId = input.panelChannelId?.trim() ?? "";
  const roleIds = [...new Set(input.roleIds.map((roleId) => roleId.trim()).filter(Boolean))].sort();

  if (!botId || !guildId || !panelChannelId || roleIds.length === 0) {
    return null;
  }

  return hierarchyConfigFingerprint({ botId, guildId, panelChannelId, roleIds });
}

export function stableHierarchyStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableHierarchyStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableHierarchyStringify(record[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}
