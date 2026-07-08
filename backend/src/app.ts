import "./types/session";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { maintenanceMiddleware } from "./middleware/maintenance";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { requestMetricsMiddleware } from "./middleware/requestMetrics";
import { sessionMiddleware } from "./middleware/session";
import { apiRouter } from "./routes";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { kickWebhookPublicRouter } from "./routes/kickNotifications";
import { recordAccessAttempt } from "./services/accessAuditService";
import { canAccessDevPanel } from "./services/devAccessService";
import { resolveAuthFromRequest } from "./services/tokenService";

export const app = express();
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");
const uploadsPath = path.resolve(__dirname, "../uploads");
const corsOrigin = env.FRONTEND_URL || true;

ensureFrontendBuild();

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net",
          "https://images-ext-1.discordapp.net",
          "https://images-ext-2.discordapp.net",
          "https://static-cdn.jtvnw.net",
          "https://kick.com",
          "https://files.kick.com",
          "https://img.kick.com",
          "https://cdn.kick.com"
        ]
      }
    },
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    exposedHeaders: ["Content-Disposition", "Content-Length", "X-Emoji-Count", "X-Emoji-Failed", "X-Emoji-Total"]
  })
);
app.use(cookieParser());
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
  skip: (req) => req.path.startsWith("/health")
}));
app.use(requestMetricsMiddleware);
app.use(rateLimitMiddleware);
app.use("/uploads", express.static(uploadsPath));

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use(maintenanceMiddleware);
app.use("/webhooks", kickWebhookPublicRouter);
app.use("/api", apiRouter);

if (fs.existsSync(frontendIndexPath)) {
  app.use(express.static(frontendDistPath));
  app.get(["/dev", "/dev/*"], async (req, res, next) => {
    try {
      const auth = resolveAuthFromRequest(req, res);

      if (!auth?.verified || !(await canAccessDevPanel(auth.user))) {
        await recordAccessAttempt(req, {
          action: "dev.access.denied",
          userId: auth?.user.discordId ?? null,
          username: auth?.user.username ?? null,
          result: "denied",
          reason: auth ? "Usuario autenticado sem permissao DEV." : "Sessao nao autenticada."
        });

        return res.status(403).send("Acesso negado.");
      }

      await recordAccessAttempt(req, {
        action: "dev.access.allowed",
        userId: auth.user.discordId,
        username: auth.user.username,
        result: "allowed",
        reason: "Usuario DEV autenticado."
      });

      return res.sendFile(frontendIndexPath);
    } catch (error) {
      return next(error);
    }
  });
  app.get("*", (_req, res) => {
    res.sendFile(frontendIndexPath);
  });
} else {
  app.get("*", (_req, res) => {
    res.json({
      message: "Frontend build ausente. Execute npm run build antes de servir o painel.",
      name: "Painel de OrviteK Bots API",
      status: "online"
    });
  });
}

app.use(errorHandler);

function ensureFrontendBuild() {
  if (env.NODE_ENV !== "production" || fs.existsSync(frontendIndexPath)) {
    return;
  }

  const frontendPackagePath = path.resolve(__dirname, "../../frontend/package.json");

  if (!fs.existsSync(frontendPackagePath)) {
    console.warn("[frontend] build ausente e fontes do frontend nao foram encontradas.");
    return;
  }

  console.warn("[frontend] build ausente; gerando frontend/dist antes de iniciar rotas.");
  const result = spawnSync("npm", ["--prefix", "frontend", "run", "build"], {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0 || !fs.existsSync(frontendIndexPath)) {
    console.error("[frontend] nao foi possivel gerar frontend/dist/index.html.");
  }
}
