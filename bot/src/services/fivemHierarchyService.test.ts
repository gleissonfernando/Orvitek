import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags, type Message } from "discord.js";
import type { FivemHierarchyPanel } from "./apiClient";
import {
  generatePanelHash,
  normalizeHierarchyMessageForHash,
  normalizeHierarchyPanelPayloadForHash,
  resolveHierarchyEntryIdsForRoleIds
} from "./fivemHierarchyService";

function panelWithMultipleRoles(): FivemHierarchyPanel {
  return {
    hierarchies: [
      { active: true, color: null, description: null, emoji: null, id: "command", limit: null, name: "Command", order: 1, roleId: "role-command" },
      { active: true, color: null, description: null, emoji: null, id: "detective", limit: null, name: "Detective", order: 2, roleId: "role-detective" },
      { active: false, color: null, description: null, emoji: null, id: "inactive", limit: null, name: "Inactive", order: 3, roleId: "role-inactive" }
    ]
  } as FivemHierarchyPanel;
}

test("membro aparece em todas as entradas ativas cujos cargos possui", () => {
  assert.deepEqual(
    resolveHierarchyEntryIdsForRoleIds(panelWithMultipleRoles(), ["role-command", "role-detective", "role-inactive"]),
    ["command", "detective"]
  );
});

test("hash canonico ignora IDs que o Discord injeta nos Components V2", () => {
  const components = [{
    accent_color: 0x22c55e,
    components: [{ content: "# Hierarquia", type: 10 }],
    type: 17
  }];
  const payloadState = normalizeHierarchyPanelPayloadForHash({
    allowedMentions: { parse: [] },
    components,
    flags: MessageFlags.IsComponentsV2
  });
  const messageState = normalizeHierarchyMessageForHash({
    components: [{
      toJSON: () => ({
        accent_color: 0x22c55e,
        components: [{ content: "# Hierarquia", id: 2, type: 10 }],
        id: 1,
        type: 17
      })
    }],
    flags: { has: (flag: MessageFlags) => flag === MessageFlags.IsComponentsV2 }
  } as unknown as Pick<Message, "components" | "flags">);

  assert.equal(generatePanelHash(payloadState), generatePanelHash(messageState));
});
