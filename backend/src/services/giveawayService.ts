import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { env } from "../config/env";
import {
  ensureGuild,
  getMongoCollections,
  type MongoGiveaway,
  type MongoGiveawayParticipant,
  type MongoGiveawayStatus,
  type MongoGiveawayWinner
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { isGuildTextChannel } from "./discordOptionsService";
import { createLog } from "./logService";
import { getTwitchSubscribers, getTwitchUser, normalizeTwitchChannel } from "./twitchService";

export type GiveawayParticipantDto = {
  id: string;
  username: string;
  displayName: string;
  subscriber: boolean;
  source: "twitch";
  validatedAt: string;
};

export type GiveawayWinnerDto = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: string;
};

export type GiveawayDto = {
  id: string;
  botId: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch";
  twitchBroadcasterId: string;
  prizeName: string;
  participants: GiveawayParticipantDto[];
  winners: GiveawayWinnerDto[];
  status: MongoGiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  customMessage: string | null;
  schedulerError: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
};

export type SaveGiveawayInput = {
  allowRepeatWinners?: boolean;
  customMessage?: string | null;
  discordChannelId?: string | null;
  endDelayMinutes?: number | null;
  liveUrl: string;
  prizeName: string;
  startDelayMinutes?: number | null;
  title: string;
  winnerCount?: number | null;
};

export type GiveawaySpinResult = {
  giveaway: GiveawayDto;
  winner: GiveawayWinnerDto;
};

const GIVEAWAY_MODULE_ID = "giveaway";
const DEFAULT_WINNER_COUNT = 1;
const MAX_WINNER_COUNT = 50;
const MAX_DELAY_MINUTES = 60 * 24 * 30;
const MAX_SUBSCRIBERS_PER_SYNC = 5000;
let schedulerStarted = false;
let schedulerRunning = false;

export function giveawayModuleId() {
  return GIVEAWAY_MODULE_ID;
}

export async function listGiveaways(guildId: string, botId?: string | null, limit = 50) {
  const { giveaways } = await getMongoCollections();
  const docs = await giveaways
    .find(scopeQuery(guildId, normalizeBotId(botId)))
    .sort({
      createdAt: -1
    })
    .limit(Math.max(1, Math.min(limit, 100)))
    .toArray();

  return docs.map(toGiveawayDto);
}

export async function listBotGiveaways(botId?: string | null) {
  const { giveaways } = await getMongoCollections();
  const normalizedBotId = normalizeBotId(botId);
  const docs = await giveaways
    .find({
      discordChannelId: {
        $ne: null
      },
      $and: [
        botScopeQuery(normalizedBotId),
        {
          $or: [
            {
              status: {
                $in: ["waiting", "running"]
              }
            },
            {
              panelMessageId: {
                $ne: null
              }
            }
          ]
        }
      ]
    })
    .sort({
      updatedAt: -1
    })
    .limit(100)
    .toArray();

  return docs.map(toGiveawayDto);
}

export async function getGiveaway(giveawayId: string, botId?: string | null) {
  const giveaway = await findGiveawayById(giveawayId, normalizeBotId(botId));
  return giveaway ? toGiveawayDto(giveaway) : null;
}

export async function getRouletteGiveaway(token: string) {
  const giveaway = await findGiveawayByToken(token);

  if (!giveaway) {
    throw createGiveawayError("Roleta nao encontrada.", 404);
  }

  return toGiveawayDto(giveaway);
}

export async function createGiveaway(
  guildId: string,
  input: SaveGiveawayInput,
  ownerId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();
  const discordChannelId = normalizeDiscordChannelId(input.discordChannelId);

  if (discordChannelId && !(await isGuildTextChannel(guildId, discordChannelId, botToken))) {
    throw createGiveawayError("O canal selecionado nao pertence a este servidor.", 400);
  }

  const live = await resolveTwitchLive(input.liveUrl);
  const rouletteToken = randomBytes(24).toString("base64url");
  const startDelayMinutes = normalizeDelay(input.startDelayMinutes);
  const endDelayMinutes = normalizeDelay(input.endDelayMinutes);
  const doc: MongoGiveaway = {
    _id: randomUUID(),
    botId: normalizedBotId,
    guildId,
    ownerId,
    discordChannelId,
    title: normalizeTitle(input.title),
    liveName: live.displayName,
    liveUrl: live.url,
    livePlatform: "twitch",
    twitchBroadcasterId: live.id,
    prizeName: normalizePrize(input.prizeName),
    participants: [],
    winners: [],
    status: "waiting",
    rouletteToken,
    rouletteUrl: buildRouletteUrl(rouletteToken),
    panelMessageId: null,
    winnerCount: normalizeWinnerCount(input.winnerCount),
    allowRepeatWinners: input.allowRepeatWinners === true,
    startDelayMinutes,
    endDelayMinutes,
    scheduledStartAt: startDelayMinutes > 0 ? addMinutes(now, startDelayMinutes) : null,
    scheduledEndAt: null,
    customMessage: normalizeMessage(input.customMessage),
    schedulerError: null,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    updatedAt: now
  };

  await ensureGuild(guildId);
  const { giveaways } = await getMongoCollections();
  await giveaways.insertOne(doc);
  await writeGiveawayLog(doc, "giveaway.created", ownerId, `Sorteio criado: ${doc.title}.`);
  emitGiveawayUpdated(doc);

  return toGiveawayDto(doc);
}

export async function updateGiveaway(
  giveawayId: string,
  input: SaveGiveawayInput,
  actorId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await findGiveawayById(giveawayId, normalizedBotId);

  if (!current) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  if (current.status === "ended") {
    throw createGiveawayError("Sorteios encerrados nao podem ser editados.", 400);
  }

  const discordChannelId = normalizeDiscordChannelId(input.discordChannelId);

  if (discordChannelId && !(await isGuildTextChannel(current.guildId, discordChannelId, botToken))) {
    throw createGiveawayError("O canal selecionado nao pertence a este servidor.", 400);
  }

  const live = await resolveTwitchLive(input.liveUrl);
  const now = new Date();
  const startDelayMinutes = normalizeDelay(input.startDelayMinutes);
  const endDelayMinutes = normalizeDelay(input.endDelayMinutes);
  const patch: Partial<MongoGiveaway> = {
    discordChannelId,
    title: normalizeTitle(input.title),
    liveName: live.displayName,
    liveUrl: live.url,
    livePlatform: "twitch",
    twitchBroadcasterId: live.id,
    prizeName: normalizePrize(input.prizeName),
    winnerCount: normalizeWinnerCount(input.winnerCount),
    allowRepeatWinners: input.allowRepeatWinners === true,
    startDelayMinutes,
    endDelayMinutes,
    scheduledStartAt: current.status === "waiting" && startDelayMinutes > 0 ? addMinutes(now, startDelayMinutes) : null,
    scheduledEndAt: current.status === "running" && endDelayMinutes > 0 ? addMinutes(now, endDelayMinutes) : current.scheduledEndAt,
    customMessage: normalizeMessage(input.customMessage),
    schedulerError: null,
    updatedAt: now
  };

  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveawayId,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: patch
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  await writeGiveawayLog(updated, "giveaway.updated", actorId, `Sorteio atualizado: ${updated.title}.`);
  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  return toGiveawayDto(updated);
}

export async function publishGiveawayPanel(giveawayId: string, actorId: string, botId?: string | null) {
  const giveaway = await findGiveawayById(giveawayId, normalizeBotId(botId));

  if (!giveaway) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  if (!giveaway.discordChannelId) {
    throw createGiveawayError("Selecione o canal do Discord antes de criar o painel.", 400);
  }

  await writeGiveawayLog(giveaway, "giveaway.panel_requested", actorId, `Painel do sorteio solicitado: ${giveaway.title}.`);
  requestGiveawayPanelUpdate(giveaway, "publish");

  return toGiveawayDto(giveaway);
}

export async function startGiveaway(giveawayId: string, actorId: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const giveaway = await findGiveawayById(giveawayId, normalizedBotId);

  if (!giveaway) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  if (giveaway.status === "ended") {
    throw createGiveawayError("Sorteio encerrado nao pode ser iniciado.", 400);
  }

  if (!giveaway.liveUrl || !giveaway.twitchBroadcasterId) {
    throw createGiveawayError("Cadastre a live antes de iniciar o sorteio.", 400);
  }

  const participants = await fetchSubscriberParticipants(giveaway);

  if (!participants.length) {
    throw createGiveawayError("Nenhum sub foi encontrado para esta live.", 400);
  }

  const now = new Date();
  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveaway._id,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        participants,
        status: "running",
        startedAt: giveaway.startedAt ?? now,
        scheduledStartAt: null,
        scheduledEndAt: giveaway.endDelayMinutes > 0 ? addMinutes(now, giveaway.endDelayMinutes) : giveaway.scheduledEndAt,
        schedulerError: null,
        updatedAt: now
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  await writeGiveawayLog(updated, "giveaway.started", actorId, `Sorteio iniciado com ${participants.length} sub(s): ${updated.title}.`);
  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  return toGiveawayDto(updated);
}

export async function endGiveaway(giveawayId: string, actorId: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { giveaways } = await getMongoCollections();
  const now = new Date();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveawayId,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        status: "ended",
        scheduledStartAt: null,
        scheduledEndAt: null,
        endedAt: now,
        schedulerError: null,
        updatedAt: now
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  await writeGiveawayLog(updated, "giveaway.ended", actorId, `Sorteio encerrado: ${updated.title}.`);
  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  return toGiveawayDto(updated);
}

export async function spinGiveawayRoulette(token: string): Promise<GiveawaySpinResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const giveaway = await findGiveawayByToken(token);

    if (!giveaway) {
      throw createGiveawayError("Roleta nao encontrada.", 404);
    }

    if (giveaway.status !== "running") {
      throw createGiveawayError(giveaway.status === "ended" ? "Esta roleta ja foi encerrada." : "O sorteio ainda nao foi iniciado.", 400);
    }

    if (giveaway.winners.length >= giveaway.winnerCount) {
      const ended = await endGiveaway(giveaway._id, null, giveaway.botId);
      throw createGiveawayError(`Limite de ${ended.winnerCount} ganhador(es) ja foi atingido.`, 400);
    }

    const freshParticipants = await fetchSubscriberParticipants(giveaway);
    const previousWinnerIds = new Set(giveaway.winners.map((winner) => winner.participantId));
    const eligibleParticipants = freshParticipants.filter((participant) => (
      giveaway.allowRepeatWinners || !previousWinnerIds.has(participant.id)
    ));

    if (!eligibleParticipants.length) {
      throw createGiveawayError("Nao existem subs elegiveis para sortear.", 400);
    }

    const participant = eligibleParticipants[randomInt(eligibleParticipants.length)];

    if (!participant) {
      throw createGiveawayError("Nao foi possivel selecionar um participante.", 500);
    }

    const now = new Date();
    const winner: MongoGiveawayWinner = {
      participantId: participant.id,
      username: participant.username,
      displayName: participant.displayName,
      wonAt: now
    };
    const willEnd = giveaway.winners.length + 1 >= giveaway.winnerCount;
    const updateQuery: Record<string, unknown> = {
      _id: giveaway._id,
      status: "running",
      $expr: {
        $lt: [
          {
            $size: "$winners"
          },
          "$winnerCount"
        ]
      }
    };

    if (!giveaway.allowRepeatWinners) {
      updateQuery["winners.participantId"] = {
        $ne: winner.participantId
      };
    }

    const { giveaways } = await getMongoCollections();
    const result = await giveaways.updateOne(updateQuery, {
      $push: {
        winners: winner
      },
      $set: {
        participants: freshParticipants,
        status: willEnd ? "ended" : "running",
        endedAt: willEnd ? now : giveaway.endedAt,
        scheduledEndAt: willEnd ? null : giveaway.scheduledEndAt,
        schedulerError: null,
        updatedAt: now
      }
    });

    if (!result.modifiedCount) {
      continue;
    }

    const updated = await findGiveawayById(giveaway._id, normalizeBotId(giveaway.botId));

    if (!updated) {
      throw createGiveawayError("Sorteio nao encontrado apos girar a roleta.", 404);
    }

    await writeGiveawayLog(updated, "giveaway.winner", null, `Ganhador sorteado: ${winner.displayName}.`);
    emitGiveawayUpdated(updated);
    requestGiveawayPanelUpdate(updated, "update");

    return {
      giveaway: toGiveawayDto(updated),
      winner: toWinnerDto(winner)
    };
  }

  throw createGiveawayError("Nao foi possivel confirmar o vencedor. Tente girar novamente.", 409);
}

export async function updateGiveawayPanelState(
  giveawayId: string,
  input: {
    panelMessageId?: string | null;
  },
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveawayId,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        panelMessageId: input.panelMessageId ?? null,
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  emitGiveawayUpdated(updated);
  return toGiveawayDto(updated);
}

export function startGiveawayScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  const interval = setInterval(() => {
    void runScheduledGiveaways().catch((error) => {
      console.warn("[giveaway] scheduler falhou:", error instanceof Error ? error.message : error);
    });
  }, 30_000);

  interval.unref();
  void runScheduledGiveaways().catch((error) => {
    console.warn("[giveaway] scheduler inicial falhou:", error instanceof Error ? error.message : error);
  });
}

async function runScheduledGiveaways() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;

  try {
    const now = new Date();
    const { giveaways } = await getMongoCollections();
    const [toStart, toEnd] = await Promise.all([
      giveaways
        .find({
          status: "waiting",
          scheduledStartAt: {
            $ne: null,
            $lte: now
          }
        })
        .limit(20)
        .toArray(),
      giveaways
        .find({
          status: "running",
          scheduledEndAt: {
            $ne: null,
            $lte: now
          }
        })
        .limit(20)
        .toArray()
    ]);

    for (const giveaway of toStart) {
      await startGiveaway(giveaway._id, null, giveaway.botId).catch((error) => markSchedulerError(giveaway._id, error));
    }

    for (const giveaway of toEnd) {
      await endGiveaway(giveaway._id, null, giveaway.botId).catch((error) => markSchedulerError(giveaway._id, error));
    }
  } finally {
    schedulerRunning = false;
  }
}

async function markSchedulerError(giveawayId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const { giveaways } = await getMongoCollections();
  await giveaways.updateOne(
    {
      _id: giveawayId
    },
    {
      $set: {
        schedulerError: message,
        updatedAt: new Date()
      }
    }
  );
}

async function findGiveawayById(giveawayId: string, botId: string | null) {
  const { giveaways } = await getMongoCollections();
  return giveaways.findOne({
    _id: giveawayId,
    ...botScopeQuery(botId)
  });
}

async function findGiveawayByToken(token: string) {
  const { giveaways } = await getMongoCollections();
  return giveaways.findOne({
    rouletteToken: token
  });
}

async function resolveTwitchLive(value: string) {
  const channel = normalizeTwitchChannel(value);

  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) {
    throw createGiveawayError("Informe uma URL ou canal valido da Twitch.", 400);
  }

  const user = await getTwitchUser(channel).catch((error) => {
    throw createGiveawayError(error instanceof Error ? error.message : "Nao foi possivel consultar a Twitch.", 503);
  });

  if (!user) {
    throw createGiveawayError("Canal da Twitch nao encontrado.", 404);
  }

  return {
    id: user.id,
    displayName: user.displayName || user.login,
    login: user.login,
    url: `https://www.twitch.tv/${user.login}`
  };
}

async function fetchSubscriberParticipants(giveaway: Pick<MongoGiveaway, "twitchBroadcasterId">): Promise<MongoGiveawayParticipant[]> {
  const subscribers = await getTwitchSubscribers({
    broadcasterId: giveaway.twitchBroadcasterId,
    max: MAX_SUBSCRIBERS_PER_SYNC
  }).catch((error) => {
    throw createGiveawayError(error instanceof Error ? error.message : "Nao foi possivel validar os subs da Twitch.", 503);
  });
  const now = new Date();

  return subscribers.map((subscriber) => ({
    id: subscriber.id,
    username: subscriber.login,
    displayName: subscriber.displayName,
    subscriber: true,
    source: "twitch",
    validatedAt: now
  }));
}

function emitGiveawayUpdated(giveaway: MongoGiveaway) {
  emitRealtime("giveaway:updated", toGiveawayDto(giveaway));
}

function requestGiveawayPanelUpdate(giveaway: MongoGiveaway, action: "publish" | "update") {
  const payload = {
    action,
    botId: normalizeBotId(giveaway.botId),
    giveawayId: giveaway._id,
    guildId: giveaway.guildId
  };

  if (payload.botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(payload.botId), "giveaway:panel_update", payload);
    return;
  }

  emitRealtime("giveaway:panel_update", payload);
}

async function writeGiveawayLog(giveaway: MongoGiveaway, type: string, userId: string | null, message: string) {
  await createLog({
    botId: normalizeBotId(giveaway.botId),
    guildId: giveaway.guildId,
    userId,
    type,
    message,
    metadata: {
      giveawayId: giveaway._id,
      module: GIVEAWAY_MODULE_ID,
      status: giveaway.status
    }
  });
}

function toGiveawayDto(giveaway: MongoGiveaway): GiveawayDto {
  return {
    id: giveaway._id,
    botId: normalizeBotId(giveaway.botId),
    guildId: giveaway.guildId,
    ownerId: giveaway.ownerId,
    discordChannelId: giveaway.discordChannelId ?? null,
    title: giveaway.title,
    liveName: giveaway.liveName,
    liveUrl: giveaway.liveUrl,
    livePlatform: "twitch",
    twitchBroadcasterId: giveaway.twitchBroadcasterId,
    prizeName: giveaway.prizeName,
    participants: (giveaway.participants ?? []).map(toParticipantDto),
    winners: (giveaway.winners ?? []).map(toWinnerDto),
    status: giveaway.status,
    rouletteToken: giveaway.rouletteToken,
    rouletteUrl: giveaway.rouletteUrl,
    panelMessageId: giveaway.panelMessageId ?? null,
    winnerCount: giveaway.winnerCount,
    allowRepeatWinners: giveaway.allowRepeatWinners,
    startDelayMinutes: giveaway.startDelayMinutes,
    endDelayMinutes: giveaway.endDelayMinutes,
    scheduledStartAt: giveaway.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: giveaway.scheduledEndAt?.toISOString() ?? null,
    customMessage: giveaway.customMessage ?? null,
    schedulerError: giveaway.schedulerError ?? null,
    createdAt: giveaway.createdAt.toISOString(),
    startedAt: giveaway.startedAt?.toISOString() ?? null,
    endedAt: giveaway.endedAt?.toISOString() ?? null,
    updatedAt: giveaway.updatedAt.toISOString()
  };
}

function toParticipantDto(participant: MongoGiveawayParticipant): GiveawayParticipantDto {
  return {
    id: participant.id,
    username: participant.username,
    displayName: participant.displayName,
    subscriber: participant.subscriber,
    source: "twitch",
    validatedAt: participant.validatedAt.toISOString()
  };
}

function toWinnerDto(winner: MongoGiveawayWinner): GiveawayWinnerDto {
  return {
    participantId: winner.participantId,
    username: winner.username,
    displayName: winner.displayName,
    wonAt: winner.wonAt.toISOString()
  };
}

function normalizeTitle(value: string) {
  const title = value.trim().slice(0, 120);

  if (!title) {
    throw createGiveawayError("Informe o nome do sorteio.", 400);
  }

  return title;
}

function normalizePrize(value: string) {
  const prize = value.trim().slice(0, 160);

  if (!prize) {
    throw createGiveawayError("Informe o premio do sorteio.", 400);
  }

  return prize;
}

function normalizeMessage(value?: string | null) {
  const message = value?.trim();
  return message ? message.slice(0, 1200) : null;
}

function normalizeDiscordChannelId(value?: string | null) {
  const channelId = value?.trim();
  return channelId && /^\d{5,32}$/.test(channelId) ? channelId : null;
}

function normalizeWinnerCount(value?: number | null) {
  const count = Math.floor(Number(value ?? DEFAULT_WINNER_COUNT));
  return Math.max(1, Math.min(Number.isFinite(count) ? count : DEFAULT_WINNER_COUNT, MAX_WINNER_COUNT));
}

function normalizeDelay(value?: number | null) {
  const minutes = Math.floor(Number(value ?? 0));
  return Math.max(0, Math.min(Number.isFinite(minutes) ? minutes : 0, MAX_DELAY_MINUTES));
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function buildRouletteUrl(token: string) {
  const origin = env.SITE_ORIGIN || env.FRONTEND_URL;

  if (!origin) {
    throw createGiveawayError("SITE_ORIGIN ou FRONTEND_URL precisa estar configurada para gerar o link publico da roleta.", 503);
  }

  return `${origin}/roulette/${encodeURIComponent(token)}`;
}

function scopeQuery(guildId: string, botId: string | null) {
  return {
    guildId,
    ...botScopeQuery(botId)
  };
}

function botScopeQuery(botId: string | null) {
  return botId
    ? {
        botId
      }
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
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

export function createGiveawayError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
