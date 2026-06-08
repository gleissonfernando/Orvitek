import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { createLiveEvent } from "../services/liveService";
import { createLog } from "../services/logService";
import { getBotStatus, updateBotStatus } from "../services/statsService";
import { findDevBotIdByClientId, syncDevBotGuilds, syncDevBotProfile, updateDevBotRuntimeStatus } from "../services/devBotService";
import { devBotRealtimeRoom, setRealtimeServer } from "./events";

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL || true,
      credentials: true
    }
  });

  setRealtimeServer(io);

  io.on("connection", async (socket) => {
    const token = socket.handshake.auth?.token;
    const configuredBotId = typeof socket.handshake.auth?.botId === "string" && socket.handshake.auth.botId.trim()
      ? socket.handshake.auth.botId.trim()
      : null;
    const clientId = typeof socket.handshake.auth?.clientId === "string" && socket.handshake.auth.clientId.trim()
      ? socket.handshake.auth.clientId.trim()
      : null;
    const isBot = Boolean(env.BOT_API_TOKEN && token === env.BOT_API_TOKEN);
    const botId = configuredBotId
      ?? (isBot && clientId ? await findDevBotIdByClientId(clientId).catch(() => null) : null);

    socket.data.isBot = isBot;
    socket.data.botId = botId;
    if (botId) {
      await socket.join(devBotRealtimeRoom(botId));
    }
    socket.emit("bot:status", getBotStatus());

    socket.on("disconnect", () => {
      if (!socket.data.isBot) {
        return;
      }

      if (socket.data.botId) {
        void updateDevBotRuntimeStatus(socket.data.botId, "offline", "Bot desconectado do backend.");
      }

      io.emit("bot:status", updateBotStatus({ online: false }));
    });

    socket.on("bot:status", (payload: Parameters<typeof updateBotStatus>[0]) => {
      if (!socket.data.isBot) {
        return;
      }

      const statusBotId = socket.data.botId
        ?? (typeof payload.botId === "string" && payload.botId.trim() ? payload.botId.trim() : null);

      if (statusBotId) {
        void syncDevBotProfile(statusBotId, payload.botProfile);

        if (payload.botGuilds) {
          void syncDevBotGuilds(
            statusBotId,
            payload.botGuilds.map((guild) => ({
              id: guild.id,
              name: guild.name
            }))
          );
        }

        void updateDevBotRuntimeStatus(
          statusBotId,
          payload.online === false ? "offline" : "online",
          payload.online === false ? "Bot offline." : "Bot conectado ao Discord."
        );
      }

      io.emit("bot:status", updateBotStatus(payload));
    });

    socket.on("bot:log", async (payload: { botId?: string | null; guildId: string; type: string; message: string; userId?: string; metadata?: unknown }) => {
      if (!socket.data.isBot) {
        return;
      }

      const log = await createLog({
        ...payload,
        botId: socket.data.botId ?? payload.botId ?? null
      });
      io.emit("logs:new", log);
    });

    socket.on("live:started", async (payload: { botId?: string | null; guildId: string; streamer: string; title?: string; url?: string }) => {
      if (!socket.data.isBot) {
        return;
      }

      const eventBotId = socket.data.botId ?? payload.botId ?? null;
      const event = createLiveEvent({
        ...payload,
        botId: eventBotId,
        type: "started"
      });
      const log = await createLog({
        botId: eventBotId,
        guildId: payload.guildId,
        type: "live:started",
        message: `${payload.streamer} iniciou uma live.`,
        metadata: {
          ...payload,
          type: "started"
        }
      });

      io.emit("logs:new", log);
      io.emit("live:started", event);
    });

    socket.on("live:ended", async (payload: { botId?: string | null; guildId: string; streamer: string; title?: string; url?: string }) => {
      if (!socket.data.isBot) {
        return;
      }

      const eventBotId = socket.data.botId ?? payload.botId ?? null;
      const event = createLiveEvent({
        ...payload,
        botId: eventBotId,
        type: "ended"
      });
      const log = await createLog({
        botId: eventBotId,
        guildId: payload.guildId,
        type: "live:ended",
        message: `${payload.streamer} encerrou uma live.`,
        metadata: {
          ...payload,
          type: "ended"
        }
      });

      io.emit("logs:new", log);
      io.emit("live:ended", event);
    });
  });

  return io;
}
