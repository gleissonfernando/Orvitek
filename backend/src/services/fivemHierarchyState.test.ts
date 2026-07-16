import assert from "node:assert/strict";
import test from "node:test";
import {
  hierarchyConfigFingerprint,
  hierarchyDedupeFingerprint,
  sameHierarchyConfig
} from "./fivemHierarchyState";

test("fingerprint de configuração independe da ordem das chaves", () => {
  assert.equal(
    hierarchyConfigFingerprint({ channelId: "12345", enabled: true, roles: ["1", "2"] }),
    hierarchyConfigFingerprint({ roles: ["1", "2"], enabled: true, channelId: "12345" })
  );
  assert.equal(sameHierarchyConfig({ enabled: true }, { enabled: false }), false);
});

test("dedupe exige mesma guild, bot, canal e conjunto não vazio de cargos", () => {
  const first = hierarchyDedupeFingerprint({
    botId: "bot-a",
    guildId: "guild-a",
    panelChannelId: "channel-a",
    roleIds: ["role-b", "role-a", "role-a"]
  });
  const same = hierarchyDedupeFingerprint({
    botId: "bot-a",
    guildId: "guild-a",
    panelChannelId: "channel-a",
    roleIds: ["role-a", "role-b"]
  });
  const distinct = hierarchyDedupeFingerprint({
    botId: "bot-a",
    guildId: "guild-a",
    panelChannelId: "channel-b",
    roleIds: ["role-a", "role-b"]
  });

  assert.ok(first);
  assert.equal(first, same);
  assert.notEqual(first, distinct);
  assert.equal(hierarchyDedupeFingerprint({ botId: "bot-a", guildId: "guild-a", panelChannelId: "channel-a", roleIds: [] }), null);
});
