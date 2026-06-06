import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import type { AuthSessionUser } from "../types/session";
import { userHasAccessibleDevBot } from "./devBotService";
import type { DashboardAuth } from "./tokenService";

export const DEV_OWNER_USER_ID = "1426287249020158018";

export function isDevUser(user: AuthSessionUser | null | undefined) {
  return Boolean(user?.authorized || user?.discordId === DEV_OWNER_USER_ID || user?.accessLevel === "admin");
}

export async function canAccessDevPanel(user: AuthSessionUser | null | undefined) {
  if (!user) {
    return false;
  }

  if (isDevUser(user)) {
    return true;
  }

  return userHasAccessibleDevBot(user);
}

export function requireDevAccess(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

    void (async () => {
      if (!(await canAccessDevPanel(auth?.user))) {
        return res.status(403).json({
          message: "Aba Dev liberada somente para usuario autorizado, admin ou dono de bot."
        });
      }

      return next();
    })().catch(next);
  });
}
