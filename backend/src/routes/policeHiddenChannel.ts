import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  createPoliceHiddenChannelLog,
  getPoliceHiddenChannelDashboard,
  getPoliceHiddenChannelSettings,
  POLICE_HIDDEN_CHANNEL_MODULE_ID,
  removePoliceHiddenChannelSettings,
  savePoliceHiddenChannelSettings
} from "../services/policeHiddenChannelService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const nullableSnowflake = snowflake.nullable();
const settingsSchema = z.object({
  allowedRoleId: nullableSnowflake.optional(),
  channelId: nullableSnowflake.optional(),
  enabled: z.boolean().optional(),
  logChannelId: nullableSnowflake.optional()
});
const logSchema = z.object({
  attachmentUrls: z.array(z.string().url().max(2048)).max(25).optional(),
  authorId: snowflake,
  authorTag: z.string().max(120),
  channelId: snowflake,
  content: z.string().max(10000).default(""),
  embedCount: z.number().int().min(0).max(10).optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
  guildId: snowflake,
  logChannelId: nullableSnowflake.optional(),
  originalMessageId: snowflake,
  relayedMessageId: nullableSnowflake.optional(),
  status: z.enum(["relayed", "failed"]),
  stickerIds: z.array(snowflake).max(10).optional()
});

export const policeHiddenChannelRouter = Router();

policeHiddenChannelRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getPoliceHiddenChannelDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

policeHiddenChannelRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({
      settings: await savePoliceHiddenChannelSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    next(error);
  }
});

policeHiddenChannelRouter.delete("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({
      settings: await removePoliceHiddenChannelSettings(botId, guildId, res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    next(error);
  }
});

policeHiddenChannelRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getPoliceHiddenChannelSettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) {
    next(error);
  }
});

policeHiddenChannelRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({
      settings: await savePoliceHiddenChannelSettings(botId, snowflake.parse(req.params.guildId), settingsSchema.parse(req.body), req.header("x-actor-id") ?? null)
    });
  } catch (error) {
    next(error);
  }
});

policeHiddenChannelRouter.post("/bot/logs", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ log: await createPoliceHiddenChannelLog(botId, logSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(POLICE_HIDDEN_CHANNEL_MODULE_ID)) throw routeError("Canal Oculto não liberado.", 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, POLICE_HIDDEN_CHANNEL_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, POLICE_HIDDEN_CHANNEL_MODULE_ID);

  if (!allowed) throw routeError("Sem permissão para Canal Oculto.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
