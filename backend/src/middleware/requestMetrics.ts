import type { NextFunction, Request, Response } from "express";
import { recordHttpRequest } from "../services/monitoringService";

export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    recordHttpRequest({
      durationMs: Date.now() - startedAt,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode
    });
  });

  next();
}
