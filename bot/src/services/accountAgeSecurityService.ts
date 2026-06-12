import { EmbedBuilder, type GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings } from "../types";

const MODULE_ID = "account-age-security";
const DAY_MS = 86_400_000;

type AccountAgeDecision = {
  accountAgeDays: number;
  accountCreatedAt: Date;
  attemptAt: Date;
  minDays: number;
};

export async function enforceAccountAgeSecurity(context: BotContext, member: GuildMember) {
  if (!isBotModuleEnabled(MODULE_ID) || member.user.bot) {
    return false;
  }

  const settings = await context.api.getSettings(member.guild.id, member.client.user.id).catch((error) => {
    console.warn("[account-age-security] nao foi possivel carregar configuracoes:", errorMessage(error));
    return null;
  });

  if (!settings?.accountAgeSecurityEnabled) {
    return false;
  }

  if (settings.accountAgeAllowedUserIds.includes(member.id)) {
    return false;
  }

  const decision = accountAgeDecision(member, settings.accountAgeMinDays);

  if (decision.accountAgeDays >= decision.minDays) {
    return false;
  }

  await notifyMember(member, decision).catch((error) => {
    console.warn("[account-age-security] nao foi possivel avisar o membro:", errorMessage(error));
  });

  let removed = false;
  let removalError: string | null = null;

  try {
    if (!member.kickable) {
      throw new Error("O bot nao pode remover este membro por falta de permissao ou hierarquia de cargos.");
    }

    await member.kick(`Conta Discord com menos de ${decision.minDays} dia(s).`);
    removed = true;
  } catch (error) {
    removalError = errorMessage(error);
    console.warn("[account-age-security] nao foi possivel remover o membro:", removalError);
  }

  await Promise.allSettled([
    sendDiscordLog(member, settings, decision, removed, removalError),
    writeDashboardLog(context, member, settings, decision, removed, removalError)
  ]);

  return true;
}

function accountAgeDecision(member: GuildMember, minDays: number): AccountAgeDecision {
  const attemptAt = new Date();
  const accountCreatedAt = member.user.createdAt;
  const accountAgeDays = Math.max(0, Math.floor((attemptAt.getTime() - accountCreatedAt.getTime()) / DAY_MS));

  return {
    accountAgeDays,
    accountCreatedAt,
    attemptAt,
    minDays: Math.max(0, Math.trunc(minDays))
  };
}

async function notifyMember(member: GuildMember, decision: AccountAgeDecision) {
  await member.send([
    `Voce foi removido de ${member.guild.name}.`,
    `Motivo: sua conta Discord tem ${decision.accountAgeDays} dia(s) e o minimo exigido e ${decision.minDays} dia(s).`,
    "Tente entrar novamente quando sua conta atingir a idade minima ou solicite liberacao para a equipe."
  ].join("\n"));
}

async function sendDiscordLog(
  member: GuildMember,
  settings: GuildSettings,
  decision: AccountAgeDecision,
  removed: boolean,
  removalError: string | null
) {
  const logChannelId = settings.accountAgeLogChannelId ?? settings.logChannelId;

  if (!logChannelId) {
    return;
  }

  const channel = await member.guild.channels.fetch(logChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(removed ? 0xed4245 : 0xf59e0b)
    .setTitle("Entrada bloqueada por idade da conta")
    .setDescription([
      `**Usuario:** ${member.user.tag}`,
      `**ID:** \`${member.id}\``,
      `**Conta criada em:** <t:${unixSeconds(decision.accountCreatedAt)}:F>`,
      `**Idade da conta:** ${decision.accountAgeDays} dia(s)`,
      `**Minimo exigido:** ${decision.minDays} dia(s)`,
      `**Tentativa de entrada:** <t:${unixSeconds(decision.attemptAt)}:F>`,
      `**Status:** ${removed ? "Usuario removido automaticamente" : `Falha ao remover: ${removalError ?? "erro desconhecido"}`}`
    ].join("\n"))
    .setTimestamp(decision.attemptAt);

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds: [embed]
  });
}

async function writeDashboardLog(
  context: BotContext,
  member: GuildMember,
  settings: GuildSettings,
  decision: AccountAgeDecision,
  removed: boolean,
  removalError: string | null
) {
  await context.api.postLog({
    botId: settings.botId,
    guildId: member.guild.id,
    userId: member.id,
    type: "security.account_age.blocked",
    message: `${member.user.tag} bloqueado por idade da conta (${decision.accountAgeDays}/${decision.minDays} dia(s)).`,
    metadata: {
      accountAgeDays: decision.accountAgeDays,
      accountCreatedAt: decision.accountCreatedAt.toISOString(),
      attemptAt: decision.attemptAt.toISOString(),
      minDays: decision.minDays,
      removed,
      removalError,
      userId: member.id,
      username: member.user.tag
    }
  }).catch((error) => {
    console.warn("[account-age-security] nao foi possivel registrar log na API:", errorMessage(error));
  });
}

function unixSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
