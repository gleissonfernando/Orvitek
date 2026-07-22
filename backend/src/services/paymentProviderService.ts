import {
  createMercadoPagoPixOrder,
  createMercadoPagoPixPayment,
  createMercadoPagoPreference,
  getMercadoPagoOrder,
  getMercadoPagoPayment,
  mercadoPagoOrderStatusToInternal,
  mercadoPagoStatusToInternal,
  validateMercadoPagoWebhookSignature,
  type CreateMercadoPagoPixOrderInput,
  type CreateMercadoPagoPixPaymentInput,
  type CreateMercadoPagoPreferenceInput,
  type MercadoPagoPixOrderResult,
  type MercadoPagoPixPaymentResult,
  type MercadoPagoPayment,
  type MercadoPagoPreferenceResult
} from "./mercadoPagoService";
import type { MercadoPagoRuntimeConfig } from "../config/payments";
import {
  createPagBankCheckout,
  createPagBankPixOrder,
  getPagBankOrder,
  getPagBankPayment,
  pagBankStatusToInternal,
  validatePagBankWebhookToken,
  type CreatePagBankCheckoutInput,
  type CreatePagBankPixOrderInput,
  type PagBankRuntimeConfig
} from "./pagBankService";

export type ProviderPaymentStatus = "pending" | "in_process" | "approved" | "cancelled" | "expired" | "rejected" | "refunded" | "chargeback" | "in_review" | "error";

export type ProviderPayment = {
  amountInCents: number;
  currency: string | null;
  externalReference: string | null;
  id: string;
  method: string | null;
  paymentType: string | null;
  raw: Record<string, unknown>;
  rawStatus: string;
  status: ProviderPaymentStatus;
  statusDetail: string | null;
};

export type WebhookValidationInput = {
  dataId: string | null;
  requestId: string | null;
  signature: string | null;
  webhookToken?: string | null;
};

export type ProviderPixPaymentResult = MercadoPagoPixPaymentResult;
export type ProviderPixOrderResult = MercadoPagoPixOrderResult | Awaited<ReturnType<typeof createPagBankPixOrder>>;
export type ProviderCheckoutResult = MercadoPagoPreferenceResult | Awaited<ReturnType<typeof createPagBankCheckout>>;

export type PaymentProvider = {
  readonly provider: "mercadopago" | "pagbank";
  createPixPayment(input: Omit<CreateMercadoPagoPixPaymentInput, "accessToken">): Promise<MercadoPagoPixPaymentResult>;
  createPixOrder(input: Omit<CreateMercadoPagoPixOrderInput, "accessToken"> | CreatePagBankPixOrderInput): Promise<ProviderPixOrderResult>;
  createOneTimeCheckout(input: Omit<CreateMercadoPagoPreferenceInput, "accessToken"> | CreatePagBankCheckoutInput): Promise<ProviderCheckoutResult>;
  getOrder(orderId: string): Promise<ProviderPixOrderResult>;
  getPayment(paymentId: string): Promise<ProviderPayment>;
  validateWebhook(input: WebhookValidationInput): Promise<boolean>;
};

export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly provider = "mercadopago" as const;

  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret?: string | null
  ) {}

  createPixPayment(input: Omit<CreateMercadoPagoPixPaymentInput, "accessToken">) {
    return createMercadoPagoPixPayment({
      ...input,
      accessToken: this.accessToken
    });
  }

  createPixOrder(input: Omit<CreateMercadoPagoPixOrderInput, "accessToken">) {
    return createMercadoPagoPixOrder({
      ...input,
      accessToken: this.accessToken
    });
  }

  createOneTimeCheckout(input: Omit<CreateMercadoPagoPreferenceInput, "accessToken">) {
    return createMercadoPagoPreference({
      ...input,
      accessToken: this.accessToken
    });
  }

  async getOrder(orderId: string) {
    const order = await getMercadoPagoOrder(this.accessToken, orderId);
    return {
      ...order,
      status: mercadoPagoOrderStatusToInternal(order)
    };
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    const raw = await getMercadoPagoPayment(this.accessToken, paymentId);
    const providerStatus = readString(raw.status) ?? "unknown";
    const paymentMethodId = readString(raw.payment_method_id);
    const paymentTypeId = readString(raw.payment_type_id);
    return {
      amountInCents: moneyToCents(raw.transaction_amount),
      currency: readString(raw.currency_id),
      externalReference: readString(raw.external_reference),
      id: readString(raw.id) ?? paymentId,
      method: paymentMethodId ?? paymentTypeId,
      paymentType: paymentTypeId,
      raw,
      rawStatus: providerStatus,
      status: mercadoPagoStatusToInternal(providerStatus) as ProviderPaymentStatus,
      statusDetail: readString(raw.status_detail)
    };
  }

  async validateWebhook(input: WebhookValidationInput) {
    if (!this.webhookSecret) return false;
    return validateMercadoPagoWebhookSignature({
      dataId: input.dataId,
      requestId: input.requestId,
      secret: this.webhookSecret,
      signature: input.signature
    });
  }
}

export class PagBankPaymentProvider implements PaymentProvider {
  readonly provider = "pagbank" as const;

  constructor(private readonly config: PagBankRuntimeConfig) {}

  async createPixPayment(input: Omit<CreateMercadoPagoPixPaymentInput, "accessToken">) {
    const order = await this.createPixOrder(input);
    return {
      amountInCents: order.amountInCents,
      currency: order.currency,
      externalReference: order.externalReference,
      paymentId: order.paymentId ?? order.orderId,
      paymentMethod: order.paymentMethod,
      paymentType: order.paymentType,
      pixCode: order.pixCode,
      qrCode: order.qrCode,
      raw: order.raw,
      rawStatus: order.rawStatus,
      status: order.status,
      statusDetail: order.statusDetail,
      ticketUrl: null,
      transactionId: order.paymentId
    };
  }

  createPixOrder(input: CreatePagBankPixOrderInput | Omit<CreateMercadoPagoPixOrderInput, "accessToken">) {
    return createPagBankPixOrder(this.config, input as CreatePagBankPixOrderInput);
  }

  createOneTimeCheckout(input: CreatePagBankCheckoutInput | Omit<CreateMercadoPagoPreferenceInput, "accessToken">) {
    const value = input as CreatePagBankCheckoutInput;
    return createPagBankCheckout(this.config, value);
  }

  async getOrder(orderId: string) {
    const order = await getPagBankOrder(this.config, orderId);
    return {
      ...order,
      status: pagBankStatusToInternal(order.rawStatus)
    };
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = await getPagBankPayment(this.config, paymentId);
    return {
      ...payment,
      status: pagBankStatusToInternal(payment.rawStatus) as ProviderPaymentStatus
    };
  }

  async validateWebhook(input: WebhookValidationInput) {
    return validatePagBankWebhookToken({
      expectedToken: this.config.webhookToken,
      receivedToken: input.webhookToken ?? input.signature
    });
  }
}

export class PaymentManager {
  constructor(
    private readonly activeProvider: "mercadopago" | "pagbank",
    private readonly mercadoPagoConfig: MercadoPagoRuntimeConfig,
    private readonly pagBankConfig: PagBankRuntimeConfig
  ) {}

  get providerName() {
    return this.activeProvider;
  }

  getProvider(): PaymentProvider {
    if (this.activeProvider === "pagbank") {
      return new PagBankPaymentProvider(this.pagBankConfig);
    }

    return new MercadoPagoPaymentProvider(requireMercadoPagoAccessToken(this.mercadoPagoConfig), this.mercadoPagoConfig.webhookSecret);
  }
}

function requireMercadoPagoAccessToken(config: MercadoPagoRuntimeConfig) {
  if (!config.accessToken) {
    throw Object.assign(new Error("Access Token Mercado Pago não configurado."), { statusCode: 503 });
  }
  return config.accessToken;
}

function moneyToCents(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) : 0;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
