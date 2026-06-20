import type { Request } from "express";
import { isBotRequest } from "../middleware/auth";
import { findDevBotIdByClientId, getDevBot } from "./devBotService";

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
    const bot = await getDevBot(headerBotId).catch(() => null);

    if (bot) {
      return bot.id;
    }

    if (/^\d{5,32}$/.test(headerBotId)) {
      const botId = await findDevBotIdByClientId(headerBotId).catch(() => null);

      if (botId) {
        return botId;
      }
    }
  }

  const clientId = req.header("x-discord-bot-client-id")?.trim();

  if (!clientId || !/^\d{5,32}$/.test(clientId)) {
    return null;
  }

  return findDevBotIdByClientId(clientId).catch(() => null);
}
