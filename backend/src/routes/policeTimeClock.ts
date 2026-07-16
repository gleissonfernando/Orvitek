import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  closePoliceTimeClockSession,
  getPoliceTimeClockDashboard,
  getPoliceTimeClockSettings,
  openPoliceTimeClockSession,
  POLICE_TIME_CLOCK_MODULE_ID,
  savePoliceTimeClockSettings
} from "../services/policeTimeClockService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const policeTimeClockRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const nullableSnowflake = snowflake.nullable().optional().or(z.literal(""));
const settingsSchema = z.object({
  adminRoleId: nullableSnowflake,
  allowAutomaticEntry: z.boolean().optional(),
  allowExport: z.boolean().optional(),
  allowForcedClose: z.boolean().optional(),
  allowHistory: z.boolean().optional(),
  allowManualEntry: z.boolean().optional(),
  allowManualExit: z.boolean().optional(),
  autoUpdatePanel: z.boolean().optional(),
  closeRoleId: nullableSnowflake,
  enabled: z.boolean().optional(),
  exportRoleId: nullableSnowflake,
  logChannelId: nullableSnowflake,
  managerRoleId: nullableSnowflake,
  maxHours: z.number().min(1).max(72).nullable().optional(),
  panelChannelId: nullableSnowflake,
  panelMessageId: nullableSnowflake,
  reportRoleId: nullableSnowflake,
  timeFormat: z.enum(["24h", "12h"]).optional(),
  timezone: z.string().min(1).max(80).optional()
});
const openSchema = z.object({
  createdBy: snowflake.nullable().optional(),
  origin: z.enum(["manual", "automatic"]).optional(),
  roleNames: z.array(z.string().max(100)).max(50).optional(),
  userId: snowflake,
  username: z.string().min(1).max(120)
});
const closeSchema = z.object({
  closedBy: snowflake.nullable().optional(),
  forced: z.boolean().optional(),
  reason: z.string().max(500).nullable().optional(),
  userId: snowflake
});

policeTimeClockRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getPoliceTimeClockDashboard(botId, guildId));
  } catch (error) { next(error); }
});

policeTimeClockRouter.patch("/:guildId/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await savePoliceTimeClockSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

policeTimeClockRouter.get("/bot/:guildId/config", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getPoliceTimeClockSettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) { next(error); }
});

policeTimeClockRouter.get("/bot/:guildId/dashboard", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json(await getPoliceTimeClockDashboard(botId, snowflake.parse(req.params.guildId)));
  } catch (error) { next(error); }
});

policeTimeClockRouter.patch("/bot/:guildId/config", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const guildId = snowflake.parse(req.params.guildId);
    res.json({ settings: await savePoliceTimeClockSettings(botId, guildId, settingsSchema.parse(req.body), req.header("x-actor-id") ?? null) });
  } catch (error) { next(error); }
});

policeTimeClockRouter.post("/bot/:guildId/open", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ session: await openPoliceTimeClockSession(botId, snowflake.parse(req.params.guildId), openSchema.parse(req.body)) });
  } catch (error) { next(error); }
});

policeTimeClockRouter.post("/bot/:guildId/close", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ session: await closePoliceTimeClockSession(botId, snowflake.parse(req.params.guildId), closeSchema.parse(req.body)) });
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
  if (!permissions.enabledModules.includes(POLICE_TIME_CLOCK_MODULE_ID)) throw routeError("Relógio de Ponto não liberado.", 403);
}
async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, POLICE_TIME_CLOCK_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, POLICE_TIME_CLOCK_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para Relógio de Ponto.", 403);
}
function routeError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
