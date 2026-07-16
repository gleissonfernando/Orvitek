import type { NextFunction, Request, Response } from "express";
import { isDashboardDevUserId } from "../config/devOwner";
import { requireAuth } from "../middleware/auth";
import type { AuthSessionUser } from "../types/session";
import { recordAccessAttempt } from "./accessAuditService";
import { canAccessDevDashboard } from "./devPermissionService";
import type { DashboardAuth } from "./tokenService";

export function isDevUser(user: AuthSessionUser | null | undefined) {
  return isDashboardDevUserId(user?.discordId);
}

export async function canAccessDevPanel(user: AuthSessionUser | null | undefined) {
  return canAccessDevDashboard(user?.discordId);
}

export function requireDevAccess(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

    void (async () => {
      if (!(await canAccessDevPanel(auth?.user))) {
        await recordAccessAttempt(req, {
          action: "dev.api.denied",
          userId: auth?.user.discordId ?? null,
          username: auth?.user.username ?? null,
          result: "denied",
          reason: "Usuário sem permissão DEV."
        });
        return res.status(403).json({
          message: "Acesso negado."
        });
      }

      await recordAccessAttempt(req, {
        action: "dev.api.allowed",
        userId: auth?.user.discordId ?? null,
        username: auth?.user.username ?? null,
        result: "allowed",
        reason: "Usuário DEV autenticado."
      });
      return next();
    })().catch(next);
  });
}
