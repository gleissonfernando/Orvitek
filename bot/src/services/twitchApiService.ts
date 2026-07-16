import axios from "axios";
import { env } from "../config/env";

type TwitchToken = {
  accessToken: string;
  expiresAt: number;
};

export type TwitchStream = {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameName: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string;
  startedAt: string;
};

export type TwitchUser = {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
};

export type TwitchClip = {
  id: string;
  url: string;
  broadcasterId: string;
  broadcasterName: string;
  creatorName: string;
  title: string;
  thumbnailUrl: string | null;
  viewCount: number;
  createdAt: string;
};

let tokenCache: TwitchToken | null = null;

export async function getTwitchStream(channelName: string) {
  const streams = await getTwitchStreams([channelName]);
  return streams.get(channelName.toLowerCase()) ?? null;
}

export async function getTwitchStreams(input: string[] | { channelNames?: string[]; userIds?: string[] }) {
  const channelNames = Array.isArray(input) ? input : input.channelNames ?? [];
  const userIds = Array.isArray(input) ? [] : input.userIds ?? [];
  const uniqueChannelNames = [...new Set(
    channelNames
      .map((channelName) => channelName.trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 100);
  const uniqueUserIds = [...new Set(
    userIds
      .map((userId) => userId.trim())
      .filter(Boolean)
  )].slice(0, Math.max(0, 100 - uniqueChannelNames.length));

  if (!uniqueChannelNames.length && !uniqueUserIds.length) {
    return new Map<string, TwitchStream>();
  }

  const token = await getAppAccessToken();
  const params = new URLSearchParams();

  for (const channelName of uniqueChannelNames) {
    params.append("user_login", channelName);
  }

  for (const userId of uniqueUserIds) {
    params.append("user_id", userId);
  }

  const { data } = await axios.get<{ data: Array<Record<string, string | number>> }>("https://api.twitch.tv/helix/streams", {
    headers: {
      "Client-ID": env.TWITCH_CLIENT_ID.trim(),
      Authorization: `Bearer ${token}`
    },
    params,
    timeout: 10_000
  });

  const streams = new Map<string, TwitchStream>();

  for (const stream of data.data) {
    const parsed = {
      id: String(stream.id),
      userId: String(stream.user_id),
      userLogin: String(stream.user_login),
      userName: String(stream.user_name),
      gameName: String(stream.game_name || ""),
      title: String(stream.title || ""),
      viewerCount: Number(stream.viewer_count || 0),
      thumbnailUrl: String(stream.thumbnail_url || ""),
      startedAt: String(stream.started_at || new Date().toISOString())
    } satisfies TwitchStream;

    streams.set(parsed.userLogin.toLowerCase(), parsed);
    streams.set(parsed.userId, parsed);
  }

  return streams;
}

export async function getTwitchUser(channelName: string) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<{ data: Array<Record<string, string>> }>("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-ID": env.TWITCH_CLIENT_ID.trim(),
      Authorization: `Bearer ${token}`
    },
    params: {
      login: channelName
    },
    timeout: 10_000
  });
  const user = data.data[0];

  if (!user) {
    return null;
  }

  return {
    id: String(user.id),
    login: String(user.login),
    displayName: String(user.display_name || user.login),
    profileImageUrl: String(user.profile_image_url || "") || null
  } satisfies TwitchUser;
}

export async function getTwitchClips(input: {
  broadcasterId: string;
  endedAt?: string;
  first?: number;
  startedAt?: string;
}) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<{ data: Array<Record<string, string | number>> }>("https://api.twitch.tv/helix/clips", {
    headers: {
      "Client-ID": env.TWITCH_CLIENT_ID.trim(),
      Authorization: `Bearer ${token}`
    },
    params: {
      broadcaster_id: input.broadcasterId,
      first: Math.max(1, Math.min(input.first ?? 20, 100)),
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
      ...(input.endedAt ? { ended_at: input.endedAt } : {})
    },
    timeout: 10_000
  });

  return data.data.map((clip) => ({
    id: String(clip.id),
    url: String(clip.url),
    broadcasterId: String(clip.broadcaster_id),
    broadcasterName: String(clip.broadcaster_name || ""),
    creatorName: String(clip.creator_name || ""),
    title: String(clip.title || "Novo clipe"),
    thumbnailUrl: String(clip.thumbnail_url || "") || null,
    viewCount: Number(clip.view_count || 0),
    createdAt: String(clip.created_at || new Date().toISOString())
  } satisfies TwitchClip));
}

async function getAppAccessToken() {
  const clientId = env.TWITCH_CLIENT_ID.trim();
  const clientSecret = env.TWITCH_CLIENT_SECRET.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais da Twitch API não configuradas no bot.");
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  try {
    const { data } = await axios.post<{ access_token: string; expires_in: number }>(
      "https://id.twitch.tv/oauth2/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 10_000
      }
    );

    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000
    };

    return tokenCache.accessToken;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      throw new Error("Credenciais da Twitch inválidas. Confira TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env e reinicie o bot.");
    }

    throw error;
  }
}
