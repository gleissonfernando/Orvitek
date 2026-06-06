import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import type { AuthSessionUser } from "../types/session";
import { userHasAccessibleDevBot } from "./devBotService";
import type { DashboardAuth } from "./tokenService";

export const DEV_OWNER_USER_ID = "1426287249020158018";

export function isDevUser(user: AuthSessionUser | null | undefined) {
  return Boolean(user?.authorized || user?.discordId === DEV_OWNER_USER_ID);
}

export function requireDevAccess(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

    void (async () => {
      if (!isDevUser(auth?.user) && !(auth?.user && await userHasAccessibleDevBot(auth.user))) {
        return res.status(403).json({
          message: "Aba Dev liberada somente para o usuario autorizado."
        });
      }

      return next();
    })().catch(next);
  });
}
