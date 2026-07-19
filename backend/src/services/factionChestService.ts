import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoFactionChestItem,
  type MongoFactionChestLog,
  type MongoFactionChestSettings
} from "../database/mongo";
import { dashboardLogRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const FACTION_CHEST_MODULE_ID = "faction-chest";

export type FactionChestSettingsInput = Partial<Pick<MongoFactionChestSettings,
  "enabled" | "categoryId" | "panelChannelId" | "logChannelId" | "auditChannelId" |
  "registerRoleIds" | "auditRoleIds" | "viewRoleIds" | "adminRoleIds" |
  "systemName" | "panelImageUrl" | "color" | "lastPanelRequestedAt"
>>;

export type FactionChestItemInput = Partial<Pick<MongoFactionChestItem,
  "name" | "quantity" | "category" | "description" | "imageUrl"
>>;

export type FactionChestMovementInput = {
  action: "add" | "remove";
  actorId: string;
  actorName: string;
  channelId?: string | null;
  item: string;
  messageId?: string | null;
  quantity: number;
  reason?: string | null;
};

export async function getFactionChestDashboard(botId: string, guildId: string) {
  const { factionChestItems, factionChestLogs } = await getMongoCollections();
  const [settings, items, logs] = await Promise.all([
    getFactionChestSettings(botId, guildId),
    factionChestItems.find({ botId, guildId }).sort({ category: 1, name: 1 }).limit(1000).toArray(),
    factionChestLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  return {
    items: items.map(itemDto),
    logs: logs.map(logDto),
    settings: settingsDto(settings),
    summary: {
      itemCount: items.length,
      totalQuantity: items.reduce((total, item) => total + item.quantity, 0)
    }
  };
}

export async function getFactionChestSettings(botId: string, guildId: string) {
  const { factionChestSettings } = await getMongoCollections();
  const existing = await factionChestSettings.findOne({ botId, guildId });
  if (existing) return existing;

  const now = new Date();
  const settings: MongoFactionChestSettings = {
    _id: randomUUID(),
    adminRoleIds: [],
    auditChannelId: null,
    auditRoleIds: [],
    botId,
    categoryId: null,
    color: "#22c55e",
    createdAt: now,
    enabled: false,
    guildId,
    lastPanelRequestedAt: null,
    logChannelId: null,
    panelChannelId: null,
    panelImageUrl: null,
    panelMessageId: null,
    registerRoleIds: [],
    systemName: "VINHEDO",
    updatedAt: now,
    updatedBy: null,
    viewRoleIds: []
  };

  await factionChestSettings.updateOne({ botId, guildId }, { $setOnInsert: settings }, { upsert: true });
  return (await factionChestSettings.findOne({ botId, guildId })) ?? settings;
}

export async function saveFactionChestSettings(botId: string, guildId: string, input: FactionChestSettingsInput, actorId: string | null) {
  const current = await getFactionChestSettings(botId, guildId);
  const { factionChestSettings } = await getMongoCollections();
  const now = new Date();
  const patch = normalizeSettingsInput(input);
  const shouldRefreshPanel = current.enabled && Boolean(current.panelMessageId);

  await factionChestSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        ...patch,
        ...(shouldRefreshPanel ? { lastPanelRequestedAt: now } : {}),
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  const saved = (await factionChestSettings.findOne({ botId, guildId }))!;
  emitFactionChestUpdated(botId, guildId, "settings");
  return settingsDto(saved);
}

export async function requestFactionChestPanel(botId: string, guildId: string, actorId: string) {
  return saveFactionChestSettings(botId, guildId, { enabled: true, lastPanelRequestedAt: new Date() }, actorId);
}

export async function updateFactionChestPanelState(botId: string, guildId: string, panelMessageId: string | null) {
  return saveFactionChestSettings(botId, guildId, { panelMessageId } as FactionChestSettingsInput, null);
}

export async function listActiveFactionChestSettings(botId: string) {
  const { factionChestSettings } = await getMongoCollections();
  return (await factionChestSettings.find({ botId, enabled: true }).toArray()).map(settingsDto);
}

export async function saveFactionChestItem(botId: string, guildId: string, itemId: string | null, input: FactionChestItemInput, actorId: string) {
  const { factionChestItems } = await getMongoCollections();
  const now = new Date();
  const id = itemId ?? randomUUID();
  const name = input.name?.trim();
  const normalizedName = name ? normalizeItemName(name) : undefined;
  const patch: Partial<MongoFactionChestItem> = { updatedAt: now, updatedBy: actorId };

  if (name) {
    const duplicate = await factionChestItems.findOne({ _id: { $ne: id }, botId, guildId, normalizedName });
    if (duplicate) throw serviceError("Já existe um item com esse nome neste baú.", 409);
    patch.name = name;
    patch.normalizedName = normalizedName!;
  }

  if (typeof input.quantity === "number") {
    if (!Number.isInteger(input.quantity) || input.quantity < 0) throw serviceError("Quantidade inválida.", 400);
    patch.quantity = input.quantity;
  }
  if (typeof input.category === "string") patch.category = input.category.trim() || "Geral";
  if ("description" in input) patch.description = input.description?.trim() || null;
  if ("imageUrl" in input) patch.imageUrl = input.imageUrl?.trim() || null;

  const insertDefaults: Partial<MongoFactionChestItem> = {
    _id: id,
    botId,
    category: input.category?.trim() || "Geral",
    createdAt: now,
    createdBy: actorId,
    description: input.description?.trim() || null,
    guildId,
    imageUrl: input.imageUrl?.trim() || null,
    name: name || "Novo item",
        normalizedName: normalizedName ?? normalizeItemName("Novo item"),
    quantity: input.quantity ?? 0
  };
  for (const key of Object.keys(patch) as Array<keyof MongoFactionChestItem>) {
    delete insertDefaults[key];
  }

  await factionChestItems.updateOne(
    { _id: id, botId, guildId },
    {
      $set: patch,
      $setOnInsert: insertDefaults
    },
    { upsert: true }
  );

  const saved = (await factionChestItems.findOne({ _id: id, botId, guildId }))!;
  emitFactionChestUpdated(botId, guildId, "item");
  return itemDto(saved);
}

export async function recordFactionChestMovement(botId: string, guildId: string, input: FactionChestMovementInput) {
  const { factionChestItems, factionChestLogs } = await getMongoCollections();
  const quantity = Math.trunc(input.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw serviceError("Informe uma quantidade maior que zero.", 400);

  const name = normalizeDisplayText(input.item, 80);
  if (!name) throw serviceError("Informe o nome do item.", 400);

  const normalizedName = normalizeItemName(name);
  const now = new Date();
  const current = await factionChestItems.findOne({ botId, guildId, normalizedName });
  const previousQuantity = current?.quantity ?? 0;
  const nextQuantity = input.action === "add" ? previousQuantity + quantity : previousQuantity - quantity;

  if (nextQuantity < 0) throw serviceError("Quantidade insuficiente no baú para remover esse valor.", 409);

  let item: MongoFactionChestItem;
  if (current) {
    const updated = await factionChestItems.findOneAndUpdate(
      { _id: current._id, botId, guildId, quantity: previousQuantity },
      { $set: { quantity: nextQuantity, updatedAt: now, updatedBy: input.actorId } },
      { returnDocument: "after" }
    );
    if (!updated) throw serviceError("O item foi alterado ao mesmo tempo. Tente novamente.", 409);
    item = updated;
  } else {
    if (input.action === "remove") throw serviceError("Item não encontrado no baú.", 404);
    item = {
      _id: randomUUID(),
      botId,
      category: "Geral",
      createdAt: now,
      createdBy: input.actorId,
      description: null,
      guildId,
      imageUrl: null,
      name,
      normalizedName,
      quantity: nextQuantity,
      updatedAt: now,
      updatedBy: input.actorId
    };
    await factionChestItems.insertOne(item);
  }

  const log: MongoFactionChestLog = {
    _id: randomUUID(),
    action: input.action,
    actorId: input.actorId,
    actorName: normalizeDisplayText(input.actorName, 100) || input.actorId,
    botId,
    channelId: input.channelId ?? null,
    createdAt: now,
    guildId,
    itemId: item._id,
    itemName: item.name,
    messageId: input.messageId ?? null,
    metadata: null,
    nextQuantity,
    previousQuantity,
    quantity,
    reason: normalizeDisplayText(input.reason ?? "", 500) || null
  };
  await factionChestLogs.insertOne(log);

  emitFactionChestUpdated(botId, guildId, "movement");
  return { item: itemDto(item), log: logDto(log) };
}

function normalizeSettingsInput(input: FactionChestSettingsInput): FactionChestSettingsInput {
  const patch = { ...input };
  if ("systemName" in patch) patch.systemName = normalizeDisplayText(patch.systemName ?? "", 80) || "VINHEDO";
  if ("panelImageUrl" in patch) patch.panelImageUrl = patch.panelImageUrl?.trim() || null;
  for (const key of ["registerRoleIds", "auditRoleIds", "viewRoleIds", "adminRoleIds"] as const) {
    if (Array.isArray(patch[key])) patch[key] = [...new Set(patch[key]!.filter(Boolean))].slice(0, 50);
  }
  return patch;
}

function settingsDto(value: MongoFactionChestSettings) {
  return {
    ...value,
    id: value._id,
    createdAt: value.createdAt.toISOString(),
    lastPanelRequestedAt: value.lastPanelRequestedAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString()
  };
}

function itemDto(value: MongoFactionChestItem) {
  return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
}

function logDto(value: MongoFactionChestLog) {
  return { ...value, id: value._id, createdAt: value.createdAt.toISOString() };
}

function normalizeItemName(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function normalizeDisplayText(value: string, maxLength: number) {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, maxLength);
}

function emitFactionChestUpdated(botId: string, guildId: string, scope: "settings" | "item" | "movement") {
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "faction-chest:updated", { botId, guildId, scope });
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
