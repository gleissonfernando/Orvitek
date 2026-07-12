import { createHash } from "node:crypto";
import { env } from "./env";

export type MercadoPagoEnvironment = "test" | "production";

export type MercadoPagoRuntimeConfig = {
  accessToken: string | null;
  binaryMode: boolean;
  checkoutExpirationMinutes: number;
  credentialsConfigured: boolean;
  currency: "BRL" | "USD" | "EUR";
  enabled: boolean;
  environment: MercadoPagoEnvironment;
  errors: string[];
  failureUrl: string;
  maxInstallments: number | null;
  publicKey: string | null;
  publicKeyFingerprint: string | null;
  status: "disabled" | "misconfigured" | "operational";
  statementDescriptor: string | null;
  webhookConfigured: boolean;
  webhookSecret: string | null;
  webhookUrl: string;
};

export function getMercadoPagoRuntimeConfig(): MercadoPagoRuntimeConfig {
  const environment = env.MERCADOPAGO_ENV;
  const accessToken = clean(environment === "test" ? env.MERCADOPAGO_TEST_ACCESS_TOKEN : env.MERCADOPAGO_PROD_ACCESS_TOKEN);
  const publicKey = clean(environment === "test" ? env.MERCADOPAGO_TEST_PUBLIC_KEY : env.MERCADOPAGO_PROD_PUBLIC_KEY);
  const webhookSecret = clean(environment === "test" ? env.MERCADOPAGO_TEST_WEBHOOK_SECRET : env.MERCADOPAGO_PROD_WEBHOOK_SECRET);
  const errors: string[] = [];

  if (!accessToken) errors.push(`MERCADOPAGO_${environment === "test" ? "TEST" : "PROD"}_ACCESS_TOKEN ausente.`);
  if (!publicKey) errors.push(`MERCADOPAGO_${environment === "test" ? "TEST" : "PROD"}_PUBLIC_KEY ausente.`);
  if (!webhookSecret) errors.push(`MERCADOPAGO_${environment === "test" ? "TEST" : "PROD"}_WEBHOOK_SECRET ausente.`);
  if (environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    errors.push("PAYMENTS_ALLOW_LIVE_CHARGES precisa estar true para criar cobrancas em producao.");
  }

  const enabled = env.MERCADOPAGO_ENABLED;
  const credentialsConfigured = Boolean(accessToken && publicKey);
  const webhookConfigured = Boolean(webhookSecret);

  return {
    accessToken,
    binaryMode: env.MERCADOPAGO_BINARY_MODE,
    checkoutExpirationMinutes: env.MERCADOPAGO_CHECKOUT_EXPIRATION_MINUTES,
    credentialsConfigured,
    currency: env.MERCADOPAGO_CURRENCY,
    enabled,
    environment,
    errors,
    failureUrl: env.MERCADOPAGO_FAILURE_URL,
    maxInstallments: env.MERCADOPAGO_MAX_INSTALLMENTS ?? null,
    publicKey,
    publicKeyFingerprint: publicKey ? fingerprint(publicKey) : null,
    status: !enabled ? "disabled" : errors.length ? "misconfigured" : "operational",
    statementDescriptor: clean(env.MERCADOPAGO_STATEMENT_DESCRIPTOR),
    webhookConfigured,
    webhookSecret,
    webhookUrl: env.MERCADOPAGO_WEBHOOK_URL
  };
}

export function getMercadoPagoHealth() {
  const config = getMercadoPagoRuntimeConfig();
  return {
    provider: "mercadopago" as const,
    enabled: config.enabled,
    environment: config.environment,
    credentialsConfigured: config.credentialsConfigured,
    webhookConfigured: config.webhookConfigured,
    status: config.status
  };
}

export function requireMercadoPagoOperational(options: { allowDisabled?: boolean; requireWebhook?: boolean } = {}) {
  const config = getMercadoPagoRuntimeConfig();

  if (!options.allowDisabled && !config.enabled) {
    throw paymentConfigError("Mercado Pago esta desativado no servidor.", 503);
  }

  if (!config.accessToken || !config.credentialsConfigured || (options.requireWebhook && !config.webhookConfigured)) {
    throw paymentConfigError("Mercado Pago indisponivel por credenciais ausentes ou invalidas.", 503);
  }

  if (!options.allowDisabled && config.environment === "production" && !env.PAYMENTS_ALLOW_LIVE_CHARGES) {
    throw paymentConfigError("Cobrancas de producao bloqueadas por PAYMENTS_ALLOW_LIVE_CHARGES.", 503);
  }

  return config;
}

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function paymentConfigError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
