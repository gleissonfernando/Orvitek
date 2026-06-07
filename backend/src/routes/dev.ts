import { Router } from "express";
import { z } from "zod";
import { emitRealtime } from "../realtime/events";
import { requireDevAccess } from "../services/devAccessService";
import {
  createDevBot,
  canManageDevBot,
  deleteDevBot,
  DEV_MODULES,
  getBotGuildConfig,
  getDevBot,
  listAccessibleDevBots,
  listBotGuildConfigs,
  testDiscordBotToken,
  updateBotGuildConfig,
  updateDevBot,
  updateDevBotModules,
  validateDevBotConnection
} from "../services/devBotService";
import {
  restartDevBotProcess,
  startDevBotProcess,
  stopDevBotProcess
} from "../services/devBotRuntimeService";
import type { DashboardAuth } from "../services/tokenService";

const moduleIds = DEV_MODULES.map((module) => module.id) as [string, ...string[]];

const createBotSchema = z.object({
  name: z.string().min(2).max(80),
  clientId: z.string().regex(/^\d{5,32}$/),
  token: z.string().min(10),
  secret: z.string().max(256).nullable().optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  ownerName: z.string().min(2).max(80),
  ownerId: z.string().regex(/^\d{5,32}$/),
  mainGuildId: z.string().regex(/^\d{5,32}$/),
  enabledModules: z.array(z.enum(moduleIds)).default([])
});

const updateBotSchema = createBotSchema.partial().extend({
  token: z.string().min(10).optional()
});

const modulesSchema = z.object({
  enabledModules: z.array(z.enum(moduleIds))
});

const guildConfigSchema = z.object({
  guildName: z.string().min(1).max(100).default("Servidor"),
  modules: z.record(z.record(z.unknown())).default({})
});

export const devRouter = Router();

devRouter.use(requireDevAccess);

devRouter.get("/modules", (_req, res) => {
  return res.json({
    modules: DEV_MODULES
  });
});

devRouter.get("/bots", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    return res.json({
      bots: await listAccessibleDevBots(auth.user)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/test-connection", async (req, res, next) => {
  try {
    const input = z.object({
      token: z.string().min(10),
      clientId: z.string().regex(/^\d{5,32}$/).optional()
    }).parse(req.body);

    return res.json(await testDiscordBotToken(input.token, input.clientId));
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/create", async (req, res, next) => {
  try {
    const input = createBotSchema.parse(req.body);
    const auth = res.locals.dashboardAuth as DashboardAuth;

    const createdBot = await createDevBot({
      ...input,
      avatarUrl: input.avatarUrl || null,
      secret: input.secret || null,
      createdBy: auth.user.discordId
    });
    await startDevBotProcess(createdBot.id);
    const bot = await getDevBot(createdBot.id) ?? createdBot;

    return res.status(201).json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const bot = await getDevBot(req.params.botId);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = updateBotSchema.parse(req.body);

    const updatedBot = await updateDevBot(req.params.botId, {
      ...input,
      avatarUrl: input.avatarUrl === "" ? null : input.avatarUrl
    });

    if (!updatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    await restartDevBotProcess(updatedBot.id);
    const bot = await getDevBot(updatedBot.id) ?? updatedBot;

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/bots/:botId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    await stopDevBotProcess(req.params.botId);
    const bot = await deleteDevBot(req.params.botId);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/restart", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const validatedBot = await validateDevBotConnection(req.params.botId);

    if (!validatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    if (validatedBot.status === "invalid_token" || validatedBot.status === "error") {
      return res.status(400).json({
        message: validatedBot.statusMessage ?? "Nao foi possivel validar o bot."
      });
    }

    await restartDevBotProcess(req.params.botId);
    const bot = await getDevBot(req.params.botId) ?? validatedBot;

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/modules", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const bot = await getDevBot(req.params.botId);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      modules: bot.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/modules", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = modulesSchema.parse(req.body);
    const updatedBot = await updateDevBotModules(req.params.botId, input.enabledModules);

    if (!updatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    await restartDevBotProcess(updatedBot.id);
    const bot = await getDevBot(updatedBot.id) ?? updatedBot;

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/guilds", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!(await getDevBot(req.params.botId))) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      configs: await listBotGuildConfigs(req.params.botId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/guilds/:guildId/config", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!(await getDevBot(req.params.botId))) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      config: await getBotGuildConfig(req.params.botId, req.params.guildId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/guilds/:guildId/config", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!(await getDevBot(req.params.botId))) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    const input = guildConfigSchema.parse(req.body);
    const config = await updateBotGuildConfig({
      botId: req.params.botId,
      guildId: req.params.guildId,
      guildName: input.guildName,
      modules: input.modules
    });

    emitRealtime("dev:config_saved", config);

    return res.json({
      config
    });
  } catch (error) {
    return next(error);
  }
});
