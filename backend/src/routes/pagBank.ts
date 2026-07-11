import { Router } from "express";
import { env } from "../config/env";

export const pagBankRouter = Router();

pagBankRouter.get("/public-key", (_req, res) => {
  const publicKey = normalizePublicKey(env.PAGBANK_CONNECT_PUBLIC_KEY);

  if (!publicKey) {
    return res.status(503).json({
      configured: false,
      message: "PAGBANK_CONNECT_PUBLIC_KEY nao configurada."
    });
  }

  res.type("text/plain");
  res.setHeader("Cache-Control", "no-store");
  return res.send(publicKey);
});

pagBankRouter.get("/status", (_req, res) => {
  return res.json({
    integrationKeyConfigured: Boolean(env.PAGBANK_INTEGRATION_KEY?.trim()),
    publicKeyConfigured: Boolean(env.PAGBANK_CONNECT_PUBLIC_KEY?.trim())
  });
});

function normalizePublicKey(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\\n/g, "\n");
}
