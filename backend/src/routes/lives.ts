import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild } from "../services/devBotService";
import { createLiveEvent, listLiveEvents } from "../services/liveService";
import { createLog } from "../services/logService";

const liveEventSchema = z.object({
  guildId: z.string().min(1),
  type: z.enum(["started", "ended"]),
  streamer: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url().optional()
});

export const livesRouter = Router();

livesRouter.use(requireAuthOrBot);

livesRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const botId = readBotId(req);
  const lives = listLiveEvents(guildId, botId);

  if (isBotRequest(req)) {
    return res.json({
      lives
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
    lives: guildId ? lives : lives.filter((event) => allowedGuildIds.has(event.guildId))
  });
});

livesRouter.post("/events", async (req, res, next) => {
  try {
    const input = liveEventSchema.parse(req.body);
    const botId = readBotId(req);

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const event = createLiveEvent({
      ...input,
      botId
    });
    const realtimeEvent = input.type === "started" ? "live:started" : "live:ended";

    const log = await createLog({
      botId,
      guildId: input.guildId,
      type: realtimeEvent,
      message: `${input.streamer} ${input.type === "started" ? "iniciou" : "encerrou"} uma live.`,
      metadata: input
    });

    emitRealtime("logs:new", log);
    emitRealtime(realtimeEvent, event);

    return res.status(201).json({
      live: event
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

async function canReadScopedGuild(req: Request, guildId: string | undefined, botId: string | null) {
  if (!guildId) {
    return true;
  }

  if (botId) {
    return canManageDevBotGuild(req.res?.locals.dashboardAuth.user, botId, guildId);
  }

  return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}
