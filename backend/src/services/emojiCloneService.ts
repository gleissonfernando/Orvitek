import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoEmojiCloneItem,
  type MongoEmojiCloneJob,
  type MongoEmojiLibraryItem
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog } from "./logService";

export type RecordEmojiCloneJobInput = {
  botId?: string | null;
  guildId: string;
  userId: string;
  sourceGuildId?: string | null;
  status: MongoEmojiCloneJob["status"];
  total: number;
  success: number;
  failed: number;
  prefix?: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  items: Array<{
    originalEmojiId: string;
    originalName: string;
    originalUrl?: string | null;
    newEmojiId?: string | null;
    newName?: string | null;
    animated: boolean;
    status: MongoEmojiCloneItem["status"];
    errorReason?: string | null;
  }>;
};

export async function recordEmojiCloneJob(input: RecordEmojiCloneJobInput) {
  const now = new Date();
  const job: MongoEmojiCloneJob = {
    _id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    userId: input.userId,
    sourceGuildId: normalizeBotId(input.sourceGuildId),
    status: input.status,
    total: input.total,
    success: input.success,
    failed: input.failed,
    prefix: input.prefix?.trim() || null,
    createdAt: input.createdAt ? new Date(input.createdAt) : now,
    finishedAt: input.finishedAt ? new Date(input.finishedAt) : now
  };
  const items: MongoEmojiCloneItem[] = input.items.map((item) => ({
    _id: randomUUID(),
    jobId: job._id,
    originalEmojiId: item.originalEmojiId,
    originalName: item.originalName,
    newEmojiId: item.newEmojiId ?? null,
    newName: item.newName ?? null,
    animated: item.animated,
    status: item.status,
    errorReason: item.errorReason ?? null
  }));

  await ensureGuild(job.guildId);
  const { emojiCloneItems, emojiCloneJobs } = await getMongoCollections();
  await emojiCloneJobs.insertOne(job);
  if (items.length) {
    await emojiCloneItems.insertMany(items);
  }

  const libraryItems = await upsertEmojiLibraryItems(job, input.items);

  await createLog({
    botId: job.botId,
    guildId: job.guildId,
    userId: job.userId,
    type: "emoji_clone.completed",
    message: `Clonagem de emojis finalizada: ${job.success}/${job.total} com sucesso.`,
    metadata: {
      failed: job.failed,
      jobId: job._id,
      prefix: job.prefix,
      sourceGuildId: job.sourceGuildId,
      total: job.total
    }
  }).catch(() => undefined);

  emitRealtime("emoji-cloner:job_recorded", {
    botId: job.botId,
    guildId: job.guildId,
    job: {
      id: job._id,
      failed: job.failed,
      success: job.success,
      total: job.total
    },
    libraryItems,
    userId: job.userId
  });

  return {
    ...job,
    id: job._id,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    items: items.map((item) => ({ ...item, id: item._id }))
  };
}

export async function listEmojiLibrary(input: {
  animated?: boolean | null;
  botId: string;
  query?: string | null;
  userId: string;
}) {
  const { emojiLibrary } = await getMongoCollections();
  const query: Record<string, unknown> = {
    botId: input.botId,
    userId: input.userId
  };
  const search = input.query?.trim();

  if (typeof input.animated === "boolean") {
    query.animated = input.animated;
  }

  if (search) {
    query.name = {
      $regex: escapeRegex(search),
      $options: "i"
    };
  }

  const items = await emojiLibrary
    .find(query)
    .sort({ importedAt: -1 })
    .limit(250)
    .toArray();

  return items.map(toLibraryDto);
}

async function upsertEmojiLibraryItems(job: MongoEmojiCloneJob, items: RecordEmojiCloneJobInput["items"]) {
  const botId = normalizeBotId(job.botId);

  if (!botId) {
    return [];
  }

  const successfulItems = items.filter((item) => item.status === "success" && item.newEmojiId && item.originalUrl);

  if (!successfulItems.length) {
    return [];
  }

  const { emojiLibrary } = await getMongoCollections();
  const now = new Date();
  const ids: string[] = [];

  for (const item of successfulItems) {
    const id = randomUUID();
    ids.push(item.originalEmojiId);
    await emojiLibrary.updateOne(
      {
        botId,
        originalEmojiId: item.originalEmojiId,
        userId: job.userId
      },
      {
        $set: {
          animated: item.animated,
          destinationGuildId: job.guildId,
          lastUpdatedAt: now,
          name: item.newName ?? item.originalName,
          originalEmojiId: item.originalEmojiId,
          sourceGuildId: job.sourceGuildId,
          targetEmojiId: item.newEmojiId ?? null,
          targetEmojiName: item.newName ?? null,
          url: item.originalUrl ?? "",
          userId: job.userId
        },
        $setOnInsert: {
          _id: id,
          botId,
          importedAt: job.finishedAt ?? now
        }
      },
      {
        upsert: true
      }
    );

    await createLog({
      botId,
      guildId: job.guildId,
      userId: job.userId,
      type: "emoji_clone.library_saved",
      message: `Emoji salvo na Biblioteca: ${item.newName ?? item.originalName}.`,
      metadata: {
        animated: item.animated,
        originalEmojiId: item.originalEmojiId,
        sourceGuildId: job.sourceGuildId,
        targetEmojiId: item.newEmojiId
      }
    }).catch(() => undefined);
  }

  const saved = await emojiLibrary.find({
    botId,
    originalEmojiId: { $in: ids },
    userId: job.userId
  }).toArray();

  return saved.map(toLibraryDto);
}

function toLibraryDto(item: MongoEmojiLibraryItem) {
  return {
    id: item._id,
    animated: item.animated,
    botId: item.botId,
    destinationGuildId: item.destinationGuildId,
    importedAt: item.importedAt.toISOString(),
    lastUpdatedAt: item.lastUpdatedAt.toISOString(),
    name: item.name,
    originalEmojiId: item.originalEmojiId,
    sourceGuildId: item.sourceGuildId,
    targetEmojiId: item.targetEmojiId,
    targetEmojiName: item.targetEmojiName,
    url: item.url,
    userId: item.userId
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBotId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}
