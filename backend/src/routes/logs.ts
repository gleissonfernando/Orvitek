import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild } from "../services/devBotService";
import { createLog, listLogs } from "../services/logService";

const logSchema = z.object({
  guildId: z.string().min(1),
  userId: z.string().optional().nullable(),
  type: z.string().min(1),
  message: z.string().min(1),
  metadata: z.unknown().optional()
});

export const logsRouter = Router();

logsRouter.use(requireAuthOrBot);

logsRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const botId = readBotId(req);
  const logs = await listLogs(guildId, botId);

  if (isBotRequest(req)) {
    return res.json({
      logs
    });
  }

  const user = res.locals.dashboardAuth.user;

  if (guildId && !(await canReadScopedGuild(req, guildId, botId))) {
    return res.status(403).json({
      message: "Servidor nao encontrado ou sem o bot."
    });
  }

  const allowedGuildIds = getAccessibleGuildIds(user);

  return res.json({
    logs: guildId ? logs : logs.filter((log) => allowedGuildIds.has(log.guildId))
  });
});

logsRouter.post("/", async (req, res, next) => {
  try {
    const input = logSchema.parse(req.body);
    const botId = readBotId(req);

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const log = await createLog({
      ...input,
      botId
    });

    emitRealtime("logs:new", log);

    return res.status(201).json({
      log
    });
  } catch (error) {
    return next(error);
  }
});

function readBotId(req: Request) {
  const queryBotId = typeof req.query.botId === "string" ? req.query.botId : null;
  const headerBotId = req.header("x-dashboard-bot-id");
  const botId = queryBotId ?? headerBotId ?? null;
  const normalized = botId?.trim();

  return normalized ? normalized : null;
}

async function canReadScopedGuild(req: Request, guildId: string, botId: string | null) {
  const user = req.res?.locals.dashboardAuth.user;

  if (!user) {
    return false;
  }

  if (botId) {
    return canManageDevBotGuild(user, botId, guildId);
  }

  return canReadDashboardGuild(user, guildId);
}
