import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createGiveaway,
  endGiveaway,
  getGiveaway,
  getRouletteGiveaway,
  listBotGiveaways,
  listGiveaways,
  publishGiveawayPanel,
  spinGiveawayRoulette,
  startGiveaway,
  updateGiveaway,
  updateGiveawayPanelState
} from "../services/giveawayService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const giveawayIdSchema = z.string().min(8).max(128);
const rouletteTokenSchema = z.string().min(20).max(128);
const saveGiveawaySchema = z.object({
  allowRepeatWinners: z.boolean().optional(),
  customMessage: z.string().max(1200).nullable().optional(),
  discordChannelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  endDelayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  liveUrl: z.string().min(1).max(300),
  prizeName: z.string().min(1).max(160),
  startDelayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  title: z.string().min(1).max(120),
  winnerCount: z.coerce.number().int().min(1).max(50).nullable().optional()
});
const panelStateSchema = z.object({
  panelMessageId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});

export const giveawaysRouter = Router();

giveawaysRouter.get("/roulette/:token", async (req, res, next) => {
  try {
    const token = rouletteTokenSchema.parse(req.params.token);

    return res.json({
      giveaway: await getRouletteGiveaway(token)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/roulette/:token/spin", async (req, res, next) => {
  try {
    const token = rouletteTokenSchema.parse(req.params.token);

    return res.json(await spinGiveawayRoulette(token));
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/bot/active", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);

    return res.json({
      giveaways: await listBotGiveaways(botId)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.get("/bot/:giveawayId", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const giveaway = await getGiveaway(giveawayId, botId);

    if (!giveaway) {
      return res.status(404).json({
        message: "Sorteio nao encontrado."
      });
    }

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.patch("/bot/:giveawayId/panel-state", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const input = panelStateSchema.parse(req.body ?? {});

    return res.json({
      giveaway: await updateGiveawayPanelState(giveawayId, input, botId)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.use(requireAuth);

giveawaysRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    await assertCanReadGiveaway(res.locals.dashboardAuth.user, guildId, botId);

    return res.json({
      giveaways: await listGiveaways(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const input = saveGiveawaySchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);

    return res.status(201).json({
      giveaway: await createGiveaway(guildId, input, user.discordId, botId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.patch("/:guildId/:giveawayId", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const input = saveGiveawaySchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await updateGiveaway(giveawayId, input, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/panel", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await publishGiveawayPanel(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/start", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await startGiveaway(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

giveawaysRouter.post("/:guildId/:giveawayId/end", async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const giveawayId = giveawayIdSchema.parse(req.params.giveawayId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageGiveaway(user, guildId, botId);
    await assertGiveawayBelongsToGuild(giveawayId, guildId, botId);

    const giveaway = await endGiveaway(giveawayId, user.discordId, botId);

    return res.json({
      giveaway
    });
  } catch (error) {
    return next(error);
  }
});

async function assertCanReadGiveaway(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes("giveaway")) {
      throw createRouteError("O modulo de sorteio nao foi liberado para este bot.", 403);
    }

    if (await canReadDevBotModule(user, botId, guildId, "giveaway")) {
      return;
    }
  } else if (canReadDashboardGuild(user, guildId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar sorteios deste servidor.", 403);
}

async function assertCanManageGiveaway(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes("giveaway")) {
      throw createRouteError("O modulo de sorteio nao foi liberado para este bot.", 403);
    }

    if (await canUseDevBotModule(user, botId, guildId, "giveaway")) {
      return;
    }
  } else if (canManageDashboardGuild(user, guildId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar sorteios deste servidor.", 403);
}

async function assertGiveawayBelongsToGuild(giveawayId: string, guildId: string, botId: string | null) {
  const giveaway = await getGiveaway(giveawayId, botId);

  if (!giveaway || giveaway.guildId !== guildId) {
    throw createRouteError("Sorteio nao encontrado neste servidor.", 404);
  }
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
