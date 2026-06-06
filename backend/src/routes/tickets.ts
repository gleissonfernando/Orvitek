import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild } from "../services/devBotService";
import { createLog } from "../services/logService";
import { createTicket, listTickets } from "../services/ticketService";

const ticketSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().optional().nullable(),
  openerId: z.string().min(1),
  subject: z.string().min(1).default("Atendimento")
});

export const ticketsRouter = Router();

ticketsRouter.use(requireAuthOrBot);

ticketsRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const botId = readBotId(req);
  const tickets = await listTickets(guildId, botId);

  if (isBotRequest(req)) {
    return res.json({
      tickets
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
    tickets: guildId ? tickets : tickets.filter((ticket) => allowedGuildIds.has(ticket.guildId))
  });
});

ticketsRouter.post("/", async (req, res, next) => {
  try {
    const input = ticketSchema.parse(req.body);
    const botId = readBotId(req);

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const ticket = await createTicket({
      ...input,
      botId
    });
    const log = await createLog({
      botId,
      guildId: input.guildId,
      userId: input.openerId,
      type: "ticket.created",
      message: `Ticket criado: ${input.subject}`,
      metadata: ticket
    });

    emitRealtime("tickets:new", ticket);
    emitRealtime("logs:new", log);

    return res.status(201).json({
      ticket
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
  if (botId) {
    return canManageDevBotGuild(req.res?.locals.dashboardAuth.user, botId, guildId);
  }

  return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}
