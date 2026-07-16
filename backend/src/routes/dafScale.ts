import { Router } from "express";
import { z } from "zod";
import { requireBot } from "../middleware/auth";
import {
  getDafScaleState,
  joinDafScale,
  leaveDafScale,
  recordDafScaleAudit,
  saveDafScaleSettings,
  setDafScalePanelMessage
} from "../services/dafScaleService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const roleSchema = z.enum(["pilot", "shooter"]);
const settingsSchema = z.object({
  configRoleId: snowflake.nullable().optional(),
  enabled: z.boolean().optional(),
  logChannelId: snowflake.nullable().optional(),
  maxPilots: z.coerce.number().int().min(1).max(50).optional(),
  maxShooters: z.coerce.number().int().min(1).max(50).optional(),
  panelChannelId: snowflake.nullable().optional(),
  panelMessageId: snowflake.nullable().optional(),
  participantRoleId: snowflake.nullable().optional(),
  pilotRoleId: snowflake.nullable().optional(),
  shooterRoleId: snowflake.nullable().optional()
});
const memberSchema = z.object({
  roleIds: z.array(snowflake).max(100).default([]),
  userId: snowflake,
  username: z.string().min(1).max(100)
});

export const dafScaleRouter = Router();

dafScaleRouter.get("/bot/:guildId/state", requireBot, async (req, res, next) => {
  try {
    res.json(await getDafScaleState(await botId(req), snowflake.parse(req.params.guildId)));
  } catch (error) {
    next(error);
  }
});

dafScaleRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const actorId = req.header("x-actor-id") ?? null;
    const settings = await saveDafScaleSettings(await botId(req), snowflake.parse(req.params.guildId), settingsSchema.parse(req.body), actorId);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

dafScaleRouter.patch("/bot/:guildId/panel-message", requireBot, async (req, res, next) => {
  try {
    const input = z.object({ messageId: snowflake.nullable() }).parse(req.body);
    const settings = await setDafScalePanelMessage(await botId(req), snowflake.parse(req.params.guildId), input.messageId, req.header("x-actor-id") ?? null);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

dafScaleRouter.post("/bot/:guildId/join", requireBot, async (req, res, next) => {
  try {
    const input = memberSchema.extend({ role: roleSchema }).parse(req.body);
    res.json(await joinDafScale(await botId(req), snowflake.parse(req.params.guildId), input.role, input));
  } catch (error) {
    next(error);
  }
});

dafScaleRouter.post("/bot/:guildId/leave", requireBot, async (req, res, next) => {
  try {
    const input = memberSchema.pick({ userId: true, username: true }).parse(req.body);
    res.json(await leaveDafScale(await botId(req), snowflake.parse(req.params.guildId), input));
  } catch (error) {
    next(error);
  }
});

dafScaleRouter.post("/bot/:guildId/audit", requireBot, async (req, res, next) => {
  try {
    const input = z.object({
      action: z.enum(["join", "leave", "switch", "refresh", "publish", "config"]),
      metadata: z.record(z.unknown()).nullable().optional(),
      previousRole: roleSchema.nullable().optional(),
      role: roleSchema.nullable().optional(),
      userId: z.string().min(1).max(32),
      username: z.string().min(1).max(100)
    }).parse(req.body);
    await recordDafScaleAudit(await botId(req), snowflake.parse(req.params.guildId), {
      action: input.action,
      metadata: input.metadata ?? null,
      previousRole: input.previousRole ?? null,
      role: input.role ?? null,
      userId: input.userId,
      username: input.username
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function botId(req: any) {
  const id = await resolveRequestBotId(req);
  if (!id) throw Object.assign(new Error("Bot não identificado."), { statusCode: 400 });
  return id;
}
