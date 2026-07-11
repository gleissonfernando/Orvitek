import assert from "node:assert/strict";
import test from "node:test";
import { canManageFivemHierarchyPanel, type FivemHierarchyPanelDto } from "./fivemHierarchyService";

function panel(): FivemHierarchyPanelDto {
  return {
    allowedRoleIds: [], botId: "bot-1", color: "#22c55e", commandRoleIds: ["role-command"], commandUserIds: ["user-command"], configRevision: 1,
    contentHash: null, createdAt: new Date(0).toISOString(), createdBy: "creator", deletedAt: null, description: null, enabled: false,
    footerEnabled: true, footerIconUrl: null, footerText: null, guildId: "guild-1", hierarchies: [], id: "panel-1", imagePosition: "none",
    imageUrl: null, linkedToFivem: true, logChannelId: null, managerRoleIds: ["role-manager"], managerUserIds: ["user-manager"], name: "Unidade Teste",
    panelChannelId: null, panelMessageId: null, panelVersion: 2, publishedAt: null, status: "draft", title: "Unidade Teste", updatedAt: new Date(0).toISOString()
  };
}

test("autorizacao permanece isolada por hierarquia", () => {
  const value = panel();
  assert.equal(canManageFivemHierarchyPanel(value, "creator", []), true);
  assert.equal(canManageFivemHierarchyPanel(value, "user-manager", []), true);
  assert.equal(canManageFivemHierarchyPanel(value, "user-command", []), true);
  assert.equal(canManageFivemHierarchyPanel(value, "other", ["role-manager"]), true);
  assert.equal(canManageFivemHierarchyPanel(value, "other", ["role-command"]), true);
  assert.equal(canManageFivemHierarchyPanel(value, "other", ["unrelated-role"]), false);
  assert.equal(canManageFivemHierarchyPanel(value, "other", [], true), true);
});
