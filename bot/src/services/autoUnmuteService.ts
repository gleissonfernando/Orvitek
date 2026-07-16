import {
  ChannelType,
  PermissionFlagsBits,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceState
} from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotContext } from "../types";
import { getRuntimeModuleAuthorization } from "./runtimeModuleGuard";

type AutoUnmuteConfig = {
  antiSpamSeconds: number;
  delaySeconds: number;
  enabled: boolean;
  requiredRoleId: string | null;
  voiceChannelId: string | null;
};

type AutoUnmuteAction = "mute" | "deafen";

const MODULE_ID = "auto-unmute";
const DEFAULT_ANTI_SPAM_SECONDS = 10;
const processedUsers = new Map<string, number>();
const configWarningLogs = new Map<string, number>();

export async function handleAutoUnmuteVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  if (!newState.guild || newState.member?.user.bot) {
    return;
  }

  const actions = detectAutoUnmuteActions(oldState, newState);

  if (!newState.channelId || !actions.length) {
    return;
  }

  const botId = currentRuntimeBotId();

  if (!botId) {
    return;
  }

  const authorization = await getRuntimeModuleAuthorization(context, newState.guild.id, MODULE_ID);

  if (!authorization.allowed || authorization.botId !== botId) {
    return;
  }

  const config = await readAutoUnmuteConfig(context, botId, newState.guild.id);

  if (!config.enabled) {
    return;
  }

  if (config.voiceChannelId && config.voiceChannelId !== newState.channelId) {
    return;
  }

  const antiSpamMs = config.antiSpamSeconds * 1000;
  const now = Date.now();
  const eligibleActions = actions.filter((action) => {
    const antiSpamKey = `${botId}:${newState.guild.id}:${newState.id}:${action}`;
    const lastProcessedAt = processedUsers.get(antiSpamKey) ?? 0;
    return now - lastProcessedAt >= antiSpamMs;
  });

  if (!eligibleActions.length) {
    return;
  }

  for (const action of eligibleActions) {
    processedUsers.set(`${botId}:${newState.guild.id}:${newState.id}:${action}`, now);
  }

  if (config.delaySeconds > 0) {
    await wait(config.delaySeconds * 1000);
  }

  const member = await newState.guild.members.fetch(newState.id).catch(() => null);

  if (!member || !member.voice.channelId || (config.voiceChannelId && member.voice.channelId !== config.voiceChannelId)) {
    return;
  }

  const pendingActions = eligibleActions.filter((action) => action === "mute" ? member.voice.serverMute : member.voice.serverDeaf);

  if (!pendingActions.length) {
    return;
  }

  if (!(await validateConfiguredRole(context, member, config))) {
    return;
  }

  const channel = await resolveConfiguredVoiceChannel(context, member, config);

  if (!channel) {
    return;
  }

  for (const action of pendingActions) {
    const permissionError = await validateBotPermissions(member, channel, action);

    if (permissionError) {
      await writeAutoUnmuteLog(context, member.guild.id, "auto_unmute.permission_failed", permissionError, {
        action,
        botId,
        channelId: channel.id,
        userId: member.id
      });
      continue;
    }

    try {
      const reason = action === "mute"
        ? "Auto Desmutar: removendo mute de voz no servidor."
        : "Auto Desmutar: reativando audio no servidor.";

      if (action === "mute") {
        await member.voice.setMute(false, reason);
      } else {
        await member.voice.setDeaf(false, reason);
      }

      await writeAutoUnmuteLog(
        context,
        member.guild.id,
        "auto_unmute.executed",
        action === "mute"
          ? `Auto Desmutar executado: usuário ${member.user.tag} teve o mute de voz removido em #${channel.name}.`
          : `Auto Desmutar executado: usuário ${member.user.tag} teve o audio reativado em #${channel.name}.`,
        {
          action,
          botId,
          channelId: channel.id,
          userId: member.id
        },
        member.id
      );
    } catch (error) {
      await writeAutoUnmuteLog(context, member.guild.id, "auto_unmute.failed", `Auto Desmutar falhou ao reverter ${action} de ${member.user.tag}: ${readError(error)}.`, {
        action,
        botId,
        channelId: channel.id,
        userId: member.id
      }, member.id);
    }
  }
}

function detectAutoUnmuteActions(oldState: VoiceState, newState: VoiceState): AutoUnmuteAction[] {
  const enteredVoiceChannel = oldState.channelId !== newState.channelId;
  const actions: AutoUnmuteAction[] = [];

  if (newState.serverMute && (enteredVoiceChannel || !oldState.serverMute)) {
    actions.push("mute");
  }

  if (newState.serverDeaf && (enteredVoiceChannel || !oldState.serverDeaf)) {
    actions.push("deafen");
  }

  return actions;
}

async function readAutoUnmuteConfig(context: BotContext, botId: string, guildId: string): Promise<AutoUnmuteConfig> {
  const config: Record<string, unknown> = await context.api.getBotGuildConfig(botId, guildId)
    .then((guildConfig) => guildConfig.modules?.[MODULE_ID] ?? {})
    .catch(() => ({}));

  return {
    antiSpamSeconds: boundedNumber(config.antiSpamSeconds, DEFAULT_ANTI_SPAM_SECONDS, 1, 300),
    delaySeconds: boundedNumber(config.delaySeconds, 0, 0, 60),
    enabled: config.enabled === true,
    requiredRoleId: readOptionalId(config.requiredRoleId),
    voiceChannelId: readOptionalId(config.voiceChannelId)
  };
}

async function validateConfiguredRole(context: BotContext, member: GuildMember, config: AutoUnmuteConfig) {
  if (!config.requiredRoleId) {
    return true;
  }

  const role = member.guild.roles.cache.get(config.requiredRoleId);

  if (!role) {
    await writeThrottledConfigLog(
      context,
      member.guild.id,
      `role:${config.requiredRoleId}`,
      "auto_unmute.role_missing",
      `Auto Desmutar pausou a ação: o cargo configurado (${config.requiredRoleId}) não existe mais.`,
      {
        roleId: config.requiredRoleId
      }
    );
    return false;
  }

  return member.roles.cache.has(config.requiredRoleId);
}

async function resolveConfiguredVoiceChannel(context: BotContext, member: GuildMember, config: AutoUnmuteConfig) {
  if (!config.voiceChannelId) {
    const channel = member.voice.channel;
    return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice ? channel : null;
  }

  const channel = member.guild.channels.cache.get(config.voiceChannelId ?? "");

  if (channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice) {
    return channel as VoiceBasedChannel;
  }

  await writeThrottledConfigLog(
    context,
    member.guild.id,
    `channel:${config.voiceChannelId}`,
    "auto_unmute.channel_missing",
    `Auto Desmutar pausou a ação: o canal configurado (${config.voiceChannelId}) não existe mais.`,
    {
      channelId: config.voiceChannelId
    }
  );
  return null;
}

async function validateBotPermissions(member: GuildMember, channel: VoiceBasedChannel, action: AutoUnmuteAction) {
  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);

  if (!botMember) {
    return "Auto Desmutar não conseguiu validar o bot no servidor.";
  }

  const channelPermissions = channel.permissionsFor(botMember);
  const requiredPermission = action === "mute" ? PermissionFlagsBits.MuteMembers : PermissionFlagsBits.DeafenMembers;

  if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel) || !channelPermissions.has(requiredPermission)) {
    return action === "mute"
      ? "Auto Desmutar sem permissão para ver o canal ou gerenciar mute de voz."
      : "Auto Desmutar sem permissão para ver o canal ou gerenciar audio desativado.";
  }

  if (member.guild.ownerId !== member.id && botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return "Auto Desmutar sem hierarquia de cargo acima do usuário.";
  }

  return null;
}

async function writeThrottledConfigLog(
  context: BotContext,
  guildId: string,
  key: string,
  type: string,
  message: string,
  metadata: Record<string, unknown>
) {
  const cacheKey = `${guildId}:${key}`;
  const lastLoggedAt = configWarningLogs.get(cacheKey) ?? 0;

  if (Date.now() - lastLoggedAt < 60_000) {
    return;
  }

  configWarningLogs.set(cacheKey, Date.now());
  await writeAutoUnmuteLog(context, guildId, type, message, metadata);
}

async function writeAutoUnmuteLog(
  context: BotContext,
  guildId: string,
  type: string,
  message: string,
  metadata: Record<string, unknown>,
  userId?: string | null
) {
  await context.api.postLog({
    botId: currentRuntimeBotId(),
    guildId,
    message,
    metadata,
    type,
    userId: userId ?? null
  }).catch((error) => {
    console.warn("[auto-unmute] falha ao registrar log:", readError(error));
  });
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readOptionalId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
