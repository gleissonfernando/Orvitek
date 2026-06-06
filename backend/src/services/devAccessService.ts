import type { NextFunction, Request, Response } from "express";
import { isDevOwnerUserId } from "../config/devOwner";
import { requireAuth } from "../middleware/auth";
import type { AuthSessionUser } from "../types/session";
import type { DashboardAuth } from "./tokenService";

export function isDevUser(user: AuthSessionUser | null | undefined) {
  return isDevOwnerUserId(user?.discordId);
}

export async function canAccessDevPanel(user: AuthSessionUser | null | undefined) {
  return isDevUser(user);
}

export function requireDevAccess(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

    void (async () => {
      if (!(await canAccessDevPanel(auth?.user))) {
        return res.status(403).json({
          message: "Aba Dev liberada somente para o dono do sistema."
        });
      }

      return next();
    })().catch(next);
  });
}
