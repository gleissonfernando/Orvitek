import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  createFivemActionSession, deleteFivemActionDefinition, finishFivemActionSession,
  FIVEM_ACTIONS_MODULE_ID, getFivemActionDashboard, getFivemActionSession,
  joinFivemActionSession, leaveFivemActionSession, listActiveFivemActionSettings,
  requestFivemActionPanel, saveFivemActionDefinition, saveFivemActionSettings,
  updateFivemActionPanelState, updateFivemActionSessionMessage
} from "../services/fivemActionService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const architectureSchema = z.enum(["fac", "police"]);
const snowflake = z.string().regex(/^\d{5,32}$/);
const settingsSchema = z.object({
  enabled: z.boolean().optional(), categoryId: snowflake.nullable().optional(), panelChannelId: snowflake.nullable().optional(),
  actionChannelId: snowflake.nullable().optional(), reportChannelId: snowflake.nullable().optional(),
  panelTitle: z.string().min(1).max(120).optional(), panelDescription: z.string().max(1500).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), imageUrl: z.string().max(2048).nullable().optional(),
  imagePosition: z.enum(["top", "center", "bottom", "none"]).optional()
});
const actionSchema = z.object({ name: z.string().min(1).max(80), description: z.string().max(1000).default(""), emoji: z.string().max(80).nullable().default(null), imageUrl: z.string().max(2048).nullable().default(null), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#7c3aed"), maxParticipants: z.coerce.number().int().min(1).max(100), enabled: z.boolean().default(true), order: z.coerce.number().int().min(0).max(10000).default(0) });

export const fivemActionsRouter = Router();

fivemActionsRouter.get("/:guildId/:architecture", requireAuth, async (req, res, next) => { try {
  const { guildId, architecture } = params(req); const botId = await dashboardBotId(req); await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
  res.json(await getFivemActionDashboard(botId, guildId, architecture));
} catch (error) { next(error); } });

fivemActionsRouter.patch("/:guildId/:architecture/settings", requireAuth, async (req, res, next) => { try {
  const { guildId, architecture } = params(req); const botId = await dashboardBotId(req); await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
  res.json({ settings: await saveFivemActionSettings(botId, guildId, architecture, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
} catch (error) { next(error); } });

fivemActionsRouter.post("/:guildId/:architecture/actions", requireAuth, async (req, res, next) => { try {
  const { guildId, architecture } = params(req); const botId = await dashboardBotId(req); await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
  res.status(201).json({ action: await saveFivemActionDefinition(botId, guildId, architecture, null, actionSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
} catch (error) { next(error); } });

fivemActionsRouter.patch("/:guildId/:architecture/actions/:actionId", requireAuth, async (req, res, next) => { try {
  const { guildId, architecture } = params(req); const botId = await dashboardBotId(req); await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
  res.json({ action: await saveFivemActionDefinition(botId, guildId, architecture, req.params.actionId!, actionSchema.partial().parse(req.body), res.locals.dashboardAuth.user.discordId) });
} catch (error) { next(error); } });

fivemActionsRouter.delete("/:guildId/:architecture/actions/:actionId", requireAuth, async (req, res, next) => { try {
  const { guildId, architecture } = params(req); const botId = await dashboardBotId(req); await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
  const action = await deleteFivemActionDefinition(botId, guildId, architecture, req.params.actionId!); if (!action) throw routeError("Ação não encontrada.", 404); res.json({ action });
} catch (error) { next(error); } });

fivemActionsRouter.post("/:guildId/:architecture/publish", requireAuth, async (req, res, next) => { try {
  const { guildId, architecture } = params(req); const botId = await dashboardBotId(req); await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
  res.json({ settings: await requestFivemActionPanel(botId, guildId, architecture, res.locals.dashboardAuth.user.discordId) });
} catch (error) { next(error); } });

fivemActionsRouter.get("/bot/configs/active", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); res.json({ configs: await listActiveFivemActionSettings(botId) }); } catch (error) { next(error); } });
fivemActionsRouter.get("/bot/:guildId/:architecture", requireBot, async (req, res, next) => { try { const { guildId, architecture } = params(req); const botId = await botRuntimeId(req); await licensed(botId); res.json(await getFivemActionDashboard(botId, guildId, architecture)); } catch (error) { next(error); } });
fivemActionsRouter.post("/bot/panel-state", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const input = z.object({ guildId: snowflake, architecture: architectureSchema, panelMessageId: snowflake.nullable() }).parse(req.body); res.json({ settings: await updateFivemActionPanelState(botId, input.guildId, input.architecture, input.panelMessageId) }); } catch (error) { next(error); } });
fivemActionsRouter.post("/bot/sessions", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const input = z.object({ guildId: snowflake, architecture: architectureSchema, actionId: z.string().uuid(), openerId: snowflake, openerName: z.string().max(100) }).parse(req.body); res.status(201).json({ session: await createFivemActionSession({ botId, ...input }) }); } catch (error) { next(error); } });
fivemActionsRouter.get("/bot/sessions/:sessionId", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const session = await getFivemActionSession(botId, req.params.sessionId!); if (!session) throw routeError("Ação não encontrada.", 404); res.json({ session }); } catch (error) { next(error); } });
fivemActionsRouter.patch("/bot/sessions/:sessionId/message", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const input = z.object({ channelId: snowflake, messageId: snowflake }).parse(req.body); res.json({ session: await updateFivemActionSessionMessage(botId, req.params.sessionId!, input.channelId, input.messageId) }); } catch (error) { next(error); } });
fivemActionsRouter.post("/bot/sessions/:sessionId/join", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const input = z.object({ userId: snowflake, username: z.string().max(100), roleIds: z.array(snowflake).max(100) }).parse(req.body); res.json({ session: await joinFivemActionSession(botId, req.params.sessionId!, input) }); } catch (error) { next(error); } });
fivemActionsRouter.post("/bot/sessions/:sessionId/leave", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const input = z.object({ userId: snowflake }).parse(req.body); res.json({ session: await leaveFivemActionSession(botId, req.params.sessionId!, input.userId) }); } catch (error) { next(error); } });
fivemActionsRouter.post("/bot/sessions/:sessionId/finish", requireBot, async (req, res, next) => { try { const botId = await botRuntimeId(req); await licensed(botId); const input = z.object({ actorId: snowflake, result: z.enum(["victory", "defeat"]) }).parse(req.body); res.json({ session: await finishFivemActionSession(botId, req.params.sessionId!, input.actorId, input.result) }); } catch (error) { next(error); } });

function params(req: any) { return { guildId: snowflake.parse(req.params.guildId), architecture: architectureSchema.parse(req.params.architecture) }; }
async function dashboardBotId(req: any) { const id = await resolveRequestBotId(req); if (!id) throw routeError("Selecione um bot DEV.", 400); return id; }
async function botRuntimeId(req: any) { const id = await resolveRequestBotId(req); if (!id) throw routeError("Bot não identificado.", 400); return id; }
async function licensed(botId: string) { const p = await getBotApiPermissions(botId); if (!p) throw routeError("Bot não encontrado.", 404); if (!p.enabledModules.includes(FIVEM_ACTIONS_MODULE_ID)) throw routeError("Sistema de Ações não liberado.", 403); }
async function authorize(user: any, botId: string, guildId: string, manage: boolean) { await licensed(botId); const allowed = manage ? await canUseDevBotModule(user, botId, guildId, FIVEM_ACTIONS_MODULE_ID) : await canReadDevBotModule(user, botId, guildId, FIVEM_ACTIONS_MODULE_ID); if (!allowed) throw routeError("Sem permissão para o Sistema de Ações.", 403); }
function routeError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
