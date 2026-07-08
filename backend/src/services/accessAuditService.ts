import type { Request } from "express";
import { createDashboardAuditLog } from "./dashboardAuditService";

export type AccessAuditResult = "allowed" | "denied";

export async function recordAccessAttempt(req: Request, input: {
  action?: string;
  userId?: string | null;
  username?: string | null;
  dashboardSlug?: string | null;
  botId?: string | null;
  guildId?: string | null;
  result: AccessAuditResult;
  reason?: string | null;
}) {
  await createDashboardAuditLog({
    action: input.action ?? `access.${input.result}`,
    userId: input.userId,
    botId: input.botId,
    guildId: input.guildId,
    dashboardSlug: input.dashboardSlug,
    ip: req.ip,
    userAgent: req.get("user-agent") ?? null,
    metadata: {
      method: req.method,
      path: req.originalUrl,
      reason: input.reason ?? null,
      result: input.result,
      username: input.username ?? null
    }
  }).catch((error) => {
    console.warn("[access] nao foi possivel registrar auditoria:", error instanceof Error ? error.message : error);
  });
}
