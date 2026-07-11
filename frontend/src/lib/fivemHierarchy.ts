import type { FivemHierarchyPanel } from "../types";

export type EditableFivemHierarchyPanel = Pick<
  FivemHierarchyPanel,
  | "allowedRoleIds"
  | "color"
  | "configRevision"
  | "commandRoleIds"
  | "commandUserIds"
  | "description"
  | "enabled"
  | "footerEnabled"
  | "footerIconUrl"
  | "footerText"
  | "hierarchies"
  | "imagePosition"
  | "imageUrl"
  | "linkedToFivem"
  | "logChannelId"
  | "managerRoleIds"
  | "managerUserIds"
  | "name"
  | "panelChannelId"
  | "title"
  | "status"
>;

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LOCAL_PANEL_ID_PATTERN = new RegExp(`^new:(${UUID_PATTERN})$`, "i");
const CLIENT_REQUEST_ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`, "i");

export function buildEditableFivemHierarchyPanelPayload(panel: FivemHierarchyPanel): EditableFivemHierarchyPanel {
  return {
    allowedRoleIds: panel.allowedRoleIds,
    color: panel.color,
    configRevision: panel.configRevision,
    commandRoleIds: panel.commandRoleIds,
    commandUserIds: panel.commandUserIds,
    description: panel.description,
    enabled: panel.enabled,
    footerEnabled: panel.footerEnabled,
    footerIconUrl: panel.footerIconUrl,
    footerText: panel.footerText,
    hierarchies: panel.hierarchies,
    imagePosition: panel.imagePosition,
    imageUrl: panel.imageUrl,
    linkedToFivem: panel.linkedToFivem,
    logChannelId: panel.logChannelId,
    managerRoleIds: panel.managerRoleIds,
    managerUserIds: panel.managerUserIds,
    name: panel.name,
    panelChannelId: panel.panelChannelId,
    title: panel.title,
    status: panel.status
  };
}

export function hierarchyPanelClientRequestId(panelId: string) {
  return LOCAL_PANEL_ID_PATTERN.exec(panelId)?.[1] ?? null;
}

export function isLocalHierarchyPanelId(panelId: string) {
  return hierarchyPanelClientRequestId(panelId) !== null;
}

export function hierarchyPanelDraftId(clientRequestId: string) {
  if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw new Error("clientRequestId de painel de hierarquia invalido.");
  }

  return `new:${clientRequestId}`;
}
