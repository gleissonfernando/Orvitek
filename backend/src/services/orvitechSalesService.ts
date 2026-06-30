import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MongoOrvitechProduct,
  MongoOrvitechProductFeatureKey,
  MongoOrvitechProductPlanConfig,
  MongoOrvitechSale,
  MongoOrvitechSalePlanType,
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

export type OrvitechProductDto = Omit<MongoOrvitechProduct, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  publicUrl: string;
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
  products: OrvitechProductDto[];
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

export type PublicOrvitechProductDto = {
  paymentProviders: Array<Pick<OrvitechSalesPaymentProviderDto, "gatewayId" | "id" | "label" | "provider">>;
  product: OrvitechProductDto;
  settings: Pick<OrvitechSalesSettingsDto, "currency" | "enabled" | "panelColor" | "storeId" | "termsUrl">;
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

export type SaveProductInput = {
  active: boolean;
  additionalInfo?: string | null;
  bannerUrl?: string | null;
  category: string;
  fullDescription?: string | null;
  howItWorks?: string | null;
  layout?: Partial<MongoOrvitechProduct["layout"]>;
  name: string;
  observations?: string | null;
  plans: {
    lifetime: Partial<MongoOrvitechProductPlanConfig> & Pick<MongoOrvitechProductPlanConfig, "enabled" | "name" | "priceCents">;
    monthly: Partial<MongoOrvitechProductPlanConfig> & Pick<MongoOrvitechProductPlanConfig, "enabled" | "name" | "priceCents">;
  };
  seo?: Partial<MongoOrvitechProduct["seo"]>;
  shortDescription?: string | null;
  slug?: string | null;
  toggles?: Partial<Record<MongoOrvitechProductFeatureKey, boolean>>;
  warnings?: string | null;
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

export type ProductCheckoutInput = {
  buyerEmail?: string | null;
  buyerId?: string | null;
  buyerName?: string | null;
  paymentProviderId?: string | null;
  planType: Exclude<MongoOrvitechSalePlanType, "manual">;
};

const PRODUCT_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/orvitech-products");
const PRODUCT_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export type ProcessWebhookInput = {
  eventId?: string | null;
  eventType?: string | null;
  payload: unknown;
  rawBody: string;
  signature?: string | null;
};

export async function getOrvitechSalesDashboard(botId: string, guildId: string, ownerUserId: string) {
  const { orvitechCustomers, orvitechProducts, orvitechSales, orvitechSalesPlans, orvitechSubscriptions } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, ownerUserId);
  const scope = tenantScope(botId, guildId, ownerUserId, settings.storeId);
  const [plans, products, sales, customers, subscriptions] = await Promise.all([
    orvitechSalesPlans.find(scope).sort({ createdAt: -1 }).toArray(),
    orvitechProducts.find(scope).sort({ updatedAt: -1 }).toArray(),
    orvitechSales.find(scope).sort({ createdAt: -1 }).limit(100).toArray(),
    orvitechCustomers.countDocuments(scope),
    orvitechSubscriptions.countDocuments({ ...scope, status: "active" })
  ]);

  return toDashboardDto(settings, plans, products, sales, customers, subscriptions);
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

export async function saveOrvitechProduct(botId: string, guildId: string, productId: string | null, input: SaveProductInput, actorId: string) {
  const { orvitechProducts } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const now = new Date();
  const slug = slugifyProduct(input.slug || input.name);
  const productPatch = productFieldsFromInput(input, settings);

  if (productId) {
    await orvitechProducts.updateOne(
      { _id: productId, ...scope },
      {
        $set: {
          ...productPatch,
          slug: productId ? slug : await uniqueProductSlug(settings.storeId, slug),
          updatedAt: now,
          updatedBy: actorId
        }
      }
    );

    return orvitechProducts.findOne({ _id: productId, ...scope });
  }

  const product: MongoOrvitechProduct = {
    _id: randomUUID(),
    botId,
    guildId,
    ownerUserId: actorId,
    storeId: settings.storeId,
    slug: await uniqueProductSlug(settings.storeId, slug),
    createdBy: actorId,
    createdAt: now,
    updatedBy: actorId,
    updatedAt: now,
    ...productPatch
  };

  await orvitechProducts.insertOne(product);
  return product;
}

export async function duplicateOrvitechProduct(botId: string, guildId: string, productId: string, actorId: string) {
  const { orvitechProducts } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  const scope = tenantScope(botId, guildId, actorId, settings.storeId);
  const product = await orvitechProducts.findOne({ _id: productId, ...scope });

  if (!product) return null;

  const now = new Date();
  const copy: MongoOrvitechProduct = {
    ...product,
    _id: randomUUID(),
    name: `${product.name} Copia`,
    slug: await uniqueProductSlug(settings.storeId, `${product.slug}-copia`),
    active: false,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId
  };

  await orvitechProducts.insertOne(copy);
  return copy;
}

export async function deleteOrvitechProduct(botId: string, guildId: string, productId: string, actorId: string) {
  const { orvitechProducts } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(botId, guildId, actorId);
  return orvitechProducts.findOneAndDelete({ _id: productId, ...tenantScope(botId, guildId, actorId, settings.storeId) });
}

export async function saveOrvitechProductBannerUpload(input: {
  actorId: string;
  botId: string;
  buffer: Buffer;
  guildId: string;
  mimeType: string;
  productId: string;
}) {
  const extension = PRODUCT_IMAGE_EXTENSIONS[input.mimeType];

  if (!extension) {
    throw createOrvitechSalesError("Formato de imagem nao suportado.", 400);
  }

  const { orvitechProducts } = await getMongoCollections();
  const settings = await ensureOrvitechSalesSettings(input.botId, input.guildId, input.actorId);
  const scope = tenantScope(input.botId, input.guildId, input.actorId, settings.storeId);
  const product = await orvitechProducts.findOne({ _id: input.productId, ...scope });

  if (!product) {
    throw createOrvitechSalesError("Produto nao encontrado.", 404);
  }

  await fs.mkdir(PRODUCT_UPLOAD_DIR, { recursive: true });
  const filename = `${settings.storeId}-${product._id}-${Date.now()}.${extension}`;
  const filePath = path.join(PRODUCT_UPLOAD_DIR, filename);
  await fs.writeFile(filePath, input.buffer);

  const bannerUrl = `/uploads/orvitech-products/${filename}`;
  await orvitechProducts.updateOne(
    { _id: input.productId, ...scope },
    {
      $set: {
        bannerUrl,
        updatedAt: new Date(),
        updatedBy: input.actorId
      }
    }
  );

  return orvitechProducts.findOne({ _id: input.productId, ...scope });
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
    productId: null,
    productName: null,
    productPlanType: "manual",
    productSlug: null,
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

export async function getPublicOrvitechProduct(storeId: string, slug: string): Promise<PublicOrvitechProductDto | null> {
  const { orvitechProducts, orvitechSalesSettings } = await getMongoCollections();
  const [settings, product] = await Promise.all([
    orvitechSalesSettings.findOne({ storeId }),
    orvitechProducts.findOne({ storeId, slug: slugifyProduct(slug), active: true })
  ]);

  if (!settings || !product || !settings.enabled) {
    return null;
  }

  return {
    settings: {
      currency: settings.currency,
      enabled: settings.enabled,
      panelColor: settings.panelColor,
      storeId: settings.storeId,
      termsUrl: settings.termsUrl
    },
    product: toProductDto(product),
    paymentProviders: settings.paymentProviders
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        gatewayId: provider.gatewayId,
        id: provider.id,
        label: provider.label,
        provider: provider.provider
      }))
  };
}

export async function createProductCheckout(storeId: string, slug: string, input: ProductCheckoutInput) {
  const { orvitechCustomers, orvitechProducts, orvitechSales, orvitechSalesSettings } = await getMongoCollections();
  const settings = await orvitechSalesSettings.findOne({ storeId });
  const product = await orvitechProducts.findOne({ storeId, slug: slugifyProduct(slug), active: true });

  if (!settings || !product || !settings.enabled) {
    return null;
  }

  const plan = product.plans[input.planType];

  if (!plan.enabled) {
    throw createOrvitechSalesError("Plano indisponivel para este produto.", 400);
  }

  const provider = settings.paymentProviders.find((item) => item.id === input.paymentProviderId && item.enabled)
    ?? settings.paymentProviders.find((item) => item.id === plan.paymentProviderId && item.enabled)
    ?? settings.paymentProviders.find((item) => item.enabled)
    ?? null;

  if (!provider) {
    throw createOrvitechSalesError("Nenhum gateway de pagamento ativo nesta loja.", 400);
  }

  const now = new Date();
  const buyerId = input.buyerId?.trim() || `guest-${randomUUID()}`;
  const customer = await upsertCustomer(orvitechCustomers, {
    botId: settings.botId,
    guildId: settings.guildId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    buyerId,
    buyerName: normalizeNullable(input.buyerName) ?? normalizeNullable(input.buyerEmail),
    now
  });
  const sale: MongoOrvitechSale = {
    _id: randomUUID(),
    botId: settings.botId,
    guildId: settings.guildId,
    ownerUserId: settings.ownerUserId,
    storeId: settings.storeId,
    planId: null,
    planName: plan.name,
    customerId: customer._id,
    buyerId,
    buyerName: normalizeNullable(input.buyerName),
    amountCents: plan.priceCents,
    currency: settings.currency,
    paymentGatewayId: provider.gatewayId,
    paymentProviderId: provider.id,
    paymentProviderLabel: provider.label,
    productId: product._id,
    productName: product.name,
    productPlanType: input.planType,
    productSlug: product.slug,
    externalReference: null,
    status: "pending",
    notes: `Checkout publico ${input.planType}`,
    paidAt: null,
    expiresAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now
  };

  await orvitechSales.insertOne(sale);
  return {
    gatewayId: provider.gatewayId,
    instructions: provider.instructions,
    provider: provider.provider,
    publicKey: provider.publicKey,
    sale: toSaleDto(sale)
  };
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

function toDashboardDto(
  settings: MongoOrvitechSalesSettings,
  plans: MongoOrvitechSalesPlan[],
  products: MongoOrvitechProduct[],
  sales: MongoOrvitechSale[],
  customers: number,
  subscriptions: number
): OrvitechSalesDashboardDto {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return {
    settings: toSettingsDto(settings),
    plans: plans.map(toPlanDto),
    products: products.map(toProductDto),
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

export function toProductDto(product: MongoOrvitechProduct): OrvitechProductDto {
  return {
    ...product,
    id: product._id,
    publicUrl: `/orvitech/${product.storeId}/${product.slug}`,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString()
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

function productFieldsFromInput(input: SaveProductInput, settings: MongoOrvitechSalesSettings): Omit<
  MongoOrvitechProduct,
  "_id" | "botId" | "createdAt" | "createdBy" | "guildId" | "ownerUserId" | "slug" | "storeId" | "updatedAt" | "updatedBy"
> {
  return {
    active: input.active,
    additionalInfo: normalizeNullable(input.additionalInfo) ?? "",
    bannerUrl: normalizeNullable(input.bannerUrl),
    category: input.category.trim() || "Produto digital",
    fullDescription: normalizeNullable(input.fullDescription) ?? "",
    howItWorks: normalizeNullable(input.howItWorks) ?? "",
    layout: {
      accentColor: input.layout?.accentColor?.trim() || settings.panelColor || "#7c3aed",
      glassEffect: input.layout?.glassEffect ?? true,
      theme: input.layout?.theme ?? "dark"
    },
    name: input.name.trim(),
    observations: normalizeNullable(input.observations) ?? "",
    plans: {
      monthly: normalizePlan(input.plans.monthly, "Plano Mensal", "Mensal", 30, settings.paymentProviders[0]?.id ?? null),
      lifetime: normalizePlan(input.plans.lifetime, "Plano Vitalicio", "Vitalicio", 0, settings.paymentProviders[0]?.id ?? null)
    },
    seo: {
      description: normalizeNullable(input.seo?.description),
      title: normalizeNullable(input.seo?.title)
    },
    shortDescription: normalizeNullable(input.shortDescription) ?? "",
    toggles: normalizeFeatureToggles(input.toggles),
    warnings: normalizeNullable(input.warnings) ?? ""
  };
}

function normalizePlan(
  plan: SaveProductInput["plans"]["monthly"],
  fallbackName: string,
  fallbackButton: string,
  fallbackPrice: number,
  fallbackProviderId: string | null
): MongoOrvitechProductPlanConfig {
  return {
    benefits: Array.isArray(plan.benefits) ? plan.benefits.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    buttonColor: plan.buttonColor?.trim() || "#7c3aed",
    buttonText: plan.buttonText?.trim() || fallbackButton,
    description: plan.description?.trim() || "",
    enabled: plan.enabled,
    name: plan.name.trim() || fallbackName,
    paymentProviderId: plan.paymentProviderId ?? fallbackProviderId,
    priceCents: Number.isFinite(plan.priceCents) ? plan.priceCents : fallbackPrice,
    priceText: plan.priceText?.trim() || ""
  };
}

function normalizeFeatureToggles(toggles: SaveProductInput["toggles"] = {}) {
  const keys: MongoOrvitechProductFeatureKey[] = [
    "hosting",
    "updates",
    "support",
    "automaticContract",
    "automaticPix",
    "releaseCode",
    "coupons",
    "automaticRenewal",
    "passwordCreation",
    "automaticLogin",
    "activationKey"
  ];

  return Object.fromEntries(keys.map((key) => [key, Boolean(toggles[key])])) as Record<MongoOrvitechProductFeatureKey, boolean>;
}

function slugifyProduct(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "produto";
}

async function uniqueProductSlug(storeId: string, wantedSlug: string) {
  const { orvitechProducts } = await getMongoCollections();
  const base = slugifyProduct(wantedSlug);
  let slug = base;
  let suffix = 2;

  while (await orvitechProducts.findOne({ storeId, slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function createOrvitechSalesError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
