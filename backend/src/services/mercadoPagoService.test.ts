import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { mercadoPagoStatusToInternal, validateMercadoPagoWebhookSignature } from "./mercadoPagoService";

test("valida assinatura oficial do webhook Mercado Pago", () => {
  const secret = "test-secret";
  const dataId = "123456789";
  const requestId = "request-1";
  const ts = "1742505638683";
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");

  assert.equal(validateMercadoPagoWebhookSignature({
    dataId,
    requestId,
    secret,
    signature: `ts=${ts},v1=${v1}`
  }), true);
});

test("rejeita assinatura Mercado Pago divergente", () => {
  assert.equal(validateMercadoPagoWebhookSignature({
    dataId: "123",
    requestId: "request-1",
    secret: "test-secret",
    signature: "ts=1742505638683,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }), false);
});

test("mapeia status Mercado Pago para estados internos de pagamento", () => {
  assert.equal(mercadoPagoStatusToInternal("approved"), "approved");
  assert.equal(mercadoPagoStatusToInternal("in_process"), "in_process");
  assert.equal(mercadoPagoStatusToInternal("pending"), "pending");
  assert.equal(mercadoPagoStatusToInternal("in_mediation"), "in_review");
  assert.equal(mercadoPagoStatusToInternal("charged_back"), "chargeback");
  assert.equal(mercadoPagoStatusToInternal("rejected"), "rejected");
});
