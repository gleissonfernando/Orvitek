import type { NextFunction, Request, Response } from "express";
import { evaluateDashboardAccess } from "../services/accessControlService";
import type { DashboardAuth } from "../services/tokenService";

export async function requireDashboardAccessValidation(_req: Request, res: Response, next: NextFunction) {
  const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

  if (!auth) {
    return res.status(401).json({
      message: "Sessao nao autenticada."
    });
  }

  const validation = await evaluateDashboardAccess(auth.user);

  if (!validation.allowed) {
    return res.status(403).json({
      message: "Usuario sem permissao para acessar o painel.",
      validation
    });
  }

  res.locals.accessValidation = validation;
  return next();
}
