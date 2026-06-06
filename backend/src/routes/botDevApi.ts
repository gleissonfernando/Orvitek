import { Router } from "express";
import { requireBot } from "../middleware/auth";
import { getBotGuildConfig, getBotApiPermissions } from "../services/devBotService";

export const botDevApiRouter = Router();

botDevApiRouter.use(requireBot);

botDevApiRouter.get("/:botId/permissions", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    return res.json(permissions);
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/guild/:guildId/modules", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    return res.json({
      botId: req.params.botId,
      guildId: req.params.guildId,
      modules: permissions.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/guild/:guildId/config", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    const config = await getBotGuildConfig(req.params.botId, req.params.guildId);

    return res.json({
      ...config,
      enabledModules: permissions.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});
