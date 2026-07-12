import { createHmac, timingSafeEqual } from "node:crypto";
import type { PreferenceRequest } from "mercadopago/dist/clients/preference/commonTypes";
import { getMercadoPagoSdkClient } from "./payments/mercadoPagoClient";

export type MercadoPagoBackUrls = {
  failure: string;
  pending: string;
  success: string;
};

export type MercadoPagoPreferenceItemInput = {
  currencyId: "BRL" | "USD" | "EUR";
  description?: string | null;
  id: string;
  quantity?: number;
  title: string;
  unitPriceInCents: number;
};

export type CreateMercadoPagoPreferenceInput = {
  accessToken: string;
  autoReturn?: "approved" | "all";
  backUrls: MercadoPagoBackUrls;
  binaryMode?: boolean;
  dateOfExpiration?: Date | null;
  environment?: "test" | "production";
  externalReference: string;
  idempotencyKey?: string | null;
  items: MercadoPagoPreferenceItemInput[];
  maxInstallments?: number | null;
  metadata?: Record<string, string | number | boolean | null>;
  notificationUrl?: string | null;
  payerEmail?: string | null;
  statementDescriptor?: string | null;
};

export type MercadoPagoPreferenceResult = {
  checkoutUrl: string;
  preferenceId: string;
  productionCheckoutUrl: string | null;
  sandboxCheckoutUrl: string | null;
};

export async function createMercadoPagoPreference(input: CreateMercadoPagoPreferenceInput): Promise<MercadoPagoPreferenceResult> {
  const body = buildProtectedPreferenceBody(input);
  const { preference } = getMercadoPagoSdkClient(input.accessToken);
  const payload = await preference.create({
    body,
    requestOptions: input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
  }).catch((error: unknown) => {
    throw mercadoPagoError(readSdkError(error) ?? "Mercado Pago recusou a criacao da preferencia.", 502);
  });

  const productionCheckoutUrl = readStringField(payload, "init_point");
  const sandboxCheckoutUrl = readStringField(payload, "sandbox_init_point");
  const checkoutUrl = input.environment === "test" ? sandboxCheckoutUrl : productionCheckoutUrl;
  const preferenceId = readStringField(payload, "id");

  if (!checkoutUrl || !preferenceId) {
    throw mercadoPagoError("Mercado Pago nao retornou a preferencia de checkout.", 502);
  }
  if (!isMercadoPagoCheckoutUrl(checkoutUrl)) {
    throw mercadoPagoError("Mercado Pago retornou uma URL de checkout inesperada.", 502);
  }

  return {
    checkoutUrl,
    preferenceId,
    productionCheckoutUrl,
    sandboxCheckoutUrl
  };
}

export type MercadoPagoPayment = Record<string, unknown>;

export async function getMercadoPagoPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPayment> {
  const { payment } = getMercadoPagoSdkClient(accessToken);
  const payload = await payment.get({ id: paymentId }).catch((error: unknown) => {
    throw mercadoPagoError(readSdkError(error) ?? "Nao foi possivel consultar o pagamento no Mercado Pago.", 502);
  });
  return payload as unknown as MercadoPagoPayment;
}

export function validateMercadoPagoWebhookSignature(input: {
  dataId?: string | null;
  requestId?: string | null;
  secret: string;
  signature?: string | null;
}) {
  const parts = parseSignature(input.signature);
  const ts = parts.get("ts");
  const v1 = parts.get("v1");

  if (!ts || !v1) return false;

  const manifest = [
    input.dataId ? `id:${input.dataId};` : "",
    input.requestId ? `request-id:${input.requestId};` : "",
    `ts:${ts};`
  ].join("");
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

function parseSignature(signature?: string | null) {
  const parts = new Map<string, string>();
  for (const part of (signature ?? "").split(",")) {
    const [key, ...valueParts] = part.trim().split("=");
    const value = valueParts.join("=").trim();
    if (key && value) parts.set(key.trim(), value);
  }
  return parts;
}

function buildProtectedPreferenceBody(input: CreateMercadoPagoPreferenceInput): PreferenceRequest {
  const items = input.items.map((item) => {
    const unitPriceInCents = normalizeCents(item.unitPriceInCents);
    const quantity = normalizeQuantity(item.quantity ?? 1);

    return {
      currency_id: item.currencyId,
      description: trimOptional(item.description),
      id: item.id,
      quantity,
      title: trimRequired(item.title, "Titulo do item Mercado Pago"),
      unit_price: centsToMoney(unitPriceInCents)
    };
  });

  if (!items.length) {
    throw mercadoPagoError("Preferencia Mercado Pago precisa ter ao menos um item.", 400);
  }

  return removeUndefined({
    auto_return: input.autoReturn ?? "approved",
    back_urls: input.backUrls,
    binary_mode: input.binaryMode,
    date_of_expiration: input.dateOfExpiration ? input.dateOfExpiration.toISOString() : undefined,
    expires: Boolean(input.dateOfExpiration),
    external_reference: trimRequired(input.externalReference, "Referencia externa Mercado Pago"),
    items,
    metadata: {
      ...safePreferenceMetadata(input.metadata),
      protected_amount_cents: items.reduce((sum, item) => sum + Math.round(Number(item.unit_price) * 100) * item.quantity, 0),
      protected_by: "nextech_backend"
    },
    notification_url: trimOptional(input.notificationUrl),
    payer: input.payerEmail ? { email: input.payerEmail } : undefined,
    payment_methods: input.maxInstallments ? { installments: input.maxInstallments } : undefined,
    statement_descriptor: trimOptional(input.statementDescriptor)
  });
}

function normalizeCents(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw mercadoPagoError("Valor do checkout Mercado Pago invalido.", 400);
  }

  return Math.round(value);
}

function normalizeQuantity(value: number) {
  if (!Number.isFinite(value) || value < 1) {
    throw mercadoPagoError("Quantidade do checkout Mercado Pago invalida.", 400);
  }

  return Math.floor(value);
}

function centsToMoney(cents: number) {
  return Math.max(0, Math.round(cents)) / 100;
}

function trimRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw mercadoPagoError(`${label} vazio.`, 400);
  return trimmed.slice(0, 255);
}

function trimOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 255) : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readMercadoPagoError(payload: unknown) {
  return readStringField(payload, "message") ?? readStringField(payload, "error");
}

function readStringField(payload: unknown, key: string) {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mercadoPagoStatusToInternal(status: string) {
  switch (status) {
    case "approved":
      return "approved";
    case "authorized":
    case "in_process":
      return "in_process";
    case "pending":
      return "pending";
    case "in_mediation":
      return "in_review";
    case "cancelled":
      return "cancelled";
    case "refunded":
    case "partially_refunded":
      return "refunded";
    case "charged_back":
      return "chargeback";
    case "rejected":
      return "rejected";
    default:
      return "error";
  }
}

function safePreferenceMetadata(metadata?: Record<string, string | number | boolean | null>) {
  if (!metadata) return {};
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80),
    typeof value === "string" ? value.slice(0, 255) : value
  ]));
}

function readSdkError(error: unknown) {
  const candidate = error as { message?: string; cause?: Array<{ description?: string; message?: string }> };
  return candidate.cause?.[0]?.description ?? candidate.cause?.[0]?.message ?? candidate.message ?? null;
}

function isMercadoPagoCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      hostname === "mercadopago.com"
      || hostname.endsWith(".mercadopago.com")
      || hostname === "mercadopago.com.br"
      || hostname.endsWith(".mercadopago.com.br")
      || hostname.endsWith(".mercadopago.com.ar")
      || hostname.endsWith(".mercadopago.com.mx")
      || hostname.endsWith(".mercadopago.cl")
      || hostname.endsWith(".mercadopago.com.co")
      || hostname.endsWith(".mercadopago.com.pe")
      || hostname.endsWith(".mercadopago.com.uy")
    );
  } catch {
    return false;
  }
}

function mercadoPagoError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
