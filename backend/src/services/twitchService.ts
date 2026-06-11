import axios from "axios";
import { env } from "../config/env";

type TwitchToken = {
  accessToken: string;
  expiresAt: number;
};

export type TwitchUserDto = {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
};

export type TwitchStreamDto = {
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

export type TwitchClipDto = {
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

export type TwitchSubscriberDto = {
  id: string;
  login: string;
  displayName: string;
};

let tokenCache: TwitchToken | null = null;

export function normalizeTwitchChannel(input: string): string {
  let value = input.trim();

  value = value.replace("https://www.twitch.tv/", "");
  value = value.replace("https://twitch.tv/", "");
  value = value.replace("http://www.twitch.tv/", "");
  value = value.replace("http://twitch.tv/", "");
  value = value.replace("www.twitch.tv/", "");
  value = value.replace("twitch.tv/", "");

  value = value.split("?")[0] ?? value;
  value = value.split("/")[0] ?? value;

  return value.toLowerCase();
}

type TwitchUserResponse = {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
  }>;
};

type TwitchClipsResponse = {
  data: Array<{
    id: string;
    url: string;
    broadcaster_id: string;
    broadcaster_name: string;
    creator_name: string;
    title: string;
    thumbnail_url: string;
    view_count: number;
    created_at: string;
  }>;
};

type TwitchSubscriptionsResponse = {
  data: Array<{
    user_id: string;
    user_login: string;
    user_name: string;
  }>;
  pagination?: {
    cursor?: string;
  };
};

export async function getTwitchUser(channelName: string) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<TwitchUserResponse>("https://api.twitch.tv/helix/users", {
    headers: twitchHeaders(token),
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
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url || null
  } satisfies TwitchUserDto;
}

export async function getTwitchStream(channelName: string) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<{ data: Array<Record<string, string | number>> }>("https://api.twitch.tv/helix/streams", {
    headers: twitchHeaders(token),
    params: {
      user_login: channelName
    },
    timeout: 10_000
  });

  const stream = data.data[0];

  if (!stream) {
    return null;
  }

  return {
    id: String(stream.id),
    userId: String(stream.user_id),
    userLogin: String(stream.user_login),
    userName: String(stream.user_name),
    gameName: String(stream.game_name || ""),
    title: String(stream.title || ""),
    viewerCount: Number(stream.viewer_count || 0),
    thumbnailUrl: String(stream.thumbnail_url || ""),
    startedAt: String(stream.started_at || new Date().toISOString())
  } satisfies TwitchStreamDto;
}

export async function getTwitchClips(input: {
  broadcasterId: string;
  endedAt?: string;
  first?: number;
  startedAt?: string;
}) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<TwitchClipsResponse>("https://api.twitch.tv/helix/clips", {
    headers: twitchHeaders(token),
    params: {
      broadcaster_id: input.broadcasterId,
      first: Math.max(1, Math.min(input.first ?? 20, 100)),
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
      ...(input.endedAt ? { ended_at: input.endedAt } : {})
    },
    timeout: 10_000
  });

  return data.data.map((clip) => ({
    id: clip.id,
    url: clip.url,
    broadcasterId: clip.broadcaster_id,
    broadcasterName: clip.broadcaster_name,
    creatorName: clip.creator_name,
    title: clip.title,
    thumbnailUrl: clip.thumbnail_url || null,
    viewCount: Number(clip.view_count || 0),
    createdAt: clip.created_at
  } satisfies TwitchClipDto));
}

export async function getTwitchSubscribers(input: {
  accessToken?: string | null;
  broadcasterId: string;
  max?: number;
}) {
  const token = input.accessToken?.trim() || env.TWITCH_BROADCASTER_ACCESS_TOKEN.trim();

  if (!env.TWITCH_CLIENT_ID) {
    throw new Error("TWITCH_CLIENT_ID nao configurado.");
  }

  if (!token) {
    throw new Error("TWITCH_BROADCASTER_ACCESS_TOKEN nao configurado para validar subs da live.");
  }

  const max = Math.max(1, Math.min(input.max ?? 1000, 5000));
  const subscribers = new Map<string, TwitchSubscriberDto>();
  let after: string | undefined;

  do {
    const { data } = await axios.get<TwitchSubscriptionsResponse>("https://api.twitch.tv/helix/subscriptions", {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      },
      params: {
        broadcaster_id: input.broadcasterId,
        first: Math.min(100, max - subscribers.size),
        ...(after ? { after } : {})
      },
      timeout: 10_000
    });

    for (const subscriber of data.data) {
      subscribers.set(subscriber.user_id, {
        id: subscriber.user_id,
        login: subscriber.user_login,
        displayName: subscriber.user_name || subscriber.user_login
      });

      if (subscribers.size >= max) {
        break;
      }
    }

    after = data.pagination?.cursor;
  } while (after && subscribers.size < max);

  return [...subscribers.values()];
}

async function getAppAccessToken() {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error("Credenciais da Twitch API nao configuradas.");
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    "https://id.twitch.tv/oauth2/token",
    new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
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
}

function twitchHeaders(accessToken: string) {
  return {
    "Client-ID": env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${accessToken}`
  };
}
