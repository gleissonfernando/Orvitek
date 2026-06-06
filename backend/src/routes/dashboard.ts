import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { fetchBotProfile } from "../services/botProfileService";
import { isDevUser } from "../services/devAccessService";
import { canManageDevBotGuild, listAccessibleDevBots } from "../services/devBotService";
import { filterGuildsForBot, mergeAuthorizedBotGuilds } from "../services/statsService";
import { issueAuthCookies, type DashboardAuth } from "../services/tokenService";
import { saveSelectedGuild } from "../services/userService";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/me", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const user = auth.user;
    const panelBots = await listAccessibleDevBots(user).catch(() => []);
    const canViewDev = isDevUser(user);
    const accessibleGuilds = user.authorized ? mergeAuthorizedBotGuilds(user.guilds) : filterGuildsForBot(user.guilds);
    const guildsById = new Map(
      accessibleGuilds
      .filter((guild) => guild.botEnabled && (user.authorized || guild.owner || guild.isAdmin))
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
        owner: guild.owner,
        permissions: guild.isAdmin ? "ADMINISTRATOR" : "0",
        botInGuild: guild.botEnabled
      }))
      .map((guild) => [guild.id, guild])
    );

    for (const bot of panelBots) {
      if (!guildsById.has(bot.mainGuildId)) {
        guildsById.set(bot.mainGuildId, {
          id: bot.mainGuildId,
          name: `${bot.name} - servidor`,
          iconUrl: null,
          owner: bot.ownerId === user.discordId,
          permissions: bot.ownerId === user.discordId ? "BOT_OWNER" : "BOT_ADMIN",
          botInGuild: true
        });
      }
    }

    const guilds = [...guildsById.values()];

    const selectedGuildId = user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
      ? user.selectedGuildId
      : guilds[0]?.id ?? null;

    return res.json({
      user: {
        id: user.discordId,
        username: user.username,
        globalName: user.globalName,
        avatarUrl: user.avatarUrl ?? user.avatar
      },
      bot: await fetchBotProfile(),
      bots: panelBots,
      canViewDev,
      selectedGuildId,
      guilds
    });
  } catch (error) {
    return next(error);
  }
});

dashboardRouter.patch("/selected-guild", async (req, res, next) => {
  try {
    const input = z
      .object({
        selectedGuildId: z.string().regex(/^\d{5,32}$/)
      })
      .parse(req.body);
    const auth = res.locals.dashboardAuth as DashboardAuth;

    const botId = typeof req.body?.botId === "string" && req.body.botId.trim() ? req.body.botId.trim() : null;

    if (!canManageDashboardGuild(auth.user, input.selectedGuildId) && !(await canManageDevBotGuild(auth.user, botId, input.selectedGuildId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    auth.user.selectedGuildId = input.selectedGuildId;
    req.session.user = auth.user;
    await saveSelectedGuild(auth.user.discordId, input.selectedGuildId);
    issueAuthCookies(res, auth.user, auth.verified);

    return res.json({
      selectedGuildId: input.selectedGuildId
    });
  } catch (error) {
    return next(error);
  }
});
