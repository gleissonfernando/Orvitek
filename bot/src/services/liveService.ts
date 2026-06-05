import { ActivityType, type Presence } from "discord.js";
import type { BotContext } from "../types";

export async function handlePresenceUpdate(context: BotContext, oldPresence: Presence | null, newPresence: Presence) {
  const guildId = newPresence.guild?.id ?? oldPresence?.guild?.id;
  const userId = newPresence.userId;

  if (!guildId || !userId) {
    return;
  }

  const key = `${guildId}:${userId}`;
  const streaming = newPresence.activities.find((activity) => activity.type === ActivityType.Streaming);
  const wasStreaming = context.liveCache.has(key);

  if (streaming && !wasStreaming) {
    context.liveCache.add(key);

    const payload = {
      guildId,
      streamer: newPresence.user?.tag ?? userId,
      title: streaming.name,
      url: streaming.url ?? undefined
    };

    await notifyLiveStarted(context, payload);
    return;
  }

  if (!streaming && wasStreaming) {
    context.liveCache.delete(key);

    const payload = {
      guildId,
      streamer: newPresence.user?.tag ?? userId
    };

    await notifyLiveEnded(context, payload);
  }
}

async function notifyLiveStarted(context: BotContext, payload: { guildId: string; streamer: string; title?: string; url?: string }) {
  try {
    await context.api.notifyLive({
      ...payload,
      type: "started"
    });
  } catch (error) {
    console.warn("[api] falha ao registrar inicio de live:", error instanceof Error ? error.message : error);
    context.socket.emitLiveStarted(payload);
  }
}

async function notifyLiveEnded(context: BotContext, payload: { guildId: string; streamer: string; title?: string; url?: string }) {
  try {
    await context.api.notifyLive({
      ...payload,
      type: "ended"
    });
  } catch (error) {
    console.warn("[api] falha ao registrar fim de live:", error instanceof Error ? error.message : error);
    context.socket.emitLiveEnded(payload);
  }
}
