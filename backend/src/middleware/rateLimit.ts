import type { NextFunction, Request, Response } from "express";
import { getRedisClient } from "../database/redis";

type RateLimitPolicy = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type MemoryBucket = {
  count: number;
  resetAt: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();

const publicPolicy: RateLimitPolicy = {
  keyPrefix: "public",
  limit: 600,
  windowMs: 60_000
};

const authPolicy: RateLimitPolicy = {
  keyPrefix: "auth",
  limit: 30,
  windowMs: 60_000
};

const mutationPolicy: RateLimitPolicy = {
  keyPrefix: "mutation",
  limit: 120,
  windowMs: 60_000
};

const devPolicy: RateLimitPolicy = {
  keyPrefix: "dev",
  limit: 180,
  windowMs: 60_000
};

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (shouldSkipRateLimit(req)) {
    return next();
  }

  const policy = policyForRequest(req);
  const identity = rateLimitIdentity(req);
  const result = await consumeRateLimit(`${policy.keyPrefix}:${identity}`, policy);

  res.setHeader("X-RateLimit-Limit", String(policy.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.limit - result.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

  if (result.count > policy.limit) {
    return res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Muitas requisicoes em pouco tempo. Aguarde alguns segundos e tente novamente."
      }
    });
  }

  return next();
}

function shouldSkipRateLimit(req: Request) {
  return req.path.startsWith("/health")
    || req.path.startsWith("/_shardcloud/health")
    || req.path.startsWith("/api/health")
    || req.path.startsWith("/api/_shardcloud/health");
}

function policyForRequest(req: Request): RateLimitPolicy {
  const path = req.path;

  if (path.startsWith("/auth") || path.startsWith("/api/auth")) {
    return authPolicy;
  }

  if (path.startsWith("/api/dev")) {
    return devPolicy;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
    return mutationPolicy;
  }

  return publicPolicy;
}

function rateLimitIdentity(req: Request) {
  const user = req.session?.user?.discordId;
  const botId = typeof req.query.botId === "string" ? req.query.botId.trim() : "";
  const dashboardSlug = dashboardSlugFromPath(req.path);
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  return [user ? `user:${user}` : `ip:${ip}`, botId ? `bot:${botId}` : "", dashboardSlug ? `dash:${dashboardSlug}` : ""]
    .filter(Boolean)
    .join(":");
}

function dashboardSlugFromPath(path: string) {
  const match = path.match(/^\/api\/dashboard\/([a-z0-9]+(?:-[a-z0-9]+)*)/i)
    ?? path.match(/^\/dashboard\/([a-z0-9]+(?:-[a-z0-9]+)*)/i);

  return match?.[1] ?? "";
}

async function consumeRateLimit(key: string, policy: RateLimitPolicy) {
  const redis = getRedisClient();
  const now = Date.now();

  if (redis?.status === "ready") {
    try {
      const redisKey = `rate:${key}`;
      const count = await redis.incr(redisKey);

      if (count === 1) {
        await redis.pexpire(redisKey, policy.windowMs);
      }

      const ttl = await redis.pttl(redisKey);
      return {
        count,
        resetAt: now + Math.max(ttl, 0)
      };
    } catch (error) {
      console.warn("[rate-limit] Redis indisponivel, usando memoria:", error instanceof Error ? error.message : error);
    }
  }

  return consumeMemoryRateLimit(key, policy, now);
}

function consumeMemoryRateLimit(key: string, policy: RateLimitPolicy, now: number) {
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + policy.windowMs
    };
    memoryBuckets.set(key, next);
    cleanupMemoryBuckets(now);
    return next;
  }

  bucket.count += 1;
  return bucket;
}

function cleanupMemoryBuckets(now: number) {
  if (memoryBuckets.size < 10_000) {
    return;
  }

  for (const [key, bucket] of memoryBuckets.entries()) {
    if (bucket.resetAt <= now) {
      memoryBuckets.delete(key);
    }
  }
}
