import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  AUTO_ACTIVITY_CLOCK_MODULE_ID,
  closeAutoActivityClockSession,
  deleteAutoActivityClockCity,
  getAutoActivityClockDashboard,
  getAutoActivityClockSettings,
  matchAutoActivityCity,
  openAutoActivityClockSession,
  saveAutoActivityClockCity,
  saveAutoActivityClockSettings
} from "../services/autoActivityClockService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const autoActivityClockRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const nullableSnowflake = snowflake.nullable().optional().or(z.literal(""));
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).max(50).optional(),
  allowedUserIds: z.array(snowflake).max(500).optional(),
  autoUpdatePanel: z.boolean().optional(),
  blockedUserIds: z.array(snowflake).max(500).optional(),
  cityManagerRoleIds: z.array(snowflake).max(50).optional(),
  closeRoleIds: z.array(snowflake).max(50).optional(),
  enabled: z.boolean().optional(),
  exportRoleIds: z.array(snowflake).max(50).optional(),
  historyRoleIds: z.array(snowflake).max(50).optional(),
  logChannelId: nullableSnowflake,
  manualEntryRoleIds: z.array(snowflake).max(50).optional(),
  manualExitRoleIds: z.array(snowflake).max(50).optional(),
  maxHours: z.number().min(1).max(72).nullable().optional(),
  minMinutes: z.number().min(0).max(1440).optional(),
  panelChannelId: nullableSnowflake,
  panelMessageId: nullableSnowflake,
  updatePanelRoleIds: z.array(snowflake).max(50).optional(),
  viewRoleIds: z.array(snowflake).max(50).optional()
});
const citySchema = z.object({
  aliases: z.array(z.string().min(1).max(80)).max(30).optional(),
  cityId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(80)
});
const openSchema = z.object({
  cityId: z.string().min(1),
  cityName: z.string().min(1),
  statusDiscord: z.string().max(200),
  userId: snowflake,
  username: z.string().min(1).max(120)
});
const closeSchema = z.object({ statusDiscord: z.string().max(200).nullable().optional(), userId: snowflake });
const matchSchema = z.object({ activityName: z.string().max(200) });

autoActivityClockRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getAutoActivityClockDashboard(botId, guildId));
  } catch (error) { next(error); }
});

autoActivityClockRouter.patch("/:guildId/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await saveAutoActivityClockSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

autoActivityClockRouter.post("/:guildId/cities", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.status(201).json({ city: await saveAutoActivityClockCity(botId, guildId, citySchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

autoActivityClockRouter.delete("/:guildId/cities/:cityId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    await deleteAutoActivityClockCity(botId, guildId, z.string().min(1).parse(req.params.cityId));
    res.status(204).end();
  } catch (error) { next(error); }
});

autoActivityClockRouter.get("/bot/:guildId/config", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getAutoActivityClockSettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) { next(error); }
});

autoActivityClockRouter.get("/bot/:guildId/dashboard", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json(await getAutoActivityClockDashboard(botId, snowflake.parse(req.params.guildId)));
  } catch (error) { next(error); }
});

autoActivityClockRouter.post("/bot/:guildId/match-city", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const city = await matchAutoActivityCity(botId, snowflake.parse(req.params.guildId), matchSchema.parse(req.body).activityName);
    res.json({ city: city ? { id: city._id, name: city.name, aliases: city.aliases, enabled: city.enabled } : null });
  } catch (error) { next(error); }
});

autoActivityClockRouter.post("/bot/:guildId/open", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ session: await openAutoActivityClockSession(botId, snowflake.parse(req.params.guildId), openSchema.parse(req.body)) });
  } catch (error) { next(error); }
});

autoActivityClockRouter.post("/bot/:guildId/close", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ session: await closeAutoActivityClockSession(botId, snowflake.parse(req.params.guildId), closeSchema.parse(req.body)) });
  } catch (error) { next(error); }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}
async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(AUTO_ACTIVITY_CLOCK_MODULE_ID)) throw routeError("Ponto Automático não liberado.", 403);
}
async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, AUTO_ACTIVITY_CLOCK_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, AUTO_ACTIVITY_CLOCK_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para Ponto Automático.", 403);
}
function routeError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
