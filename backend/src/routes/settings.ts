import { Router, raw } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { isBotRequest, requireAuth, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild } from "../services/devBotService";
import { getGuildSettings, updateGuildSettings } from "../services/settingsService";
import { saveLeaveImage, saveWelcomeImage, sendLeavePanelToDiscord, sendWelcomePanelToDiscord } from "../services/welcomePanelService";

const settingsSchema = z.object({
  welcomeEnabled: z.boolean().optional(),
  welcomeChannelId: z.string().nullable().optional(),
  welcomeDisplayChannelId: z.string().nullable().optional(),
  welcomeImageUrl: z.string().max(2048).nullable().optional(),
  welcomeMessage: z.string().nullable().optional(),
  leaveEnabled: z.boolean().optional(),
  leaveChannelId: z.string().nullable().optional(),
  leaveDisplayChannelId: z.string().nullable().optional(),
  leaveImageUrl: z.string().max(2048).nullable().optional(),
  leaveMessage: z.string().nullable().optional(),
  autoRoleEnabled: z.boolean().optional(),
  autoRoleIds: z.array(z.string()).optional(),
  twitchRoleId: z.string().nullable().optional(),
  boosterRoleId: z.string().nullable().optional(),
  ticketEnabled: z.boolean().optional(),
  ticketCategoryId: z.string().nullable().optional(),
  logChannelId: z.string().nullable().optional(),
  moderationEnabled: z.boolean().optional(),
  verificationEnabled: z.boolean().optional(),
  verificationRoleId: z.string().nullable().optional()
});

export const settingsRouter = Router();
const welcomeImageUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});

settingsRouter.get("/:guildId", requireAuthOrBot, async (req, res) => {
  const { guildId } = req.params;
  const botId = readBotId(req);

  if (!guildId) {
    return res.status(400).json({
      message: "guildId obrigatorio."
    });
  }

  if (!(await canReadSettings(req, res, guildId, botId))) {
    return res.status(403).json({
      message: "Servidor nao encontrado ou sem o bot."
    });
  }

  return res.json({
    settings: await getGuildSettings(guildId, botId)
  });
});

settingsRouter.put("/:guildId/welcome-image", requireAuth, welcomeImageUpload, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = readBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        message: "Arquivo de imagem obrigatorio."
      });
    }

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const welcomeImageUrl = await saveWelcomeImage(guildId, req.body, mimeType);
    const settings = await updateGuildSettings(guildId, {
      welcomeImageUrl
    }, botId);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.put("/:guildId/leave-image", requireAuth, welcomeImageUpload, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = readBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        message: "Arquivo de imagem obrigatorio."
      });
    }

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const leaveImageUrl = await saveLeaveImage(guildId, req.body, mimeType);
    const settings = await updateGuildSettings(guildId, {
      leaveImageUrl
    }, botId);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.post("/:guildId/welcome-test", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = readBotId(req);
    const user = res.locals.dashboardAuth.user;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const settings = await getGuildSettings(guildId, botId);

    await sendWelcomePanelToDiscord(settings, `<@${user.discordId}>`);

    return res.json({
      ok: true
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.post("/:guildId/leave-test", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = readBotId(req);
    const user = res.locals.dashboardAuth.user;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const settings = await getGuildSettings(guildId, botId);

    await sendLeavePanelToDiscord(settings, `<@${user.discordId}>`);

    return res.json({
      ok: true
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = readBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const input = settingsSchema.parse(req.body);
    const settings = await updateGuildSettings(guildId, input, botId);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

function readBotId(req: Request) {
  const queryBotId = typeof req.query.botId === "string" ? req.query.botId : null;
  const headerBotId = req.header("x-dashboard-bot-id");
  const botId = queryBotId ?? headerBotId ?? null;
  const normalized = botId?.trim();

  return normalized ? normalized : null;
}

async function canReadSettings(req: Request, res: Response, guildId: string, botId: string | null) {
  if (isBotRequest(req)) {
    return true;
  }

  const user = res.locals.dashboardAuth.user;

  if (botId) {
    return canManageDevBotGuild(user, botId, guildId);
  }

  return canReadDashboardGuild(user, guildId);
}

async function canManageSettings(req: Request, res: Response, guildId: string, botId: string | null) {
  if (isBotRequest(req)) {
    return true;
  }

  const user = res.locals.dashboardAuth.user;

  if (botId) {
    return canManageDevBotGuild(user, botId, guildId);
  }

  return canManageDashboardGuild(user, guildId);
}
