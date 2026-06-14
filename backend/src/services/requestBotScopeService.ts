import type { Request } from "express";
import { isBotRequest } from "../middleware/auth";
import { findDevBotIdByClientId } from "./devBotService";

export function readConfiguredBotId(req: Request) {
  const queryBotId = typeof req.query.botId === "string" ? req.query.botId : null;
  const headerBotId = req.header("x-dashboard-bot-id");
  const botId = queryBotId ?? headerBotId ?? null;
  const normalized = botId?.trim();

  return normalized ? normalized : null;
}

export async function resolveRequestBotId(req: Request) {
  if (!isBotRequest(req)) {
    return readConfiguredBotId(req);
  }

  const headerBotId = req.header("x-dashboard-bot-id")?.trim();

  if (headerBotId) {
    return headerBotId;
  }

  const clientId = req.header("x-discord-bot-client-id")?.trim();

  if (!clientId || !/^\d{5,32}$/.test(clientId)) {
    return null;
  }

  return findDevBotIdByClientId(clientId).catch(() => null);
}
