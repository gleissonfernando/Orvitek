import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { env } from "../config/env";
import { dispatchXWebhookPost, type XWebhookPostInput } from "../services/xMonitorService";

export const xWebhookRouter = Router();

xWebhookRouter.get("/", (req, res) => {
  const crcToken = typeof req.query.crc_token === "string" ? req.query.crc_token : "";
  const consumerSecret = env.X_CONSUMER_SECRET.trim();

  if (!crcToken) {
    return res.status(400).json({
      message: "crc_token obrigatorio."
    });
  }

  if (!consumerSecret) {
    return res.status(503).json({
      message: "X_CONSUMER_SECRET nao configurado no backend."
    });
  }

  const responseToken = createHmac("sha256", consumerSecret)
    .update(crcToken)
    .digest("base64");

  return res.json({
    response_token: `sha256=${responseToken}`
  });
});

xWebhookRouter.post("/", (req, res) => {
  if (!isValidWebhookSignature(req)) {
    return res.status(401).json({
      message: "Assinatura do webhook do X invalida."
    });
  }

  const posts = extractWebhookPosts(req.body);

  void Promise.all(posts.map((post) => dispatchXWebhookPost(post)))
    .then((results) => {
      const emitted = results.reduce((total, result) => total + result.emitted, 0);
      console.log(`[x-webhook] ${posts.length} postagem(ns) recebida(s), ${emitted} alerta(s) emitido(s).`);
    })
    .catch((error) => {
      console.warn("[x-webhook] falha ao processar evento:", error instanceof Error ? error.message : error);
    });

  return res.status(200).json({
    ok: true,
    received: posts.length
  });
});

function isValidWebhookSignature(req: Request) {
  const consumerSecret = env.X_CONSUMER_SECRET.trim();
  const signature = req.get("x-twitter-webhooks-signature");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!consumerSecret || !signature || !rawBody) {
    return env.NODE_ENV !== "production";
  }

  const expected = `sha256=${createHmac("sha256", consumerSecret).update(rawBody).digest("base64")}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
}

function extractWebhookPosts(body: unknown): XWebhookPostInput[] {
  if (!body || typeof body !== "object") {
    return [];
  }

  return [
    ...extractFilteredStreamPosts(body as Record<string, unknown>),
    ...extractAccountActivityPosts(body as Record<string, unknown>)
  ];
}

function extractFilteredStreamPosts(body: Record<string, unknown>): XWebhookPostInput[] {
  const data = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
  const includes = isRecord(body.includes) ? body.includes : {};
  const users = Array.isArray(includes.users) ? includes.users.filter(isRecord) : [];
  const media = Array.isArray(includes.media) ? includes.media.filter(isRecord) : [];
  const ruleTags = extractXMonitorRuleTags(body);

  return data.filter(isRecord).map((tweet) => {
    const authorId = readString(tweet.author_id);
    const user = users.find((item) => readString(item.id) === authorId);
    const username = (user ? readString(user.username) : undefined) ?? ruleTags.usernames[0];
    const mediaKeys = isRecord(tweet.attachments) && Array.isArray(tweet.attachments.media_keys)
      ? tweet.attachments.media_keys.map((key) => String(key))
      : [];
    const mediaUrls = mediaKeys
      .map((key) => media.find((item) => readString(item.media_key) === key))
      .map((item) => readString(item?.url) ?? readString(item?.preview_image_url))
      .filter((url): url is string => Boolean(url));

    return {
      accountIds: ruleTags.accountIds,
      avatar: readString(user?.profile_image_url) ?? null,
      createdAt: normalizeDate(readString(tweet.created_at)),
      displayName: readString(user?.name) ?? username ?? null,
      id: readRequiredString(tweet.id),
      mediaUrls,
      text: readString(tweet.text) ?? "",
      url: username ? `https://x.com/${username}/status/${readRequiredString(tweet.id)}` : undefined,
      username,
      xUserId: authorId
    };
  }).filter((post) => Boolean(post.id));
}

function extractXMonitorRuleTags(body: Record<string, unknown>) {
  const tags = (Array.isArray(body.matching_rules) ? body.matching_rules : [])
    .filter(isRecord)
    .map((rule) => readString(rule.tag))
    .filter((tag): tag is string => Boolean(tag?.startsWith("x-monitor:")))
    .map((tag) => tag.replace(/^x-monitor:/, ""));

  return {
    accountIds: tags.filter((tag) => /^[0-9a-f-]{24,64}$/i.test(tag)),
    usernames: tags.filter((tag) => /^[A-Za-z0-9_]{1,15}$/.test(tag))
  };
}

function extractAccountActivityPosts(body: Record<string, unknown>): XWebhookPostInput[] {
  const events = Array.isArray(body.tweet_create_events) ? body.tweet_create_events.filter(isRecord) : [];

  return events.map((tweet) => {
    const user = isRecord(tweet.user) ? tweet.user : {};
    const username = readString(user.screen_name) ?? readString(user.username);
    const id = readRequiredString(tweet.id_str ?? tweet.id);

    return {
      avatar: readString(user.profile_image_url_https) ?? readString(user.profile_image_url) ?? null,
      createdAt: normalizeDate(readString(tweet.created_at)),
      displayName: readString(user.name) ?? username ?? null,
      id,
      mediaUrls: extractAccountActivityMedia(tweet),
      text: readString(tweet.full_text) ?? readString(tweet.text) ?? "",
      url: username ? `https://x.com/${username}/status/${id}` : undefined,
      username,
      xUserId: readString(user.id_str) ?? readString(user.id)
    };
  }).filter((post) => Boolean(post.id));
}

function extractAccountActivityMedia(tweet: Record<string, unknown>) {
  const extendedEntities = isRecord(tweet.extended_entities) ? tweet.extended_entities : {};
  const entities = isRecord(tweet.entities) ? tweet.entities : {};
  const media = Array.isArray(extendedEntities.media)
    ? extendedEntities.media
    : Array.isArray(entities.media)
      ? entities.media
      : [];

  return media
    .filter(isRecord)
    .map((item) => readString(item.media_url_https) ?? readString(item.media_url))
    .filter((url): url is string => Boolean(url));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRequiredString(value: unknown) {
  return readString(value) ?? "";
}

function normalizeDate(value?: string) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
