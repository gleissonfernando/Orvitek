import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  MongoOrvitechSale,
  MongoOrvitechSalesPaymentProvider,
  MongoOrvitechSalesPlan,
  MongoOrvitechSalesSettings,
  MongoOrvitechSaleStatus
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { decryptSecret, encryptSecret } from "./secretCryptoService";

export const ORVITECH_SALES_MODULE_ID = "orvitech-sales";
export const ORVITECH_PRIMARY_CLIENT_ID = "1492325134550302952";

export type OrvitechSalesSettingsDto = Omit<MongoOrvitechSalesSettings, "_id" | "createdAt" | "updatedAt" | "paymentProviders"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  paymentProviders: OrvitechSalesPaymentProviderDto[];
};

export type OrvitechSalesPaymentProviderDto = Omit<MongoOrvitechSalesPaymentProvider, "secretEncrypted" | "webhookSecretEncrypted" | "updatedAt"> & {
  secretConfigured: boolean;
  secretMasked: string | null;
  webhookSecretConfigured: boolean;
  updatedAt: string;
};

export type OrvitechSalesPlanDto = Omit<MongoOrvitechSalesPlan, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type OrvitechSaleDto = Omit<MongoOrvitechSale, "_id" | "createdAt" | "updatedAt" | "paidAt" | "expiresAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  expiresAt: string | null;
};

export type OrvitechSalesDashboardDto = {
  plans: OrvitechSalesPlanDto[];
  sales: OrvitechSaleDto[];
  settings: OrvitechSalesSettingsDto;
  stats: {
    activePlans: number;
    customers: number;
    paidSales: number;
    pendingSales: number;
    revenueCents: number;
    subscriptions: number;
    salesThisMonth: number;
    totalSales: number;
  };
};

export type SaveOrvitechSalesSettingsInput = Partial<{
  currency: "BRL" | "USD" | "EUR";
  customerRoleId: string | null;
  enabled: boolean;
  logChannelId: string | null;
  panelColor: string;
  panelDescription: string;
  panelImageUrl: string | null;
  panelTitle: string;
  publicUrl: string;
  saleChannelId: string | null;
  supportRoleIds: string[];
  termsUrl: string | null;
  thumbnailUrl: string | null;
}>;

export type SavePaymentProviderInput = {
  enabled: boolean;
  id?: string | null;
  instructions?: string | null;
  label: string;
  provider: MongoOrvitechSalesPaymentProvider["provider"];
  publicKey?: string | null;
  secret?: string | null;
  webhookSecret?: string | null;
  webhookUrl?: string | null;
};

export type SavePlanInput = {
  checkoutMessage?: string | null;
  description?: string | null;
  durationDays?: number | null;
  enabled: boolean;
  imageUrl?: string | null;
  moduleIds: string[];
  name: string;
  priceCents: number;
};

export type SaveSaleInput = {
  amountCents?: number | null;
  buyerId: string;
  buyerName?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  paymentProviderId?: string | null;
  planId?: string | null;
  status: MongoOrvitechSaleStatus;
};

export type ProcessWebhookInput = {
  eventId?: string | null;
  eventType?: string | null;
  payload: unknown;
  rawBody: string;
  signature?: string | null;
};

export async function getOrvitechSalesDashboard(botId: string, guildId: string, ownerUserId: string) {
  const { orvitechCustomers, orvitechSales, orvitechSalesPlans, orvitechSubscriptions } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, ownerUserId);
  const scope = tenantScope(botId, guildId, ownerUserId, settings.storeId);
  const [plans, sales, customers, subscriptions] = await Promise.all([
    orvitechSalesPlans.find(scope).sort({ createdAt: -1 }).toArray(),
    orvitechSales.find(scope).sort({ createdAt: -1 }).limit(100).toArray(),
    orvitechCustomers.countDocuments(scope),
    orvitechSubscriptions.countDocuments({ ...scope, status: "active" })
  ]);

  return toDashboardDto(settings, plans, sales, customers, subscriptions);
}

export async function ensureOrvitechSalesSettings(botId: string, guildId: string, ownerUserId: string) {
  const { orvitechSalesSettings } = await getMongoCollections();
  const existing = await orvitechSalesSettings.findOne({ botId, guildId, ownerUserId });

  if (existing) {
    return normalizeExistingSettings(existing);
  }

  const now = new Date();
  const storeId = randomUUID();
  const settings: MongoOrvitechSalesSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    storeId,
    enabled: false,
    ownerUserId,
    publicUrl: `/orvitech/${storeId}`,
    currency: "BRL",
    saleChannelId: null,
    logChannelId: null,
    supportRoleIds: [],
    customerRoleId: null,
    panelTitle: "OrviTech Bot",
    panelDescription: "Planos, liberacoes e pagamentos do bot OrviTech.",
    panelColor: "#7c3aed",
    panelImageUrl: null,
    thumbnailUrl: null,
    termsUrl: null,
    paymentProviders: [
      {
        id: randomUUID(),
        gatewayId: randomUUID(),
        ownerUserId,
        storeId,
        enabled: true,
        label: "Pagamento manual",
        provider: "manual",
        publicKey: null,
        secretEncrypted: null,
        webhookSecretEncrypted: null,
        webhookUrl: null,
        instructions: "Registre a venda como pendente e marque como paga depois da confirmacao.",
        updatedAt: now
      }
    ],
    createdBy: ownerUserId,
    updatedBy: ownerUserId,
    createdAt: now,
    updatedAt: now
  };

  await orvitechSalesSettings.insertOne(settings);
  return settings;
}

async function normalizeExistingSettings(settings: MongoOrvitechSalesSettings) {
  if (settings.storeId && settings.paymentProviders.every((provider) => provider.gatewayId && provider.ownerUserId && provider.storeId)) {
    return settings;
  }

  const { orvitechSalesSettings } = await getMongoCollections();
  const storeId = settings.storeId || randomUUID();
  const paymentProviders = settings.paymentProviders.map((provider) => ({
    ...provider,
    gatewayId: provider.gatewayId || randomUUID(),
    ownerUserId: provider.ownerUserId || settings.ownerUserId,
    storeId: provider.storeId || storeId,
    webhookSecretEncrypted: provider.webhookSecretEncrypted ?? null
  }));

  await orvitechSalesSettings.updateOne(
    { _id: settings._id, ownerUserId: settings.ownerUserId },
    {
      $set: {
        paymentProviders,
        storeId,
        updatedAt: new Date()
      }
    }
  );

  return {
    ...settings,
    paymentProviders,
    storeId
  };
}

export async function saveOrvitechSalesSettings(botId: string, guildId: string, input: SaveOrvitechSalesSettingsInput, actorId: string) {
  const current = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const now = new Date();
  const patch: Partial<MongoOrvitechSalesSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };

  for (const key of [
    "currency",
    "customerRoleId",
    "enabled",
    "logChannelId",
    "panelColor",
    "panelDescription",
    "panelImageUrl",
    "panelTitle",
    "publicUrl",
    "saleChannelId",
    "supportRoleIds",
    "termsUrl",
    "thumbnailUrl"
  ] as const) {
    if (input[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = input[key];
    }
  }

  const { orvitechSalesSettings } = await getMongoCollections();
  await orvitechSalesSettings.updateOne({ _id: current._id, ownerUserId: actorId }, { $set: patch });
  return (await orvitechSalesSettings.findOne({ _id: current._id, ownerUserId: actorId })) ?? current;
}

export async function saveOrvitechPaymentProvider(botId: string, guildId: string, input: SavePaymentProviderInput, actorId: string) {
  const current = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const now = new Date();
  const existing = current.paymentProviders.find((provider) => provider.id === input.id);
  const nextProvider: MongoOrvitechSalesPaymentProvider = {
    id: existing?.id ?? randomUUID(),
    gatewayId: existing?.gatewayId ?? randomUUID(),
    ownerUserId: actorId,
    storeId: current.storeId,
    enabled: input.enabled,
    label: input.label.trim(),
    provider: input.provider,
    publicKey: normalizeNullable(input.publicKey),
    secretEncrypted: input.secret?.trim() ? encryptSecret(input.secret.trim()) : existing?.secretEncrypted ?? null,
    webhookSecretEncrypted: input.webhookSecret?.trim() ? encryptSecret(input.webhookSecret.trim()) : existing?.webhookSecretEncrypted ?? null,
    webhookUrl: normalizeNullable(input.webhookUrl),
    instructions: normalizeNullable(input.instructions),
    updatedAt: now
  };
  const paymentProviders = existing
    ? current.paymentProviders.map((provider) => provider.id === existing.id ? nextProvider : provider)
    : [nextProvider, ...current.paymentProviders];

  const { orvitechSalesSettings } = await getMongoCollections();
  await orvitechSalesSettings.updateOne(
    { _id: current._id, ownerUserId: actorId },
    {
      $set: {
        paymentProviders,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  return (await orvitechSalesSettings.findOne({ _id: current._id, ownerUserId: actorId })) ?? current;
}

export async function deleteOrvitechPaymentProvider(botId: string, guildId: string, providerId: string, actorId: string) {
  const current = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const nextProviders = current.paymentProviders.filter((provider) => provider.id !== providerId);

  const { orvitechSalesSettings } = await getMongoCollections();
  await orvitechSalesSettings.updateOne(
    { _id: current._id, ownerUserId: actorId },
    {
      $set: {
        paymentProviders: nextProviders,
        updatedAt: new Date(),
        updatedBy: actorId
      }
    }
  );

  return (await orvitechSalesSettings.findOne({ _id: current._id, ownerUserId: actorId })) ?? current;
}

export async function saveOrvitechSalesPlan(botId: string, guildId: string, planId: string | null, input: SavePlanInput, actorId: string) {
  const { orvitechSalesPlans } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const now = new Date();

  if (planId) {
    await orvitechSalesPlans.updateOne(
      { _id: planId, ...scope },
      {
        $set: {
          checkoutMessage: normalizeNullable(input.checkoutMessage),
          description: normalizeNullable(input.description),
          durationDays: input.durationDays ?? null,
          enabled: input.enabled,
          imageUrl: normalizeNullable(input.imageUrl),
          moduleIds: [...new Set(input.moduleIds)],
          name: input.name.trim(),
          priceCents: input.priceCents,
          updatedAt: now,
          updatedBy: actorId
        }
      }
    );

    return orvitechSalesPlans.findOne({ _id: planId, ...scope });
  }

  const plan: MongoOrvitechSalesPlan = {
    _id: randomUUID(),
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    name: input.name.trim(),
    description: normalizeNullable(input.description),
    priceCents: input.priceCents,
    durationDays: input.durationDays ?? null,
    enabled: input.enabled,
    moduleIds: [...new Set(input.moduleIds)],
    imageUrl: normalizeNullable(input.imageUrl),
    checkoutMessage: normalizeNullable(input.checkoutMessage),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };

  await orvitechSalesPlans.insertOne(plan);
  return plan;
}

export async function deleteScopedOrvitechSalesPlan(botId: string, guildId: string, planId: string, ownerUserId: string) {
  const { orvitechSalesPlans } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, ownerUserId);
  const deleted = await orvitechSalesPlans.findOneAndDelete({ _id: planId, ...tenantScope(botId, guildId, ownerUserId, settings.storeId) });
  return deleted;
}

export async function saveOrvitechSale(botId: string, guildId: string, input: SaveSaleInput, actorId: string) {
  const { orvitechCustomers, orvitechSales, orvitechSalesPlans, orvitechSubscriptions } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const plan = input.planId ? await orvitechSalesPlans.findOne({ _id: input.planId, ...scope }) : null;
  const now = new Date();
  const provider = settings.paymentProviders.find((item) => item.id === input.paymentProviderId) ?? null;
  const customer = await upsertCustomer(orvitechCustomers, {
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    buyerId: input.buyerId.trim(),
    buyerName: normalizeNullable(input.buyerName),
    now
  });
  const amountCents = input.amountCents ?? plan?.priceCents ?? 0;
  const paidAt = input.status === "paid" ? now : null;
  const expiresAt = paidAt && plan?.durationDays ? new Date(paidAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000) : null;
  const sale: MongoOrvitechSale = {
    _id: randomUUID(),
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    planId: plan?._id ?? null,
    planName: plan?.name ?? "Venda avulsa",
    customerId: customer._id,
    buyerId: input.buyerId.trim(),
    buyerName: normalizeNullable(input.buyerName),
    amountCents,
    currency: settings.currency,
    paymentGatewayId: provider?.gatewayId ?? null,
    paymentProviderId: provider?.id ?? null,
    paymentProviderLabel: provider?.label ?? null,
    externalReference: normalizeNullable(input.externalReference),
    status: input.status,
    notes: normalizeNullable(input.notes),
    paidAt,
    expiresAt,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };

  await orvitechSales.insertOne(sale);
  if (sale.status === "paid" && plan) {
    await orvitechSubscriptions.insertOne({
      _id: randomUUID(),
      botId,
      guildId,
      ownerUserId: actorId,
      storeId: settings.storeId,
      customerId: customer._id,
      planId: plan._id,
      saleId: sale._id,
      status: "active",
      startsAt: paidAt ?? now,
      expiresAt,
      createdAt: now,
      updatedAt: now
    });
  }
  return sale;
}

export async function updateOrvitechSaleStatus(botId: string, guildId: string, saleId: string, status: MongoOrvitechSaleStatus, actorId: string) {
  const { orvitechSales, orvitechSalesPlans, orvitechSubscriptions } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const sale = await orvitechSales.findOne({ _id: saleId, ...scope });

  if (!sale) return null;

  const plan = sale.planId ? await orvitechSalesPlans.findOne({ _id: sale.planId, ...scope }) : null;
  const now = new Date();
  const paidAt = status === "paid" ? sale.paidAt ?? now : sale.paidAt;
  const expiresAt = status === "paid" && paidAt && plan?.durationDays
    ? sale.expiresAt ?? new Date(paidAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000)
    : sale.expiresAt;

  await orvitechSales.updateOne(
    { _id: saleId, ...scope },
    {
      $set: {
        expiresAt,
        paidAt,
        status,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  const updated = await orvitechSales.findOne({ _id: saleId, ...scope });
  if (updated?.status === "paid" && plan) {
    await orvitechSubscriptions.updateOne(
      { saleId: updated._id, ...scope },
      {
        $set: {
          expiresAt,
          status: "active",
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId,
          guildId,
          ownerUserId: actorId,
          storeId: settings.storeId,
          customerId: updated.customerId,
          planId: plan._id,
          saleId: updated._id,
          startsAt: paidAt ?? now,
          createdAt: now
        }
      },
      { upsert: true }
    );
  }

  return updated;
}

export async function processOrvitechPaymentWebhook(storeId: string, gatewayId: string, input: ProcessWebhookInput) {
  const { orvitechSalesSettings, orvitechWebhookLogs } = await getMongoCollections();
  const settings = await orvitechSalesSettings.findOne({ storeId });

  if (!settings) {
    return {
      accepted: false,
      reason: "store_not_found" as const,
      statusCode: 404
    };
  }

  const provider = settings.paymentProviders.find((item) => item.gatewayId === gatewayId);

  if (!provider) {
    return {
      accepted: false,
      reason: "gateway_not_found" as const,
      statusCode: 404
    };
  }

  const signatureValid = validateWebhookSignature(provider.webhookSecretEncrypted ?? null, input.rawBody, input.signature ?? null);
  const now = new Date();

  await orvitechWebhookLogs.insertOne({
    _id: randomUUID(),
    botId: settings.botId,
    guildId: settings.guildId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    paymentGatewayId: provider.gatewayId,
    eventId: normalizeNullable(input.eventId),
    eventType: normalizeNullable(input.eventType) ?? "payment.webhook",
    signatureValid,
    processed: signatureValid,
    saleId: readWebhookSaleId(input.payload),
    createdAt: now
  });

  if (!signatureValid) {
    return {
      accepted: false,
      reason: "invalid_signature" as const,
      statusCode: 401
    };
  }

  return {
    accepted: true,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    statusCode: 202
  };
}

function toDashboardDto(settings: MongoOrvitechSalesSettings, plans: MongoOrvitechSalesPlan[], sales: MongoOrvitechSale[], customers: number, subscriptions: number): OrvitechSalesDashboardDto {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return {
    settings: toSettingsDto(settings),
    plans: plans.map(toPlanDto),
    sales: sales.map(toSaleDto),
    stats: {
      activePlans: plans.filter((plan) => plan.enabled).length,
      customers,
      paidSales: sales.filter((sale) => sale.status === "paid").length,
      pendingSales: sales.filter((sale) => sale.status === "pending").length,
      revenueCents: sales.filter((sale) => sale.status === "paid").reduce((total, sale) => total + sale.amountCents, 0),
      salesThisMonth: sales.filter((sale) => sale.createdAt >= monthStart).length,
      subscriptions,
      totalSales: sales.length
    }
  };
}

export function toSettingsDto(settings: MongoOrvitechSalesSettings): OrvitechSalesSettingsDto {
  return {
    ...settings,
    id: settings._id,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
    paymentProviders: settings.paymentProviders.map(toPaymentProviderDto)
  };
}

export function toPlanDto(plan: MongoOrvitechSalesPlan): OrvitechSalesPlanDto {
  return {
    ...plan,
    id: plan._id,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString()
  };
}

export function toSaleDto(sale: MongoOrvitechSale): OrvitechSaleDto {
  return {
    ...sale,
    id: sale._id,
    paidAt: sale.paidAt?.toISOString() ?? null,
    expiresAt: sale.expiresAt?.toISOString() ?? null,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString()
  };
}

function toPaymentProviderDto(provider: MongoOrvitechSalesPaymentProvider): OrvitechSalesPaymentProviderDto {
  return {
    id: provider.id,
    gatewayId: provider.gatewayId,
    ownerUserId: provider.ownerUserId,
    storeId: provider.storeId,
    enabled: provider.enabled,
    label: provider.label,
    provider: provider.provider,
    publicKey: provider.publicKey,
    webhookUrl: provider.webhookUrl,
    instructions: provider.instructions,
    secretConfigured: Boolean(provider.secretEncrypted),
    secretMasked: provider.secretEncrypted ? "******** protegido" : null,
    webhookSecretConfigured: Boolean(provider.webhookSecretEncrypted),
    updatedAt: provider.updatedAt.toISOString()
  };
}

function tenantScope(botId: string, guildId: string, ownerUserId: string, storeId: string) {
  return {
    botId,
    guildId,
    ownerUserId,
    storeId
  };
}

async function upsertCustomer(
  collection: Awaited<ReturnType<typeof getMongoCollections>>["orvitechCustomers"],
  input: {
    botId: string;
    buyerId: string;
    buyerName: string | null;
    guildId: string;
    now: Date;
    ownerUserId: string;
    storeId: string;
  }
) {
  const existing = await collection.findOne({
    discordId: input.buyerId,
    ownerUserId: input.ownerUserId,
    storeId: input.storeId
  });

  if (existing) {
    await collection.updateOne(
      { _id: existing._id, ownerUserId: input.ownerUserId, storeId: input.storeId },
      {
        $set: {
          name: input.buyerName ?? existing.name,
          updatedAt: input.now
        }
      }
    );
    return (await collection.findOne({ _id: existing._id, ownerUserId: input.ownerUserId, storeId: input.storeId })) ?? existing;
  }

  const customer = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    ownerUserId: input.ownerUserId,
    storeId: input.storeId,
    discordId: input.buyerId,
    name: input.buyerName,
    email: null,
    createdAt: input.now,
    updatedAt: input.now
  };

  await collection.insertOne(customer);
  return customer;
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function validateWebhookSignature(secretEncrypted: string | null, rawBody: string, signature: string | null) {
  if (!secretEncrypted) {
    return true;
  }

  if (!signature) {
    return false;
  }

  try {
    const secret = decryptSecret(secretEncrypted);
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const normalizedSignature = signature.replace(/^sha256=/i, "").trim();
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(normalizedSignature, "hex");

    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}

function readWebhookSaleId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const saleId = record.saleId ?? record.sale_id ?? record.external_reference ?? record.externalReference;

  return typeof saleId === "string" ? saleId : null;
}
