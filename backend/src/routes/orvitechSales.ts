import { Router } from "express";
import { z } from "zod";
import { processOrvitechPaymentWebhook } from "../services/orvitechSalesService";

export const orvitechSalesRouter = Router();

const webhookParamsSchema = z.object({
  gatewayId: z.string().min(8).max(120),
  storeId: z.string().min(8).max(120)
});

orvitechSalesRouter.post("/webhooks/:storeId/:gatewayId", async (req, res, next) => {
  try {
    const params = webhookParamsSchema.parse(req.params);
    const rawBody = ((req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString("utf8");
    const signature = req.header("x-orvitech-signature")
      ?? req.header("x-hub-signature-256")
      ?? req.header("x-signature")
      ?? null;

    const result = await processOrvitechPaymentWebhook(params.storeId, params.gatewayId, {
      eventId: readString(req.body?.id) ?? readString(req.body?.eventId) ?? readString(req.body?.data?.id),
      eventType: readString(req.body?.type) ?? readString(req.body?.eventType) ?? readString(req.body?.action),
      payload: req.body,
      rawBody,
      signature
    });

    return res.status(result.statusCode).json(result);
  } catch (error) {
    return next(error);
  }
});

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
