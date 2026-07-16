import { createReadStream } from "node:fs";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import {
  areGuildRoles,
  isGuildTextChannel,
  isGuildVoiceChannel,
  userHasAnyGuildRole
} from "../services/discordOptionsService";
import {
  canReadDevBotModule,
  canUseDevBotModule,
  getBotApiPermissions,
  getDevBotToken
} from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";
import {
  completeVoiceRecording,
  createBotVoiceRecording,
  createDashboardVoiceRecordingRequest,
  deleteVoiceRecording,
  failActiveVoiceRecordingsForBot,
  failVoiceRecording,
  getVoiceRecorderDashboard,
  getVoiceRecorderSettings,
  getVoiceRecordingFile,
  markDashboardVoiceRecordingStarted,
  markVoiceRecordingProcessing,
  recordVoiceRecordingEvent,
  requestDashboardVoiceRecordingStop,
  saveVoiceRecorderSettings
} from "../services/voiceRecorderService";

const MODULE_ID = "voice-recorder";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  logChannelId: optionalSnowflakeSchema,
  allowedRoleIds: z.array(snowflakeSchema).max(100).optional(),
  maxDurationMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
  retentionDays: z.coerce.number().int().min(1).max(3650).optional()
});
const dashboardStartSchema = z.object({
  channelId: snowflakeSchema
});
const dashboardStopSchema = z.object({
  recordingId: z.string().min(1).max(80).nullable().optional()
});
const botStartSchema = z.object({
  actorId: snowflakeSchema,
  actorRoleIds: z.array(snowflakeSchema).default([]),
  actorTag: z.string().max(100).nullable().optional(),
  channelId: snowflakeSchema,
  channelName: z.string().max(100).nullable().optional(),
  guildId: guildIdSchema,
  guildName: z.string().max(100).nullable().optional(),
  source: z.enum(["discord", "dashboard"]).default("discord")
});
const botStartedSchema = z.object({
  channelName: z.string().max(100).nullable().optional(),
  guildName: z.string().max(100).nullable().optional()
});
const botStopSchema = z.object({
  actorId: snowflakeSchema,
  actorRoleIds: z.array(snowflakeSchema).default([]),
  actorTag: z.string().max(100).nullable().optional(),
  guildId: guildIdSchema,
  recordingId: z.string().min(1).max(80).nullable().optional()
});
const botCompleteSchema = z.object({
  durationMs: z.coerce.number().int().min(0),
  endedAt: z.string().datetime().nullable().optional(),
  filePath: z.string().min(1).max(2000),
  fileSize: z.coerce.number().int().min(0),
  participants: z.array(z.object({
    userId: snowflakeSchema,
    username: z.string().max(100).nullable().optional(),
    joinedAt: z.string().datetime(),
    leftAt: z.string().datetime().nullable().optional(),
    speakingMs: z.coerce.number().int().min(0).optional()
  })).max(250).default([])
});
const botFailSchema = z.object({
  error: z.string().min(1).max(1000),
  guildId: guildIdSchema.nullable().optional()
});
const botEventSchema = z.object({
  guildId: guildIdSchema,
  message: z.string().min(1).max(500),
  metadata: z.record(z.unknown()).optional(),
  type: z.string().min(1).max(80),
  userId: snowflakeSchema.nullable().optional(),
  username: z.string().max(100).nullable().optional()
});

export const voiceRecorderRouter = Router();

voiceRecorderRouter.get("/files/:recordingId/:token", async (req, res, next) => {
  try {
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const token = z.string().min(16).max(200).parse(req.params.token);
    const file = await getVoiceRecordingFile(recordingId, {
      accessToken: token
    });

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Content-Disposition", `inline; filename="${safeHeaderFileName(file.fileName)}"`);
    return createReadStream(file.filePath).pipe(res);
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      settings: await getVoiceRecorderSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/start", requireBot, async (req, res, next) => {
  try {
    const input = botStartSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.status(201).json(await createBotVoiceRecording({
      ...input,
      botId
    }));
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/reconcile", requireBot, async (req, res, next) => {
  try {
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recordings: await failActiveVoiceRecordingsForBot({
        botId,
        error: "Bot reiniciado sem uma sessão local de audio ativa."
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/recordings/:recordingId/started", requireBot, async (req, res, next) => {
  try {
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const input = botStartedSchema.parse(req.body ?? {});
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recording: await markDashboardVoiceRecordingStarted(recordingId, botId, input)
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/stop", requireBot, async (req, res, next) => {
  try {
    const input = botStopSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recording: await markVoiceRecordingProcessing({
        ...input,
        botId
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/recordings/:recordingId/processing", requireBot, async (req, res, next) => {
  try {
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const input = botStopSchema.omit({ recordingId: true, actorRoleIds: true }).parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recording: await markVoiceRecordingProcessing({
        ...input,
        botId,
        recordingId,
        skipRoleCheck: true
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/recordings/:recordingId/complete", requireBot, async (req, res, next) => {
  try {
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const input = botCompleteSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recording: await completeVoiceRecording({
        ...input,
        botId,
        recordingId
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/recordings/:recordingId/fail", requireBot, async (req, res, next) => {
  try {
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const input = botFailSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recording: await failVoiceRecording({
        botId,
        error: input.error,
        guildId: input.guildId ?? null,
        recordingId
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/bot/recordings/:recordingId/events", requireBot, async (req, res, next) => {
  try {
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const input = botEventSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotVoiceRecorderLicense(botId);

    return res.json({
      recording: await recordVoiceRecordingEvent({
        ...input,
        botId,
        recordingId
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadVoiceRecorder(user, guildId, botId);

    return res.json(await getVoiceRecorderDashboard(guildId, botId, {
      channelId: typeof req.query.channelId === "string" ? req.query.channelId : null,
      dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : null,
      dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null,
      maxDurationSeconds: typeof req.query.maxDurationSeconds === "string" ? Number(req.query.maxDurationSeconds) : null,
      minDurationSeconds: typeof req.query.minDurationSeconds === "string" ? Number(req.query.minDurationSeconds) : null,
      search: typeof req.query.search === "string" ? req.query.search : null,
      userId: typeof req.query.userId === "string" ? req.query.userId : null
    }));
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = settingsSchema.parse(req.body);

    await assertCanManageVoiceRecorder(user, guildId, botId);
    await validateVoiceRecorderResources(guildId, botId, input);

    return res.json({
      settings: await saveVoiceRecorderSettings(guildId, botId, {
        ...input,
        logChannelId: input.logChannelId || null
      }, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/:guildId/start", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = dashboardStartSchema.parse(req.body);

    await assertCanManageVoiceRecorder(user, guildId, botId);
    await assertDashboardActorHasRecorderRole(user, guildId, botId);
    await validateVoiceChannel(guildId, botId, input.channelId);

    return res.status(202).json({
      recording: await createDashboardVoiceRecordingRequest({
        actorId: user.discordId,
        actorTag: user.globalName || user.username,
        botId,
        channelId: input.channelId,
        guildId,
        source: "dashboard"
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.post("/:guildId/stop", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = dashboardStopSchema.parse(req.body ?? {});

    await assertCanManageVoiceRecorder(user, guildId, botId);
    await assertDashboardActorHasRecorderRole(user, guildId, botId);

    return res.status(202).json({
      recording: await requestDashboardVoiceRecordingStop({
        actorId: user.discordId,
        actorTag: user.globalName || user.username,
        botId,
        guildId,
        recordingId: input.recordingId ?? null
      })
    });
  } catch (error) {
    return next(error);
  }
});

voiceRecorderRouter.get("/:guildId/recordings/:recordingId/audio", requireAuth, async (req, res, next) => {
  return streamDashboardRecording(req, res, next, "inline");
});

voiceRecorderRouter.get("/:guildId/recordings/:recordingId/download", requireAuth, async (req, res, next) => {
  return streamDashboardRecording(req, res, next, "attachment");
});

voiceRecorderRouter.delete("/:guildId/recordings/:recordingId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageVoiceRecorder(user, guildId, botId);

    return res.json({
      recording: await deleteVoiceRecording(recordingId, botId, user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

async function streamDashboardRecording(
  req: Request,
  res: Response,
  next: NextFunction,
  disposition: "attachment" | "inline"
) {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const recordingId = z.string().min(1).max(80).parse(req.params.recordingId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanReadVoiceRecorder(user, guildId, botId);
    const file = await getVoiceRecordingFile(recordingId, {
      botId,
      guildId
    });

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Content-Disposition", `${disposition}; filename="${safeHeaderFileName(file.fileName)}"`);
    return createReadStream(file.filePath).pipe(res);
  } catch (error) {
    return next(error);
  }
}

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Escolha um bot cadastrado para usar o Voice Recorder.", 400);
  }

  return botId;
}

async function assertCanReadVoiceRecorder(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotVoiceRecorderLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Você não tem permissão para acessar o Voice Recorder deste bot.", 403);
}

async function assertCanManageVoiceRecorder(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotVoiceRecorderLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Você não tem permissão para configurar o Voice Recorder deste bot.", 403);
}

async function assertBotVoiceRecorderLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot não encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(MODULE_ID)) {
    throw createRouteError("O Voice Recorder não foi liberado para este bot.", 403);
  }
}

async function validateVoiceRecorderResources(guildId: string, botId: string, input: z.infer<typeof settingsSchema>) {
  const botToken = await getDevBotToken(botId);

  if (input.logChannelId && !(await isGuildTextChannel(guildId, input.logChannelId, botToken))) {
    throw createRouteError("O canal de logs selecionado não pertence a este servidor.", 400);
  }

  if (input.allowedRoleIds?.length && !(await areGuildRoles(guildId, input.allowedRoleIds, botToken))) {
    throw createRouteError("Um dos cargos autorizados não pertence a este servidor.", 400);
  }
}

async function validateVoiceChannel(guildId: string, botId: string, channelId: string) {
  if (!(await isGuildVoiceChannel(guildId, channelId, await getDevBotToken(botId)))) {
    throw createRouteError("O canal de voz selecionado não pertence a este servidor.", 400);
  }
}

async function assertDashboardActorHasRecorderRole(user: AuthSessionUser, guildId: string, botId: string) {
  const settings = await getVoiceRecorderSettings(guildId, botId);

  if (!settings.enabled) {
    throw createRouteError("O Voice Recorder está desativado neste servidor.", 403);
  }

  if (!settings.allowedRoleIds.length) {
    throw createRouteError("Configure pelo menos um cargo autorizado antes de iniciar gravações.", 400);
  }

  const botToken = await getDevBotToken(botId);
  const allowed = await userHasAnyGuildRole(guildId, user.discordId, settings.allowedRoleIds, botToken);

  if (!allowed) {
    throw createRouteError("Seu usuário não tem um cargo autorizado para iniciar ou encerrar gravações.", 403);
  }
}

function safeHeaderFileName(fileName: string) {
  return fileName.replace(/["\\\r\n]/g, "_");
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
