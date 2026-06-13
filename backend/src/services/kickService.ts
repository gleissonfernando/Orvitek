import axios, { type AxiosRequestConfig } from "axios";
import { env } from "../config/env";

const KICK_API_URL = "https://api.kick.com/public/v1";
const KICK_OAUTH_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_BATCH_SIZE = 50;
const KICK_API_MAX_ATTEMPTS = 3;

type KickToken = {
  accessToken: string;
  expiresAt: number;
};

export type KickApiCredentials = {
  clientId: string;
  clientSecret: string;
};

export type KickChannelDto = {
  broadcasterUserId: string;
  channelId: string | null;
  slug: string;
  displayName: string;
  banner: string | null;
  avatar: string | null;
  followers: number;
  verified: boolean;
  categoryName: string | null;
  title: string | null;
  isLive: boolean;
  viewerCount: number;
  thumbnailUrl: string | null;
  startedAt: string | null;
};

export type KickStreamDto = {
  id: string;
  broadcasterUserId: string;
  channelId: string | null;
  slug: string;
  displayName: string;
  categoryName: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string | null;
  startedAt: string;
  avatar: string | null;
  url: string;
};

export type KickOAuthToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
};

export type KickConnectedUser = {
  accessToken: string;
  avatar: string | null;
  displayName: string;
  email: string | null;
  expiresAt: Date | null;
  refreshToken: string | null;
  scopes: string[];
  userId: string;
  username: string;
};

type KickChannelResponse = {
  data?: Array<{
    active_subscribers_count?: number | null;
    banner_picture?: string | null;
    broadcaster_user_id?: number | string | null;
    category?: {
      id?: number | string | null;
      name?: string | null;
      thumbnail?: string | null;
    } | null;
    channel_id?: number | string | null;
    followers_count?: number | null;
    profile_picture?: string | null;
    slug?: string | null;
    stream?: {
      is_live?: boolean | null;
      start_time?: string | null;
      thumbnail?: string | null;
      viewer_count?: number | null;
    } | null;
    stream_title?: string | null;
    verified?: boolean | null;
  }>;
  message?: string;
};

type KickLivestreamsResponse = {
  data?: Array<{
    broadcaster_user_id?: number | string | null;
    category?: {
      id?: number | string | null;
      name?: string | null;
      thumbnail?: string | null;
    } | null;
    channel_id?: number | string | null;
    profile_picture?: string | null;
    slug?: string | null;
    started_at?: string | null;
    stream_title?: string | null;
    thumbnail?: string | null;
    viewer_count?: number | null;
  }>;
  message?: string;
};

type KickTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type KickUsersResponse = {
  data?: Array<{
    email?: string | null;
    name?: string | null;
    profile_picture?: string | null;
    user_id?: number | string | null;
  }>;
  message?: string;
};

const tokenCache = new Map<string, KickToken>();

export function normalizeKickChannel(input: string) {
  let value = input.trim();

  value = value.replace(/^https?:\/\/(www\.)?kick\.com\//i, "");
  value = value.replace(/^(www\.)?kick\.com\//i, "");
  value = value.replace(/^@+/, "");
  value = value.split("?")[0] ?? value;
  value = value.split("#")[0] ?? value;
  value = value.split("/")[0] ?? value;

  return value.toLowerCase();
}

export async function validateKickApiCredentials(input?: {
  clientId?: string | null;
  clientSecret?: string | null;
}) {
  const token = await requestKickAppAccessToken({
    clientId: input?.clientId?.trim() || env.KICK_CLIENT_ID,
    clientSecret: input?.clientSecret?.trim() || env.KICK_CLIENT_SECRET || env.KICK_API_KEY
  });

  return {
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    ok: true
  };
}

export function kickApiConfigured() {
  return Boolean(env.KICK_CLIENT_ID && (env.KICK_CLIENT_SECRET || env.KICK_API_KEY));
}

export async function getKickChannel(channelName: string, credentials?: KickApiCredentials | null) {
  const data = await kickApiGet<KickChannelResponse>("/channels", {
    credentials,
    operation: "channels",
    params: {
      slug: channelName
    }
  });

  const channel = data.data?.[0];

  if (!channel || !channel.slug || !channel.broadcaster_user_id) {
    return null;
  }

  return normalizeKickChannelResponse(channel);
}

export async function getKickLivestreamsByUserIds(userIds: string[], credentials?: KickApiCredentials | null) {
  const uniqueUserIds = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
  const streams = new Map<string, KickStreamDto>();

  if (!uniqueUserIds.length) {
    return streams;
  }

  for (let index = 0; index < uniqueUserIds.length; index += KICK_BATCH_SIZE) {
    const params = new URLSearchParams();
    params.set("limit", String(KICK_BATCH_SIZE));

    for (const userId of uniqueUserIds.slice(index, index + KICK_BATCH_SIZE)) {
      params.append("broadcaster_user_id", userId);
    }

    const data = await kickApiGet<KickLivestreamsResponse>("/livestreams", {
      credentials,
      operation: "livestreams",
      params
    });

    for (const stream of data.data ?? []) {
      const parsed = normalizeKickStreamResponse(stream);

      if (parsed) {
        streams.set(parsed.broadcasterUserId, parsed);
      }
    }
  }

  return streams;
}

export async function getKickLivestreamByUserId(userId: string, credentials?: KickApiCredentials | null) {
  const streams = await getKickLivestreamsByUserIds([userId], credentials);
  return streams.get(userId) ?? null;
}

export function kickGiveawayScopes() {
  return ["user:read", "channel:read", "events:subscribe"];
}

export function buildKickOAuthUrl(input: {
  codeChallenge: string;
  redirectUri: string;
  scopes?: string[];
  state: string;
}) {
  if (!env.KICK_CLIENT_ID) {
    throw new Error("KICK_CLIENT_ID nao configurado.");
  }

  const url = new URL("https://id.kick.com/oauth/authorize");
  url.searchParams.set("client_id", env.KICK_CLIENT_ID);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? kickGiveawayScopes()).join(" "));
  url.searchParams.set("state", input.state);

  return url.toString();
}

export async function exchangeKickOAuthCode(code: string, redirectUri: string, codeVerifier: string): Promise<KickOAuthToken> {
  const { data } = await axios.post<KickTokenResponse>(
    KICK_OAUTH_TOKEN_URL,
    new URLSearchParams({
      client_id: env.KICK_CLIENT_ID,
      client_secret: kickClientSecret(),
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 10_000
    }
  );

  return normalizeKickOAuthToken(data);
}

export async function refreshKickOAuthToken(refreshToken: string): Promise<KickOAuthToken> {
  try {
    console.info("[kick:oauth] renovando token de usuario.");
    const { data } = await axios.post<KickTokenResponse>(
      KICK_OAUTH_TOKEN_URL,
      new URLSearchParams({
        client_id: env.KICK_CLIENT_ID,
        client_secret: kickClientSecret(),
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 10_000
      }
    );

    console.info("[kick:oauth] token de usuario renovado.");
    return normalizeKickOAuthToken(data);
  } catch (error) {
    throw normalizeKickApiError(error, "refresh_token");
  }
}

export async function getKickAuthenticatedUser(token: KickOAuthToken): Promise<KickConnectedUser> {
  const { data } = await axios.get<KickUsersResponse>(`${KICK_API_URL}/users`, {
    headers: kickHeaders(token.accessToken),
    timeout: 10_000
  });
  const user = data.data?.[0];

  if (!user?.user_id) {
    throw new Error("Usuario Kick nao encontrado.");
  }

  const username = String(user.name || user.user_id).trim();

  return {
    accessToken: token.accessToken,
    avatar: user.profile_picture?.trim() || null,
    displayName: username,
    email: user.email?.trim() || null,
    expiresAt: token.expiresIn > 0 ? new Date(Date.now() + token.expiresIn * 1000) : null,
    refreshToken: token.refreshToken,
    scopes: token.scopes,
    userId: String(user.user_id),
    username
  };
}

async function getKickAppAccessToken(credentials?: KickApiCredentials | null) {
  const { clientId, clientSecret } = resolveKickAppCredentialValues(credentials);
  const cacheKey = clientId;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais da Kick API nao configuradas.");
  }

  const cachedToken = tokenCache.get(cacheKey);

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const token = await requestKickAppAccessToken({
    clientId,
    clientSecret
  });

  tokenCache.set(cacheKey, {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000
  });

  return token.accessToken;
}

async function kickApiGet<T>(path: string, input: {
  credentials?: KickApiCredentials | null;
  operation: string;
  params?: AxiosRequestConfig["params"];
}) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= KICK_API_MAX_ATTEMPTS; attempt += 1) {
    const token = await getKickAppAccessToken(input.credentials);

    try {
      const { data } = await axios.get<T>(`${KICK_API_URL}${path}`, {
        headers: kickHeaders(token),
        params: input.params,
        timeout: 10_000
      });

      if (attempt > 1) {
        console.info(`[kick:api] ${input.operation} recuperou apos retry ${attempt}.`);
      }

      return data;
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status ?? null : null;
      const retryAfter = axios.isAxiosError(error) ? Number(error.response?.headers?.["retry-after"] ?? 0) : 0;

      console.warn(`[kick:api] falha em ${input.operation} tentativa ${attempt}/${KICK_API_MAX_ATTEMPTS}:`, {
        status,
        message: error instanceof Error ? error.message : String(error)
      });

      if (status === 401) {
        clearKickAppToken(input.credentials);
      }

      if (attempt >= KICK_API_MAX_ATTEMPTS || !shouldRetryKickStatus(status)) {
        break;
      }

      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * attempt);
    }
  }

  throw normalizeKickApiError(lastError, input.operation);
}

async function requestKickAppAccessToken(input: {
  clientId: string;
  clientSecret: string;
}) {
  if (!input.clientId || !input.clientSecret) {
    throw new Error("Credenciais da Kick API nao configuradas.");
  }

  try {
    console.info("[kick:oauth] solicitando app access token.");
    const { data } = await axios.post<KickTokenResponse>(
      KICK_OAUTH_TOKEN_URL,
      new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "client_credentials"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 10_000
      }
    );

    console.info("[kick:oauth] app access token recebido.");
    return {
      accessToken: data.access_token,
      expiresIn: Number(data.expires_in || 3600)
    };
  } catch (error) {
    throw normalizeKickApiError(error, "client_credentials");
  }
}

function resolveKickAppCredentialValues(credentials?: KickApiCredentials | null) {
  return {
    clientId: credentials?.clientId?.trim() || env.KICK_CLIENT_ID,
    clientSecret: credentials?.clientSecret?.trim() || env.KICK_CLIENT_SECRET || env.KICK_API_KEY
  };
}

function clearKickAppToken(credentials?: KickApiCredentials | null) {
  const { clientId } = resolveKickAppCredentialValues(credentials);

  if (clientId) {
    tokenCache.delete(clientId);
  }
}

function shouldRetryKickStatus(status: number | null) {
  return status === 401 || status === 429 || status === null || status >= 500;
}

function normalizeKickApiError(error: unknown, operation: string) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error(`Kick API falhou em ${operation}.`);
  }

  const status = error.response?.status ?? null;

  if (status === 401) {
    return new Error("Kick API retornou 401: token invalido ou expirado. Reconecte a conta Kick se o erro continuar.");
  }

  if (status === 403) {
    return new Error("Kick API retornou 403: permissao ou escopo insuficiente para esta operacao.");
  }

  if (status === 429) {
    return new Error("Kick API retornou 429: rate limit detectado. Tente novamente em instantes.");
  }

  const responseMessage = typeof error.response?.data === "object" && error.response?.data && "message" in error.response.data
    ? String((error.response.data as { message?: unknown }).message)
    : null;

  return new Error(responseMessage || `Kick API falhou em ${operation}${status ? ` (HTTP ${status})` : ""}.`);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeKickChannelResponse(channel: NonNullable<KickChannelResponse["data"]>[number]): KickChannelDto {
  const slug = String(channel.slug ?? "").toLowerCase();
  const stream = channel.stream ?? null;

  return {
    broadcasterUserId: String(channel.broadcaster_user_id),
    channelId: channel.channel_id === undefined || channel.channel_id === null ? null : String(channel.channel_id),
    slug,
    displayName: displayNameFromSlug(slug),
    banner: channel.banner_picture?.trim() || null,
    avatar: channel.profile_picture?.trim() || null,
    followers: Number(channel.followers_count ?? 0),
    verified: Boolean(channel.verified),
    categoryName: channel.category?.name?.trim() || null,
    title: channel.stream_title?.trim() || null,
    isLive: Boolean(stream?.is_live),
    viewerCount: Number(stream?.viewer_count ?? 0),
    thumbnailUrl: stream?.thumbnail?.trim() || null,
    startedAt: stream?.start_time?.trim() || null
  };
}

function normalizeKickStreamResponse(stream: NonNullable<KickLivestreamsResponse["data"]>[number]) {
  if (!stream.broadcaster_user_id || !stream.slug) {
    return null;
  }

  const broadcasterUserId = String(stream.broadcaster_user_id);
  const slug = String(stream.slug).toLowerCase();
  const startedAt = stream.started_at?.trim() || new Date().toISOString();

  return {
    id: `${broadcasterUserId}:${startedAt}`,
    broadcasterUserId,
    channelId: stream.channel_id === undefined || stream.channel_id === null ? null : String(stream.channel_id),
    slug,
    displayName: displayNameFromSlug(slug),
    categoryName: stream.category?.name?.trim() || "Sem categoria",
    title: stream.stream_title?.trim() || "Live ao vivo",
    viewerCount: Number(stream.viewer_count ?? 0),
    thumbnailUrl: stream.thumbnail?.trim() || null,
    startedAt,
    avatar: stream.profile_picture?.trim() || null,
    url: `https://kick.com/${slug}`
  } satisfies KickStreamDto;
}

function kickHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
}

function displayNameFromSlug(slug: string) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || slug;
}

function normalizeKickOAuthToken(data: KickTokenResponse): KickOAuthToken {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: Number(data.expires_in || 0),
    scopes: typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : []
  };
}

function kickClientSecret() {
  const secret = env.KICK_CLIENT_SECRET || env.KICK_API_KEY;

  if (!env.KICK_CLIENT_ID || !secret) {
    throw new Error("Credenciais OAuth da Kick nao configuradas.");
  }

  return secret;
}
