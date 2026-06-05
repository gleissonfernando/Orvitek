import type { Request, Response } from "express";
import jwt, { TokenExpiredError, type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";

const ACCESS_COOKIE = "dashboard.access_token";
const REFRESH_COOKIE = "dashboard.refresh_token";

type DashboardTokenPayload = JwtPayload & {
  type: "access" | "refresh";
  user: AuthSessionUser;
  verified: boolean;
};

export type DashboardAuth = {
  user: AuthSessionUser;
  verified: boolean;
  tokenExpiresAt: string;
};

export function issueAuthCookies(res: Response, user: AuthSessionUser, verified: boolean) {
  const accessToken = signToken("access", user, verified, env.JWT_ACCESS_TTL_SECONDS);
  const refreshToken = signToken("refresh", user, verified, env.JWT_REFRESH_TTL_SECONDS);

  setAuthCookie(res, ACCESS_COOKIE, accessToken, env.JWT_ACCESS_TTL_SECONDS);
  setAuthCookie(res, REFRESH_COOKIE, refreshToken, env.JWT_REFRESH_TTL_SECONDS);

  return buildAuthFromToken(accessToken);
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function createAuthResponse(auth: DashboardAuth) {
  return {
    user: auth.user,
    guilds: auth.user.guilds,
    permissions: {
      canManageGuilds: auth.user.guilds.some((guild) => guild.isAdmin || guild.owner)
    },
    access: {
      authenticated: true,
      verified: auth.verified,
      verificationMode: env.DASHBOARD_VERIFICATION_MODE,
      tokenExpiresAt: auth.tokenExpiresAt
    }
  };
}

export function resolveAuthFromRequest(req: Request, res: Response) {
  const accessToken = readCookie(req, ACCESS_COOKIE);

  if (accessToken) {
    try {
      return buildAuthFromToken(accessToken);
    } catch (error) {
      if (!(error instanceof TokenExpiredError)) {
        return null;
      }
    }
  }

  return refreshAuthFromRequest(req, res);
}

export function refreshAuthFromRequest(req: Request, res: Response) {
  const refreshToken = readCookie(req, REFRESH_COOKIE);

  if (!refreshToken) {
    return null;
  }

  try {
    const payload = verifyToken(refreshToken, "refresh");
    return issueAuthCookies(res, payload.user, payload.verified);
  } catch {
    clearAuthCookies(res);
    return null;
  }
}

function signToken(type: "access" | "refresh", user: AuthSessionUser, verified: boolean, expiresIn: number) {
  return jwt.sign(
    {
      type,
      user,
      verified
    },
    env.JWT_SECRET,
    {
      expiresIn
    }
  );
}

function buildAuthFromToken(token: string): DashboardAuth {
  const payload = verifyToken(token, "access");

  return {
    user: payload.user,
    verified: payload.verified,
    tokenExpiresAt: new Date((payload.exp ?? 0) * 1000).toISOString()
  };
}

function verifyToken(token: string, expectedType: "access" | "refresh") {
  const payload = jwt.verify(token, env.JWT_SECRET) as DashboardTokenPayload;

  if (payload.type !== expectedType || !payload.user) {
    throw new Error("Token invalido.");
  }

  return payload;
}

function setAuthCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.cookie(name, value, {
    ...cookieOptions(),
    maxAge: maxAgeSeconds * 1000
  });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/"
  };
}

function readCookie(req: Request, name: string) {
  return typeof req.cookies?.[name] === "string" ? (req.cookies[name] as string) : null;
}
