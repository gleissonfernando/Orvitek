import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoLogEntry } from "../database/mongo";

export type LogEntryDto = {
  id: string;
  botId: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateLogInput = {
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

const memoryLogs: LogEntryDto[] = [];

export async function createLog(input: CreateLogInput) {
  const log: LogEntryDto = {
    id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    userId: input.userId,
    type: input.type,
    message: input.message,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };

  memoryLogs.unshift(log);

  try {
    await ensureGuild(input.guildId);

    const { logEntries } = await getMongoCollections();
    const doc: MongoLogEntry = {
      _id: randomUUID(),
      botId: normalizeBotId(input.botId),
      guildId: input.guildId,
      userId: input.userId ?? null,
      type: input.type,
      message: input.message,
      createdAt: new Date()
    };

    if (input.metadata !== undefined) {
      doc.metadata = input.metadata;
    }

    await logEntries.insertOne(doc);

    return {
      ...log,
      id: doc._id,
      botId: normalizeBotId(doc.botId),
      userId: doc.userId,
      createdAt: doc.createdAt.toISOString()
    };
  } catch (error) {
    console.warn("[mongo] log mantido em memoria:", error instanceof Error ? error.message : error);
    return log;
  }
}

export async function listLogs(guildId?: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { logEntries } = await getMongoCollections();
    const logs = await logEntries
      .find(scopedQuery(guildId, normalizedBotId))
      .sort({
        createdAt: -1
      })
      .limit(50)
      .toArray();

    return logs.map((log) => ({
      id: log._id,
      botId: normalizeBotId(log.botId),
      guildId: log.guildId,
      userId: log.userId,
      type: log.type,
      message: log.message,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    }));
  } catch {
    return memoryLogs
      .filter((log) => (!guildId || log.guildId === guildId) && log.botId === normalizedBotId)
      .slice(0, 50);
  }
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function scopedQuery(guildId: string | undefined, botId: string | null) {
  const botScope = botId
    ? { botId }
    : {
        $or: [
          {
            botId: null
          },
          {
            botId: {
              $exists: false
            }
          }
        ]
      };

  return guildId ? { guildId, ...botScope } : botScope;
}
