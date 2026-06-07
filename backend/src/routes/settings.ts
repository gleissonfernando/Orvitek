import { Router, raw } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { isBotRequest, requireAuth, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { getGuildSettings, updateGuildSettings } from "../services/settingsService";
import { saveLeaveImage, saveWelcomeImage, sendLeavePanelToDiscord, sendWelcomePanelToDiscord } from "../services/welcomePanelService";
import {
  areGuildAssignableRoles,
  areGuildRoles,
  isGuildCategoryChannel,
  isGuildTextChannel
} from "../services/discordOptionsService";

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
  const botId = await resolveRequestBotId(req);

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
    const botId = await resolveRequestBotId(req);

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

    if (!(await canManageModule(req, res, guildId, botId, "welcome"))) {
      return res.status(403).json({
        message: "O modulo de entrada nao foi liberado para este bot."
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
    const botId = await resolveRequestBotId(req);

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

    if (!(await canManageModule(req, res, guildId, botId, "leave"))) {
      return res.status(403).json({
        message: "O modulo de saida nao foi liberado para este bot."
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
    const botId = await resolveRequestBotId(req);
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

    if (!(await canManageModule(req, res, guildId, botId, "welcome"))) {
      return res.status(403).json({
        message: "O modulo de entrada nao foi liberado para este bot."
      });
    }

    const settings = await getGuildSettings(guildId, botId);

    await sendWelcomePanelToDiscord(settings, `<@${user.discordId}>`, await getDevBotToken(botId));

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
    const botId = await resolveRequestBotId(req);
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

    if (!(await canManageModule(req, res, guildId, botId, "leave"))) {
      return res.status(403).json({
        message: "O modulo de saida nao foi liberado para este bot."
      });
    }

    const settings = await getGuildSettings(guildId, botId);

    await sendLeavePanelToDiscord(settings, `<@${user.discordId}>`, await getDevBotToken(botId));

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
    const botId = await resolveRequestBotId(req);

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

    if (!(await canPatchSettings(req, res, guildId, botId, input))) {
      return res.status(403).json({
        message: "Uma ou mais funcoes nao foram liberadas para este bot."
      });
    }

    await validateGuildResources(guildId, botId, input);

    const settings = await updateGuildSettings(guildId, input, botId);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

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

async function canManageModule(
  req: Request,
  res: Response,
  guildId: string,
  botId: string | null,
  moduleId: string
) {
  if (!botId) {
    return canManageSettings(req, res, guildId, botId);
  }

  return canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, moduleId);
}

async function canPatchSettings(
  req: Request,
  res: Response,
  guildId: string,
  botId: string | null,
  input: z.infer<typeof settingsSchema>
) {
  if (!botId) {
    return true;
  }

  const moduleBySetting: Partial<Record<keyof z.infer<typeof settingsSchema>, string[]>> = {
    welcomeEnabled: ["welcome"],
    welcomeChannelId: ["welcome"],
    welcomeDisplayChannelId: ["welcome"],
    welcomeImageUrl: ["welcome"],
    welcomeMessage: ["welcome"],
    leaveEnabled: ["leave"],
    leaveChannelId: ["leave"],
    leaveDisplayChannelId: ["leave"],
    leaveImageUrl: ["leave"],
    leaveMessage: ["leave"],
    autoRoleEnabled: ["welcome", "roles"],
    autoRoleIds: ["welcome", "roles"],
    twitchRoleId: ["roles"],
    boosterRoleId: ["roles"],
    ticketEnabled: ["tickets"],
    ticketCategoryId: ["tickets"],
    logChannelId: ["logs"],
    moderationEnabled: ["moderation"],
    verificationEnabled: ["moderation"],
    verificationRoleId: ["moderation"]
  };
  const access = await Promise.all(
    (Object.keys(input) as Array<keyof typeof input>).map(async (key) => {
      const moduleIds = moduleBySetting[key] ?? [];
      const moduleAccess = await Promise.all(
        moduleIds.map((moduleId) => canManageModule(req, res, guildId, botId, moduleId))
      );

      return moduleAccess.some(Boolean);
    })
  );

  return access.every(Boolean);
}

async function validateGuildResources(
  guildId: string,
  botId: string | null,
  input: z.infer<typeof settingsSchema>
) {
  const botToken = await getDevBotToken(botId);
  const textChannelIds = [
    input.welcomeChannelId,
    input.welcomeDisplayChannelId,
    input.leaveChannelId,
    input.leaveDisplayChannelId,
    input.logChannelId
  ].filter((channelId): channelId is string => Boolean(channelId));

  const textChannelChecks = await Promise.all(
    [...new Set(textChannelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!textChannelChecks.every(Boolean)) {
    throw createSettingsError("Um dos canais selecionados nao pertence a este servidor.");
  }

  if (
    input.ticketCategoryId
    && !(await isGuildCategoryChannel(guildId, input.ticketCategoryId, botToken))
  ) {
    throw createSettingsError("A categoria de tickets nao pertence a este servidor.");
  }

  const roleIds = [
    ...(input.autoRoleIds ?? []),
    input.twitchRoleId,
    input.boosterRoleId,
    input.verificationRoleId
  ].filter((roleId): roleId is string => Boolean(roleId));

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createSettingsError("Um dos cargos selecionados nao pertence a este servidor.");
  }

  if (
    input.autoRoleIds?.length
    && !(await areGuildAssignableRoles(guildId, [...new Set(input.autoRoleIds)], botToken))
  ) {
    throw createSettingsError("O cargo automatico precisa ficar abaixo do cargo do bot e o bot precisa da permissao Gerenciar Cargos.");
  }
}

function createSettingsError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 400
  });
}
