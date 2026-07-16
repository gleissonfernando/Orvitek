import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import {
  areGuildRoles,
  isGuildTextChannel
} from "../services/discordOptionsService";
import {
  authorizeBotRuntimeModule,
  canReadDevBotModule,
  canUseDevBotModule,
  getBotApiPermissions,
  getDevBotToken
} from "../services/devBotService";
import {
  completeImageAntiSpamIncident,
  getImageAntiSpamDashboard,
  getImageAntiSpamSettings,
  recordImageAntiSpamIncident,
  saveImageAntiSpamSettings
} from "../services/imageAntiSpamService";
import { createLog } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "image-anti-spam";
const RELEASE_MODULE_ID = "safe-bot";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  logChannelId: optionalSnowflakeSchema,
  immuneRoleIds: z.array(snowflakeSchema).max(100).optional(),
  ignoredChannelIds: z.array(snowflakeSchema).max(100).optional(),
  maxImages: z.coerce.number().int().min(1).max(20).optional(),
  windowSeconds: z.coerce.number().int().min(1).max(3_600).optional(),
  warningsEnabled: z.boolean().optional(),
  progressiveTimeoutEnabled: z.boolean().optional(),
  autoKickEnabled: z.boolean().optional(),
  maxWarnings: z.coerce.number().int().min(1).max(20).optional(),
  ignoreAdministrators: z.boolean().optional(),
  warningResetDays: z.coerce.number().int().min(1).max(3_650).optional()
});
const incidentSchema = z.object({
  guildId: guildIdSchema,
  incidentKey: z.string().min(1).max(200),
  userId: snowflakeSchema,
  username: z.string().max(100).nullable().optional(),
  channelId: snowflakeSchema,
  channelIds: z.array(snowflakeSchema).max(100).optional(),
  mediaTypes: z.array(z.enum(["attachment", "embed", "gif", "image", "sticker"])).max(10).optional(),
  messageIds: z.array(snowflakeSchema).max(100).optional(),
  removedImages: z.number().int().min(0).max(1_000),
  removedMessages: z.number().int().min(0).max(100).optional()
});
const completionSchema = z.object({
  actionSucceeded: z.boolean(),
  actionError: z.string().max(500).nullable().optional()
});

export const imageAntiSpamRouter = Router();

imageAntiSpamRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId, guildId);

    return res.json({
      settings: await getImageAntiSpamSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.post("/bot/incidents", requireBot, async (req, res, next) => {
  try {
    const input = incidentSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId, input.guildId);

    const result = await recordImageAntiSpamIncident({
      ...input,
      botId
    });

    if (result.duplicate) {
      emitRealtime("image-anti-spam:incident", result.incident);
    }

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.patch("/bot/incidents/:incidentId", requireBot, async (req, res, next) => {
  try {
    const incidentId = z.string().min(1).parse(req.params.incidentId);
    const input = completionSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    const incident = await completeImageAntiSpamIncident(incidentId, botId, input);
    await assertBotModuleLicense(botId, incident.guildId);
    const log = await createLog({
      botId,
      guildId: incident.guildId,
      userId: incident.userId,
      type: incident.action === "kick"
        ? "image_anti_spam.member_kicked"
        : "image_anti_spam.incident",
      message: incident.action === "kick"
        ? `Usuário ${incident.username ?? incident.userId} expulso por spam recorrente de imagens.`
        : `${incident.removedImages} midia(s) removida(s) de ${incident.username ?? incident.userId}.`,
      metadata: {
        action: incident.action,
        actionError: incident.actionError,
        actionSucceeded: incident.actionSucceeded,
        channelId: incident.channelId,
        channelIds: incident.channelIds,
        mediaTypes: incident.mediaTypes,
        messageIds: incident.messageIds,
        reason: incident.reason,
        removedImages: incident.removedImages,
        removedMessages: incident.removedMessages,
        timeoutMs: incident.timeoutMs,
        warningCount: incident.warningCount
      }
    });

    emitRealtime("image-anti-spam:incident", incident);
    emitRealtime("logs:new", log);

    return res.json({
      incident
    });
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanRead(user, guildId, botId);

    return res.json(await getImageAntiSpamDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = settingsSchema.parse(req.body);

    await assertCanManage(user, guildId, botId);
    await validateResources(guildId, botId, input);

    const settings = await saveImageAntiSpamSettings(
      guildId,
      botId,
      {
        ...input,
        logChannelId: input.logChannelId || null
      },
      user.discordId
    );
    const log = await createLog({
      botId,
      guildId,
      userId: user.discordId,
      type: "image_anti_spam.settings_updated",
      message: settings.enabled
        ? "Anti-Spam de Imagens atualizado e ativado."
        : "Anti-Spam de Imagens atualizado e desativado.",
      metadata: {
        changedKeys: Object.keys(input)
      }
    });

    emitRealtime("image-anti-spam:settings_updated", settings);
    emitRealtime("logs:new", log);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Escolha um bot cadastrado para usar o Anti-Spam de Imagens.", 400);
  }

  return botId;
}

async function assertCanRead(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotModuleLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, RELEASE_MODULE_ID)) {
    return;
  }

  throw createRouteError("Você não tem permissão para acessar o SelfBot deste bot.", 403);
}

async function assertCanManage(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotModuleLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, RELEASE_MODULE_ID)) {
    return;
  }

  throw createRouteError("Você não tem permissão para configurar o SelfBot deste bot.", 403);
}

async function assertBotModuleLicense(botId: string, guildId?: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot não encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(RELEASE_MODULE_ID)) {
    throw createRouteError("O SelfBot não foi liberado para este bot.", 403);
  }

  if (guildId) {
    const authorization = await authorizeBotRuntimeModule({
      botId,
      guildId,
      moduleId: MODULE_ID
    });

    if (!authorization.allowed) {
      throw createRouteError(authorization.reason, 403);
    }
  }
}

async function validateResources(
  guildId: string,
  botId: string,
  input: z.infer<typeof settingsSchema>
) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [
    input.logChannelId,
    ...(input.ignoredChannelIds ?? [])
  ].filter((channelId): channelId is string => Boolean(channelId));
  const channelChecks = await Promise.all(
    [...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados não pertence a este servidor.", 400);
  }

  const roleIds = [...new Set(input.immuneRoleIds ?? [])];

  if (roleIds.length && !(await areGuildRoles(guildId, roleIds, botToken))) {
    throw createRouteError("Um dos cargos imunes não pertence a este servidor.", 400);
  }
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
