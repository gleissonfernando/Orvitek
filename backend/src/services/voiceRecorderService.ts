import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import {
  ensureGuild,
  getMongoCollections,
  type MongoVoiceRecorderSettings,
  type MongoVoiceRecorderStatus,
  type MongoVoiceRecording,
  type MongoVoiceRecordingEvent,
  type MongoVoiceRecordingParticipant
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export type VoiceRecordingDto = {
  id: string;
  botId: string;
  guildId: string;
  guildName: string | null;
  channelId: string;
  channelName: string | null;
  startedById: string;
  startedByTag: string | null;
  stoppedById: string | null;
  stoppedByTag: string | null;
  source: "discord" | "dashboard";
  participants: Array<{
    userId: string;
    username: string | null;
    joinedAt: string;
    leftAt: string | null;
    speakingMs: number;
  }>;
  events: Array<{
    type: string;
    userId: string | null;
    username: string | null;
    message: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  fileName: string | null;
  fileSize: number;
  fileUrl: string | null;
  downloadUrl: string | null;
  mimeType: string | null;
  status: MongoVoiceRecorderStatus;
  error: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceRecorderSettingsDto = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  allowedRoleIds: string[];
  maxDurationMinutes: number;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type VoiceRecorderStatsDto = {
  totalRecordings: number;
  totalDurationMs: number;
  totalStorageBytes: number;
  recordingsThisMonth: number;
  recordingsToday: number;
  activeRecording: boolean;
};

export type SaveVoiceRecorderSettingsInput = Partial<Pick<
  VoiceRecorderSettingsDto,
  "enabled" | "logChannelId" | "allowedRoleIds" | "maxDurationMinutes" | "retentionDays"
>>;

export type VoiceRecorderFilters = {
  channelId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  maxDurationSeconds?: number | null;
  minDurationSeconds?: number | null;
  search?: string | null;
  userId?: string | null;
};

export type CreateVoiceRecordingInput = {
  actorId: string;
  actorRoleIds?: string[];
  actorTag?: string | null;
  botId: string;
  channelId: string;
  channelName?: string | null;
  guildId: string;
  guildName?: string | null;
  source: "discord" | "dashboard";
};

export type CompleteVoiceRecordingInput = {
  botId: string;
  durationMs: number;
  endedAt?: string | null;
  filePath: string;
  fileSize: number;
  participants: Array<{
    userId: string;
    username?: string | null;
    joinedAt: string;
    leftAt?: string | null;
    speakingMs?: number;
  }>;
  recordingId: string;
};

export type RecordVoiceEventInput = {
  botId: string;
  guildId: string;
  message: string;
  metadata?: Record<string, unknown>;
  recordingId: string;
  type: string;
  userId?: string | null;
  username?: string | null;
};

const MODULE_ID = "voice-recorder";
const STORAGE_ROOT = path.resolve(__dirname, "../../../storage/voice-records");
const ACTIVE_STATUSES: MongoVoiceRecorderStatus[] = ["starting", "recording", "processing"];
const COMPLETED_STATUSES: MongoVoiceRecorderStatus[] = ["completed"];
const DEFAULT_MAX_DURATION_MINUTES = 120;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_EVENTS_PER_RECORDING = 500;
const MAX_PARTICIPANTS_PER_RECORDING = 250;
const MIME_TYPE_MP3 = "audio/mpeg";

export function voiceRecorderStorageRoot() {
  return STORAGE_ROOT;
}

export function defaultVoiceRecorderSettings(guildId: string, botId: string): VoiceRecorderSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    logChannelId: null,
    allowedRoleIds: [],
    maxDurationMinutes: DEFAULT_MAX_DURATION_MINUTES,
    retentionDays: DEFAULT_RETENTION_DAYS,
    createdAt: now,
    updatedAt: now
  };
}

export async function getVoiceRecorderDashboard(guildId: string, botId: string, filters: VoiceRecorderFilters = {}) {
  const { voiceRecordings } = await getMongoCollections();
  const [settings, activeRecording, recordings] = await Promise.all([
    getVoiceRecorderSettings(guildId, botId),
    getActiveVoiceRecording(guildId, botId),
    voiceRecordings
      .find(buildRecordingQuery(guildId, botId, filters))
      .sort({ startedAt: -1 })
      .limit(100)
      .toArray()
  ]);

  return {
    settings,
    activeRecording: activeRecording ? toRecordingDto(activeRecording) : null,
    recordings: recordings.map(toRecordingDto),
    stats: await getVoiceRecorderStats(guildId, botId)
  };
}

export async function getVoiceRecorderSettings(guildId: string, botId: string): Promise<VoiceRecorderSettingsDto> {
  const { voiceRecorderSettings } = await getMongoCollections();
  const settings = await voiceRecorderSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultVoiceRecorderSettings(guildId, botId);
}

export async function saveVoiceRecorderSettings(
  guildId: string,
  botId: string,
  input: SaveVoiceRecorderSettingsInput,
  actorId: string | null
) {
  const current = await getVoiceRecorderSettings(guildId, botId);
  const next = normalizeSettings({
    ...current,
    ...input,
    botId,
    guildId
  });
  const now = new Date();

  await ensureGuild(guildId);
  const { voiceRecorderSettings } = await getMongoCollections();
  await voiceRecorderSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        botId,
        guildId,
        enabled: next.enabled,
        logChannelId: next.logChannelId,
        allowedRoleIds: next.allowedRoleIds,
        maxDurationMinutes: next.maxDurationMinutes,
        retentionDays: next.retentionDays,
        updatedBy: actorId,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdBy: actorId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  const saved = await getVoiceRecorderSettings(guildId, botId);
  const log = await createVoiceRecorderLog({
    botId,
    guildId,
    userId: actorId,
    type: "voice_recorder.settings_updated",
    message: saved.enabled ? "Voice Recorder atualizado e ativado." : "Voice Recorder atualizado e desativado.",
    metadata: {
      action: "settings_updated",
      changedKeys: Object.keys(input),
      module: MODULE_ID
    }
  });

  emitRealtime("voice-recorder:settings_updated", saved);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "voice-recorder:settings_updated", {
    botId,
    guildId,
    settings: saved
  });
  if (log) {
    emitRealtime("logs:new", log);
  }

  return saved;
}

export async function createDashboardVoiceRecordingRequest(input: CreateVoiceRecordingInput) {
  const settings = await getVoiceRecorderSettings(input.guildId, input.botId);

  validateSettingsReady(settings);
  await ensureNoActiveRecording(input.guildId, input.botId);
  const recording = await insertVoiceRecording(input, "starting");
  const dto = toRecordingDto(recording);

  emitRecordingEvent("start_requested", dto);
  emitRealtimeToRoom(devBotRealtimeRoom(input.botId), "voice-recorder:start", {
    actorId: input.actorId,
    actorTag: input.actorTag ?? null,
    botId: input.botId,
    channelId: input.channelId,
    guildId: input.guildId,
    recordingId: recording._id,
    source: "dashboard"
  });

  const log = await createVoiceRecorderLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.actorId,
    type: "voice_recorder.start_requested",
    message: "Inicio de gravacao solicitado pela dashboard.",
    metadata: {
      channelId: input.channelId,
      recordingId: recording._id
    }
  });

  if (log) {
    emitRealtime("logs:new", log);
  }

  return dto;
}

export async function createBotVoiceRecording(input: CreateVoiceRecordingInput) {
  const settings = await getVoiceRecorderSettings(input.guildId, input.botId);

  validateSettingsReady(settings);
  ensureActorAllowed(settings, input.actorRoleIds ?? []);
  await ensureNoActiveRecording(input.guildId, input.botId);
  const recording = await insertVoiceRecording(input, "recording");
  const dto = toRecordingDto(recording);
  const log = await createVoiceRecorderLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.actorId,
    type: "voice_recorder.started",
    message: `Gravacao iniciada em ${input.channelName ?? input.channelId}.`,
    metadata: {
      channelId: input.channelId,
      recordingId: recording._id,
      source: input.source
    }
  });

  emitRecordingEvent("started", dto);
  if (log) {
    emitRealtime("logs:new", log);
  }

  return {
    recording: dto,
    settings
  };
}

export async function markDashboardVoiceRecordingStarted(
  recordingId: string,
  botId: string,
  input: {
    channelName?: string | null;
    guildName?: string | null;
  } = {}
) {
  const { voiceRecordings } = await getMongoCollections();
  const now = new Date();
  const recording = await voiceRecordings.findOneAndUpdate(
    {
      _id: recordingId,
      botId,
      status: "starting"
    },
    {
      $set: {
        channelName: normalizeShortText(input.channelName, 100),
        guildName: normalizeShortText(input.guildName, 100),
        status: "recording",
        updatedAt: now
      },
      $push: {
        events: {
          type: "recording_started",
          userId: null,
          username: null,
          message: "Bot iniciou a captura de audio.",
          createdAt: now
        }
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!recording) {
    throw createVoiceRecorderError("Gravacao pendente nao encontrada para iniciar.", 404);
  }

  const dto = toRecordingDto(recording);
  emitRecordingEvent("started", dto);
  return dto;
}

export async function requestDashboardVoiceRecordingStop(input: {
  actorId: string;
  actorTag?: string | null;
  botId: string;
  guildId: string;
  recordingId?: string | null;
}) {
  const recording = input.recordingId
    ? await getVoiceRecordingForBot(input.recordingId, input.botId)
    : await getActiveVoiceRecording(input.guildId, input.botId);

  if (!recording || !ACTIVE_STATUSES.includes(recording.status)) {
    throw createVoiceRecorderError("Nao existe gravacao em andamento neste servidor.", 409);
  }

  emitRealtimeToRoom(devBotRealtimeRoom(input.botId), "voice-recorder:stop", {
    actorId: input.actorId,
    actorTag: input.actorTag ?? null,
    botId: input.botId,
    guildId: input.guildId,
    recordingId: recording._id,
    source: "dashboard"
  });

  const log = await createVoiceRecorderLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.actorId,
    type: "voice_recorder.stop_requested",
    message: "Encerramento de gravacao solicitado pela dashboard.",
    metadata: {
      recordingId: recording._id
    }
  });

  if (log) {
    emitRealtime("logs:new", log);
  }

  return toRecordingDto(recording);
}

export async function markVoiceRecordingProcessing(input: {
  actorId: string;
  actorRoleIds?: string[];
  actorTag?: string | null;
  botId: string;
  guildId: string;
  recordingId?: string | null;
  skipRoleCheck?: boolean;
}) {
  const settings = await getVoiceRecorderSettings(input.guildId, input.botId);
  if (!input.skipRoleCheck) {
    ensureActorAllowed(settings, input.actorRoleIds ?? []);
  }

  const recording = input.recordingId
    ? await getVoiceRecordingForBot(input.recordingId, input.botId)
    : await getActiveVoiceRecording(input.guildId, input.botId);

  if (!recording || !ACTIVE_STATUSES.includes(recording.status)) {
    throw createVoiceRecorderError("Nao existe gravacao em andamento neste servidor.", 409);
  }

  const now = new Date();
  const { voiceRecordings } = await getMongoCollections();
  const updated = await voiceRecordings.findOneAndUpdate(
    {
      _id: recording._id,
      botId: input.botId
    },
    {
      $set: {
        stoppedById: input.actorId,
        stoppedByTag: normalizeShortText(input.actorTag, 100),
        status: "processing",
        updatedAt: now
      },
      $push: {
        events: {
          type: "recording_stop_requested",
          userId: input.actorId,
          username: normalizeShortText(input.actorTag, 100),
          message: "Encerramento da gravacao iniciado.",
          createdAt: now
        }
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createVoiceRecorderError("Nao foi possivel encerrar a gravacao.", 500);
  }

  const dto = toRecordingDto(updated);
  emitRecordingEvent("processing", dto);
  return dto;
}

export async function completeVoiceRecording(input: CompleteVoiceRecordingInput) {
  const recording = await getVoiceRecordingForBot(input.recordingId, input.botId);

  if (!recording) {
    throw createVoiceRecorderError("Gravacao nao encontrada para finalizar.", 404);
  }

  const filePath = normalizeStoragePath(input.filePath);
  const endedAt = parseDate(input.endedAt) ?? new Date();
  const relativePath = path.relative(STORAGE_ROOT, filePath).replace(/\\/g, "/");
  const now = new Date();
  const participants = normalizeParticipants(input.participants);
  const accessToken = recording.accessToken ?? randomBytes(24).toString("base64url");
  const { voiceRecordings } = await getMongoCollections();
  const updated = await voiceRecordings.findOneAndUpdate(
    {
      _id: input.recordingId,
      botId: input.botId
    },
    {
      $set: {
        endedAt,
        durationMs: clampInteger(input.durationMs, 0, 90 * 24 * 60 * 60 * 1000, Math.max(0, endedAt.getTime() - recording.startedAt.getTime())),
        fileName: path.basename(filePath),
        filePath: relativePath,
        fileSize: clampInteger(input.fileSize, 0, Number.MAX_SAFE_INTEGER, 0),
        mimeType: MIME_TYPE_MP3,
        participants,
        accessToken,
        status: "completed",
        error: null,
        updatedAt: now
      },
      $push: {
        events: {
          type: "recording_completed",
          userId: recording.stoppedById,
          username: recording.stoppedByTag,
          message: "Arquivo final da gravacao gerado.",
          createdAt: now,
          metadata: {
            fileSize: input.fileSize,
            participantCount: participants.length
          }
        }
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createVoiceRecorderError("Nao foi possivel salvar a gravacao final.", 500);
  }

  const dto = toRecordingDto(updated);
  const log = await createVoiceRecorderLog({
    botId: updated.botId,
    guildId: updated.guildId,
    userId: updated.stoppedById ?? updated.startedById,
    type: "voice_recorder.completed",
    message: `Gravacao ${updated._id} finalizada em ${formatDuration(updated.durationMs)}.`,
    metadata: voiceRecordingAuditMetadata(dto)
  });

  emitRecordingEvent("completed", dto);
  if (log) {
    emitRealtime("logs:new", log);
  }

  return dto;
}

export async function failVoiceRecording(input: {
  botId: string;
  error: string;
  guildId?: string | null;
  recordingId?: string | null;
}) {
  const recording = input.recordingId
    ? await getVoiceRecordingForBot(input.recordingId, input.botId)
    : input.guildId
      ? await getActiveVoiceRecording(input.guildId, input.botId)
      : null;

  if (!recording) {
    return null;
  }

  const now = new Date();
  const { voiceRecordings } = await getMongoCollections();
  const updated = await voiceRecordings.findOneAndUpdate(
    {
      _id: recording._id,
      botId: input.botId
    },
    {
      $set: {
        endedAt: recording.endedAt ?? now,
        durationMs: recording.durationMs || Math.max(0, now.getTime() - recording.startedAt.getTime()),
        error: normalizeShortText(input.error, 1000),
        status: "failed",
        updatedAt: now
      },
      $push: {
        events: {
          type: "recording_failed",
          userId: null,
          username: null,
          message: normalizeShortText(input.error, 500) ?? "Falha na gravacao.",
          createdAt: now
        }
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    return null;
  }

  const dto = toRecordingDto(updated);
  const log = await createVoiceRecorderLog({
    botId: updated.botId,
    guildId: updated.guildId,
    userId: updated.startedById,
    type: "voice_recorder.failed",
    message: `Falha na gravacao ${updated._id}: ${input.error}`,
    metadata: {
      recordingId: updated._id,
      error: input.error
    }
  });

  emitRecordingEvent("failed", dto);
  if (log) {
    emitRealtime("logs:new", log);
  }

  return dto;
}

export async function recordVoiceRecordingEvent(input: RecordVoiceEventInput) {
  const event: MongoVoiceRecordingEvent = {
    type: normalizeRequiredText(input.type, 80, "Tipo do evento obrigatorio."),
    userId: normalizeShortText(input.userId, 40),
    username: normalizeShortText(input.username, 100),
    message: normalizeRequiredText(input.message, 500, "Mensagem do evento obrigatoria."),
    createdAt: new Date(),
    metadata: input.metadata
  };
  const { voiceRecordings } = await getMongoCollections();
  const updated = await voiceRecordings.findOneAndUpdate(
    {
      _id: input.recordingId,
      botId: input.botId
    },
    {
      $push: {
        events: {
          $each: [event],
          $slice: -MAX_EVENTS_PER_RECORDING
        }
      },
      $set: {
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createVoiceRecorderError("Gravacao nao encontrada para registrar evento.", 404);
  }

  const dto = toRecordingDto(updated);
  emitRecordingEvent("event", dto);
  return dto;
}

export async function deleteVoiceRecording(recordingId: string, botId: string, actorId: string | null) {
  const recording = await getVoiceRecordingForBot(recordingId, botId);

  if (!recording) {
    throw createVoiceRecorderError("Gravacao nao encontrada.", 404);
  }

  if (ACTIVE_STATUSES.includes(recording.status)) {
    throw createVoiceRecorderError("Encerre a gravacao antes de excluir o arquivo.", 409);
  }

  await removeVoiceRecordingFile(recording).catch((error) => {
    console.warn("[voice-recorder] nao foi possivel remover arquivo:", error instanceof Error ? error.message : error);
  });

  const now = new Date();
  const { voiceRecordings } = await getMongoCollections();
  const updated = await voiceRecordings.findOneAndUpdate(
    {
      _id: recordingId,
      botId
    },
    {
      $set: {
        deletedAt: now,
        filePath: null,
        fileName: null,
        fileSize: 0,
        mimeType: null,
        status: "deleted",
        updatedAt: now
      },
      $push: {
        events: {
          type: "recording_deleted",
          userId: actorId,
          username: null,
          message: "Arquivo da gravacao excluido.",
          createdAt: now
        }
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createVoiceRecorderError("Nao foi possivel excluir a gravacao.", 500);
  }

  const dto = toRecordingDto(updated);
  const log = await createVoiceRecorderLog({
    botId,
    guildId: updated.guildId,
    userId: actorId,
    type: "voice_recorder.deleted",
    message: `Gravacao ${recordingId} excluida.`,
    metadata: {
      recordingId
    }
  });

  emitRecordingEvent("deleted", dto);
  if (log) {
    emitRealtime("logs:new", log);
  }

  return dto;
}

export async function getVoiceRecordingFile(recordingId: string, options: {
  accessToken?: string | null;
  botId?: string | null;
  guildId?: string | null;
} = {}) {
  const { voiceRecordings } = await getMongoCollections();
  const recording = await voiceRecordings.findOne({
    _id: recordingId,
    ...(options.botId ? { botId: options.botId } : {}),
    ...(options.guildId ? { guildId: options.guildId } : {})
  });

  if (!recording || recording.status !== "completed" || !recording.filePath) {
    throw createVoiceRecorderError("Arquivo da gravacao nao encontrado.", 404);
  }

  if (options.accessToken !== undefined && recording.accessToken !== options.accessToken) {
    throw createVoiceRecorderError("Link da gravacao invalido.", 403);
  }

  const filePath = normalizeStoragePath(recording.filePath);
  const stat = await fs.stat(filePath).catch(() => null);

  if (!stat?.isFile()) {
    throw createVoiceRecorderError("Arquivo fisico da gravacao nao encontrado.", 404);
  }

  return {
    filePath,
    fileName: recording.fileName ?? path.basename(filePath),
    mimeType: recording.mimeType ?? MIME_TYPE_MP3,
    size: stat.size,
    recording: toRecordingDto(recording)
  };
}

export async function cleanupExpiredVoiceRecordings() {
  const { voiceRecorderSettings, voiceRecordings } = await getMongoCollections();
  const settings = await voiceRecorderSettings.find({ retentionDays: { $gt: 0 } }).toArray();
  let deleted = 0;

  for (const setting of settings) {
    const cutoff = new Date(Date.now() - setting.retentionDays * 86_400_000);
    const expired = await voiceRecordings
      .find({
        botId: setting.botId,
        guildId: setting.guildId,
        status: "completed",
        endedAt: {
          $lt: cutoff
        }
      })
      .limit(100)
      .toArray();

    for (const recording of expired) {
      await removeVoiceRecordingFile(recording).catch(() => undefined);
      await voiceRecordings.updateOne(
        {
          _id: recording._id,
          botId: recording.botId
        },
        {
          $set: {
            deletedAt: new Date(),
            filePath: null,
            fileName: null,
            fileSize: 0,
            mimeType: null,
            status: "deleted",
            updatedAt: new Date()
          },
          $push: {
            events: {
              type: "retention_deleted",
              userId: null,
              username: null,
              message: "Arquivo excluido automaticamente pela retencao.",
              createdAt: new Date()
            }
          }
        }
      );
      deleted += 1;
    }
  }

  return {
    deleted
  };
}

export function startVoiceRecorderRetentionScheduler() {
  void cleanupExpiredVoiceRecordings().catch((error) => {
    console.warn("[voice-recorder] limpeza inicial falhou:", error instanceof Error ? error.message : error);
  });

  const interval = setInterval(() => {
    void cleanupExpiredVoiceRecordings().catch((error) => {
      console.warn("[voice-recorder] limpeza agendada falhou:", error instanceof Error ? error.message : error);
    });
  }, 60 * 60_000);

  interval.unref();
}

export async function getActiveVoiceRecording(guildId: string, botId: string) {
  const { voiceRecordings } = await getMongoCollections();
  return voiceRecordings.findOne({
    botId,
    guildId,
    status: {
      $in: ACTIVE_STATUSES
    }
  });
}

export function publicVoiceRecordingUrl(recording: Pick<MongoVoiceRecording, "_id" | "accessToken"> | Pick<VoiceRecordingDto, "id"> & { accessToken?: string | null }) {
  const id = "_id" in recording ? recording._id : recording.id;
  const token = "accessToken" in recording ? recording.accessToken : null;

  if (!token) {
    return null;
  }

  const origin = env.SITE_ORIGIN || env.FRONTEND_URL;
  const pathValue = `/api/voice-recorder/files/${encodeURIComponent(id)}/${encodeURIComponent(token)}`;

  return origin ? `${origin}${pathValue}` : pathValue;
}

function buildRecordingQuery(guildId: string, botId: string, filters: VoiceRecorderFilters) {
  const query: Record<string, unknown> = {
    botId,
    guildId,
    status: {
      $ne: "deleted"
    }
  };
  const channelId = normalizeSnowflake(filters.channelId);
  const userId = normalizeSnowflake(filters.userId);

  if (channelId) {
    query.channelId = channelId;
  }

  if (userId) {
    query.$or = [
      { startedById: userId },
      { stoppedById: userId },
      { "participants.userId": userId }
    ];
  }

  const startedAt: Record<string, Date> = {};
  const dateFrom = parseDate(filters.dateFrom);
  const dateTo = parseDate(filters.dateTo);

  if (dateFrom) startedAt.$gte = dateFrom;
  if (dateTo) startedAt.$lte = endOfDay(dateTo);
  if (Object.keys(startedAt).length) query.startedAt = startedAt;

  const durationMs: Record<string, number> = {};
  if (Number.isFinite(filters.minDurationSeconds ?? NaN)) {
    durationMs.$gte = Math.max(0, Math.trunc(Number(filters.minDurationSeconds) * 1000));
  }
  if (Number.isFinite(filters.maxDurationSeconds ?? NaN)) {
    durationMs.$lte = Math.max(0, Math.trunc(Number(filters.maxDurationSeconds) * 1000));
  }
  if (Object.keys(durationMs).length) query.durationMs = durationMs;

  const search = normalizeShortText(filters.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegExp(search), "i");
    const currentOr = Array.isArray(query.$or) ? query.$or : [];
    query.$or = [
      ...currentOr,
      { _id: regex },
      { channelName: regex },
      { startedByTag: regex },
      { stoppedByTag: regex },
      { "participants.username": regex }
    ];
  }

  return query;
}

async function getVoiceRecorderStats(guildId: string, botId: string): Promise<VoiceRecorderStatsDto> {
  const { voiceRecordings } = await getMongoCollections();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [aggregate] = await voiceRecordings
    .aggregate<{
      totalRecordings: number;
      totalDurationMs: number;
      totalStorageBytes: number;
      recordingsThisMonth: number;
      recordingsToday: number;
    }>([
      {
        $match: {
          botId,
          guildId,
          status: {
            $in: COMPLETED_STATUSES
          }
        }
      },
      {
        $group: {
          _id: null,
          totalRecordings: { $sum: 1 },
          totalDurationMs: { $sum: "$durationMs" },
          totalStorageBytes: { $sum: "$fileSize" },
          recordingsThisMonth: {
            $sum: {
              $cond: [{ $gte: ["$startedAt", monthStart] }, 1, 0]
            }
          },
          recordingsToday: {
            $sum: {
              $cond: [{ $gte: ["$startedAt", todayStart] }, 1, 0]
            }
          }
        }
      }
    ])
    .toArray();

  return {
    totalRecordings: aggregate?.totalRecordings ?? 0,
    totalDurationMs: aggregate?.totalDurationMs ?? 0,
    totalStorageBytes: aggregate?.totalStorageBytes ?? 0,
    recordingsThisMonth: aggregate?.recordingsThisMonth ?? 0,
    recordingsToday: aggregate?.recordingsToday ?? 0,
    activeRecording: Boolean(await getActiveVoiceRecording(guildId, botId))
  };
}

async function insertVoiceRecording(input: CreateVoiceRecordingInput, status: "starting" | "recording") {
  const { voiceRecordings } = await getMongoCollections();
  const now = new Date();
  const recording: MongoVoiceRecording = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    guildName: normalizeShortText(input.guildName, 100),
    channelId: input.channelId,
    channelName: normalizeShortText(input.channelName, 100),
    startedById: input.actorId,
    startedByTag: normalizeShortText(input.actorTag, 100),
    stoppedById: null,
    stoppedByTag: null,
    source: input.source,
    participants: [],
    events: [{
      type: status === "starting" ? "start_requested" : "recording_started",
      userId: input.actorId,
      username: normalizeShortText(input.actorTag, 100),
      message: status === "starting" ? "Inicio solicitado pela dashboard." : "Gravacao iniciada pelo bot.",
      createdAt: now,
      metadata: {
        channelId: input.channelId,
        source: input.source
      }
    }],
    startedAt: now,
    endedAt: null,
    durationMs: 0,
    filePath: null,
    fileName: null,
    fileSize: 0,
    mimeType: null,
    accessToken: null,
    status,
    error: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };

  try {
    await ensureGuild(input.guildId);
    await voiceRecordings.insertOne(recording);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw createVoiceRecorderError("Ja existe uma gravacao em andamento neste servidor.", 409);
    }

    throw error;
  }

  return recording;
}

async function ensureNoActiveRecording(guildId: string, botId: string) {
  const active = await getActiveVoiceRecording(guildId, botId);

  if (active) {
    throw createVoiceRecorderError("Ja existe uma gravacao em andamento neste servidor.", 409);
  }
}

async function getVoiceRecordingForBot(recordingId: string, botId: string) {
  const { voiceRecordings } = await getMongoCollections();
  return voiceRecordings.findOne({
    _id: recordingId,
    botId
  });
}

function validateSettingsReady(settings: VoiceRecorderSettingsDto) {
  if (!settings.enabled) {
    throw createVoiceRecorderError("O Voice Recorder esta desativado neste servidor.", 403);
  }

  if (!settings.allowedRoleIds.length) {
    throw createVoiceRecorderError("Configure pelo menos um cargo autorizado antes de usar o Voice Recorder.", 400);
  }
}

function ensureActorAllowed(settings: VoiceRecorderSettingsDto, actorRoleIds: string[]) {
  const allowed = new Set(settings.allowedRoleIds);

  if (!actorRoleIds.some((roleId) => allowed.has(roleId))) {
    throw createVoiceRecorderError("Voce nao tem cargo autorizado para usar o Voice Recorder.", 403);
  }
}

function normalizeSettings(settings: VoiceRecorderSettingsDto): VoiceRecorderSettingsDto {
  return {
    ...settings,
    allowedRoleIds: normalizeSnowflakes(settings.allowedRoleIds),
    logChannelId: normalizeSnowflake(settings.logChannelId),
    maxDurationMinutes: clampInteger(settings.maxDurationMinutes, 1, 24 * 60, DEFAULT_MAX_DURATION_MINUTES),
    retentionDays: clampInteger(settings.retentionDays, 1, 3650, DEFAULT_RETENTION_DAYS)
  };
}

function normalizeParticipants(participants: CompleteVoiceRecordingInput["participants"]) {
  return participants
    .slice(0, MAX_PARTICIPANTS_PER_RECORDING)
    .map<MongoVoiceRecordingParticipant>((participant) => ({
      userId: normalizeRequiredText(participant.userId, 40, "Participante sem ID."),
      username: normalizeShortText(participant.username, 100),
      joinedAt: parseDate(participant.joinedAt) ?? new Date(),
      leftAt: parseDate(participant.leftAt),
      speakingMs: clampInteger(participant.speakingMs ?? 0, 0, 90 * 24 * 60 * 60 * 1000, 0)
    }));
}

function normalizeStoragePath(value: string) {
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(STORAGE_ROOT, value);
  const relative = path.relative(STORAGE_ROOT, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createVoiceRecorderError("Caminho de arquivo fora do armazenamento do Voice Recorder.", 400);
  }

  return resolved;
}

async function removeVoiceRecordingFile(recording: MongoVoiceRecording) {
  if (!recording.filePath) {
    return;
  }

  const filePath = normalizeStoragePath(recording.filePath);
  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

function toSettingsDto(settings: MongoVoiceRecorderSettings): VoiceRecorderSettingsDto {
  return normalizeSettings({
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled === true,
    logChannelId: settings.logChannelId ?? null,
    allowedRoleIds: settings.allowedRoleIds ?? [],
    maxDurationMinutes: settings.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MINUTES,
    retentionDays: settings.retentionDays ?? DEFAULT_RETENTION_DAYS,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  });
}

function toRecordingDto(recording: MongoVoiceRecording): VoiceRecordingDto {
  const downloadUrl = recording.accessToken ? publicVoiceRecordingUrl(recording) : null;

  return {
    id: recording._id,
    botId: recording.botId,
    guildId: recording.guildId,
    guildName: recording.guildName ?? null,
    channelId: recording.channelId,
    channelName: recording.channelName ?? null,
    startedById: recording.startedById,
    startedByTag: recording.startedByTag ?? null,
    stoppedById: recording.stoppedById ?? null,
    stoppedByTag: recording.stoppedByTag ?? null,
    source: recording.source,
    participants: (recording.participants ?? []).map((participant) => ({
      userId: participant.userId,
      username: participant.username ?? null,
      joinedAt: participant.joinedAt.toISOString(),
      leftAt: participant.leftAt?.toISOString?.() ?? null,
      speakingMs: participant.speakingMs ?? 0
    })),
    events: (recording.events ?? []).map((event) => ({
      type: event.type,
      userId: event.userId ?? null,
      username: event.username ?? null,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
      metadata: event.metadata
    })),
    startedAt: recording.startedAt.toISOString(),
    endedAt: recording.endedAt?.toISOString?.() ?? null,
    durationMs: recording.durationMs ?? 0,
    fileName: recording.fileName ?? null,
    fileSize: recording.fileSize ?? 0,
    fileUrl: downloadUrl,
    downloadUrl,
    mimeType: recording.mimeType ?? null,
    status: recording.status,
    error: recording.error ?? null,
    deletedAt: recording.deletedAt?.toISOString?.() ?? null,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString()
  };
}

function voiceRecordingAuditMetadata(recording: VoiceRecordingDto) {
  return {
    recordingId: recording.id,
    guildId: recording.guildId,
    channelId: recording.channelId,
    channelName: recording.channelName,
    startedById: recording.startedById,
    stoppedById: recording.stoppedById,
    startedAt: recording.startedAt,
    endedAt: recording.endedAt,
    durationMs: recording.durationMs,
    participantCount: recording.participants.length,
    participants: recording.participants.map((participant) => ({
      userId: participant.userId,
      username: participant.username,
      speakingMs: participant.speakingMs
    })),
    fileName: recording.fileName,
    fileSize: recording.fileSize,
    fileUrl: recording.fileUrl
  };
}

function emitRecordingEvent(action: string, recording: VoiceRecordingDto) {
  const payload = {
    action,
    botId: recording.botId,
    guildId: recording.guildId,
    recording
  };

  emitRealtime("voice-recorder:recording_updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(recording.botId), "voice-recorder:recording_updated", payload);
}

async function createVoiceRecorderLog(input: Parameters<typeof createLog>[0]) {
  return createLog(input).catch((error) => {
    console.warn("[voice-recorder] nao foi possivel registrar log:", error instanceof Error ? error.message : error);
    return null;
  });
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => normalizeSnowflake(value)).filter((value): value is string => Boolean(value)))];
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeShortText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeRequiredText(value: unknown, maxLength: number, message: string) {
  const normalized = normalizeShortText(value, maxLength);

  if (!normalized) {
    throw createVoiceRecorderError(message, 400);
  }

  return normalized;
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function createVoiceRecorderError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
