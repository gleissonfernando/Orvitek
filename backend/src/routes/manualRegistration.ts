import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canReadDashboardGuild, canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createManualRegistrationSubmission,
  getManualRegistrationSettings,
  listManualRegistrationSubmissions,
  saveManualRegistrationSettings,
  updateManualRegistrationSubmissionMessage,
  updateManualRegistrationSubmissionStatus
} from "../services/manualRegistrationService";

const MODULE_ID = "manual-registration";
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();

const fieldSchema = z.object({
  id: z.string().max(80),
  label: z.string().min(1).max(80),
  maxLength: z.coerce.number().int().min(1).max(1500).nullable().optional().default(null),
  minLength: z.coerce.number().int().min(0).max(1500).nullable().optional().default(null),
  name: z.string().max(80),
  placeholder: z.string().max(100).nullable().optional().default(null),
  required: z.boolean(),
  style: z.enum(["short", "paragraph"])
});

const settingsSchema = z.object({
  approvalChannelId: optionalSnowflakeSchema,
  autoRoleIds: z.array(snowflakeSchema).max(20).optional(),
  bannerPosition: z.enum(["top", "bottom", "none"]).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  description: z.string().max(1200).nullable().optional(),
  enabled: z.boolean().optional(),
  emoji: z.string().max(80).nullable().optional(),
  fields: z.array(fieldSchema).max(25).optional(),
  footerText: z.string().max(180).nullable().optional(),
  name: z.string().max(80).optional(),
  removeRoleIds: z.array(snowflakeSchema).max(20).optional(),
  thumbnailUrl: z.string().max(2048).nullable().optional(),
  title: z.string().max(120).optional()
});

const submissionSchema = z.object({
  fields: z.array(z.object({
    id: z.string().max(80),
    label: z.string().max(100),
    value: z.string().max(1500)
  })).max(25),
  guildId: snowflakeSchema,
  messageId: optionalSnowflakeSchema,
  userAvatar: z.string().max(2048).nullable().optional(),
  userId: snowflakeSchema,
  username: z.string().max(120)
});

const messageSchema = z.object({
  messageId: optionalSnowflakeSchema
});

const statusSchema = z.object({
  actorId: snowflakeSchema,
  status: z.enum(["approved", "rejected"])
});

export const manualRegistrationRouter = Router();

manualRegistrationRouter.use(requireAuthOrBot);

manualRegistrationRouter.get("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, guildId, botId))) {
      return res.status(403).json({ message: "Servidor nao encontrado ou modulo nao liberado." });
    }

    return res.json({
      settings: await getManualRegistrationSettings(guildId, botId),
      submissions: isBotRequest(req) ? [] : await listManualRegistrationSubmissions(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = settingsSchema.parse(req.body);

    if (isBotRequest(req) || !(await canManageScopedGuild(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissao para alterar cadastro manual." });
    }

    return res.json({
      settings: await saveManualRegistrationSettings(guildId, botId, input, res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.post("/bot/submissions", requireBot, async (req, res, next) => {
  try {
    const input = submissionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const settings = await getManualRegistrationSettings(input.guildId, botId);

    if (!settings.enabled) {
      return res.status(403).json({ message: "Cadastro manual desativado." });
    }

    return res.status(201).json({
      submission: await createManualRegistrationSubmission({ ...input, botId })
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.patch("/bot/submissions/:id/message", requireBot, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const input = messageSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    await updateManualRegistrationSubmissionMessage(id, botId, input.messageId ?? null);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.patch("/bot/submissions/:id/status", requireBot, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const input = statusSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    return res.json({
      submission: await updateManualRegistrationSubmissionStatus({ ...input, id, botId })
    });
  } catch (error) {
    return next(error);
  }
});

async function canReadScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, MODULE_ID);
  }

  return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManageScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, MODULE_ID);
  }

  return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}
