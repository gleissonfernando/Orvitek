import type { Client } from "discord.js";
import { io, type Socket } from "socket.io-client";
import { env } from "../config/env";

export type SocialPanelUpdateEvent = {
  action: "publish" | "remove" | "update";
  botId?: string | null;
  guildId: string;
  panelId: string;
};

export type XMonitorUpdateEvent = {
  action: string;
  botId?: string | null;
  guildId: string;
  account?: {
    id: string;
  };
};

export type XMonitorPostEvent = {
  account: {
    id: string;
    botId: string | null;
    guildId: string;
    channelId: string;
    xUserId: string;
    username: string;
    displayName: string;
    avatar: string | null;
    active: boolean;
    lastSyncAt: string | null;
    lastPostId: string | null;
    lastPostAt: string | null;
    lastApiStatus: "idle" | "ok" | "error";
    lastApiError: string | null;
    totalPostsSent: number;
    createdAt: string;
    updatedAt: string;
  };
  botId?: string | null;
  guildId: string;
  post: {
    id: string;
    text: string;
    createdAt: string;
    url: string;
    mediaUrls: string[];
  };
};

export class BotSocketClient {
  private socket: Socket | null = null;
  private socialPanelUpdateHandler: ((payload: SocialPanelUpdateEvent) => void) | null = null;
  private xMonitorUpdateHandler: ((payload: XMonitorUpdateEvent) => void) | null = null;
  private xMonitorPostHandler: ((payload: XMonitorPostEvent) => void) | null = null;

  connect(client: Client) {
    if (!env.BACKEND_SOCKET_URL) {
      console.warn("[socket] BACKEND_SOCKET_URL nao configurado; conexao em tempo real desativada.");
      return;
    }

    if (!env.BOT_API_TOKEN) {
      console.warn("[socket] BOT_API_TOKEN nao configurado; eventos em tempo real do bot serao ignorados pelo backend.");
    }

    this.socket?.disconnect();
    this.socket = io(env.BACKEND_SOCKET_URL, {
      auth: {
        token: env.BOT_API_TOKEN,
        botId: env.DASHBOARD_BOT_ID || null,
        clientId: client.user?.id ?? null
      },
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 10000,
      transports: ["websocket", "polling"]
    });

    this.socket.on("connect", () => {
      console.log(`[socket] conectado ao backend em ${env.BACKEND_SOCKET_URL}`);
      this.emitStatus(client, true);
    });

    this.socket.on("connect_error", (error) => {
      console.warn("[socket] falha ao conectar no backend:", error.message);
    });

    this.socket.on("disconnect", (reason) => {
      console.warn(`[socket] desconectado do backend: ${reason}`);
    });

    this.socket.on("bot:shutdown", (payload: { botId?: string | null } = {}) => {
      if (payload.botId && env.DASHBOARD_BOT_ID && payload.botId !== env.DASHBOARD_BOT_ID) {
        return;
      }

      console.log("[socket] desligamento solicitado pelo painel DEV.");
      this.disconnect(client);
      client.destroy();
      setTimeout(() => process.exit(0), 100).unref();
    });

    if (this.socialPanelUpdateHandler) {
      this.socket.on("socials:update", this.socialPanelUpdateHandler);
    }

    if (this.xMonitorUpdateHandler) {
      this.socket.on("x-monitor:update", this.xMonitorUpdateHandler);
    }

    if (this.xMonitorPostHandler) {
      this.socket.on("x-monitor:post", this.xMonitorPostHandler);
    }
  }

  emitStatus(client: Client, online = true) {
    const users = client.guilds.cache.reduce((total, guild) => total + (guild.memberCount ?? 0), 0);
    const botGuilds = client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount ?? 0,
      channelCount: guild.channels.cache.size
    }));

    this.socket?.emit("bot:status", {
      botId: env.DASHBOARD_BOT_ID || null,
      botProfile: client.user
        ? {
            id: client.user.id,
            username: client.user.username,
            avatarUrl: client.user.displayAvatarURL({ size: 256 })
          }
        : undefined,
      online,
      latency: Math.max(0, Math.round(client.ws.ping)),
      guilds: client.guilds.cache.size,
      users,
      botGuilds
    });
  }

  emitLog(payload: { guildId: string; type: string; message: string; userId?: string | null; metadata?: unknown }) {
    this.socket?.emit("bot:log", { ...payload, botId: env.DASHBOARD_BOT_ID || null });
  }

  emitLiveStarted(payload: { guildId: string; streamer: string; title?: string; url?: string }) {
    this.socket?.emit("live:started", { ...payload, botId: env.DASHBOARD_BOT_ID || null });
  }

  emitLiveEnded(payload: { guildId: string; streamer: string; title?: string; url?: string }) {
    this.socket?.emit("live:ended", { ...payload, botId: env.DASHBOARD_BOT_ID || null });
  }

  onSocialPanelUpdate(handler: (payload: SocialPanelUpdateEvent) => void) {
    this.socialPanelUpdateHandler = handler;
    this.socket?.off("socials:update");
    this.socket?.on("socials:update", handler);
  }

  onXMonitorUpdate(handler: (payload: XMonitorUpdateEvent) => void) {
    this.xMonitorUpdateHandler = handler;
    this.socket?.off("x-monitor:update");
    this.socket?.on("x-monitor:update", handler);
  }

  onXMonitorPost(handler: (payload: XMonitorPostEvent) => void) {
    this.xMonitorPostHandler = handler;
    this.socket?.off("x-monitor:post");
    this.socket?.on("x-monitor:post", handler);
  }

  disconnect(client: Client) {
    this.emitStatus(client, false);
    this.socket?.disconnect();
  }
}
