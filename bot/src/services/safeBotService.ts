import { EmbedBuilder, type Client, type Guild, type GuildMember, type Message } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings } from "../types";

const MODULE_ID = "safe-bot";
const FALLBACK_MODULE_ID = "moderation";
const SELF_BOT_ROLE_NAME = "Self Bot";
const processingQueues = new Map<string, Promise<boolean>>();

export async function ensureSelfBotRole(guild: Guild, context: BotContext) {
  if (!isSelfBotModuleEnabled()) {
    return null;
  }

  const role = await findOrCreateSelfBotRole(guild);

  if (!role) {
    return null;
  }

  await context.api.syncSelfBotRole({
    guildId: guild.id,
    roleId: role.id,
    roleName: role.name
  }).catch((error) => {
    console.warn(`[self-bot] nao foi possivel salvar o cargo no servidor ${guild.id}:`, errorMessage(error));
  });

  return role;
}

export async function ensureSelfBotRoles(client: Client<true>, context: BotContext) {
  if (!isSelfBotModuleEnabled()) {
    return;
  }

  await Promise.allSettled(
    client.guilds.cache.map((guild) => ensureSelfBotRole(guild, context))
  );
}

export async function handleSafeBotMessage(message: Message, context: BotContext) {
  if (!isSelfBotModuleEnabled() || !message.guild || message.author.bot) {
    return false;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const previous = processingQueues.get(key) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(() => processSafeBotMessage(message, context))
    .catch((error) => {
      console.warn("[self-bot] falha ao processar mensagem:", errorMessage(error));
      return false;
    })
    .finally(() => {
      if (processingQueues.get(key) === next) {
        processingQueues.delete(key);
      }
    });

  processingQueues.set(key, next);
  return next;
}

async function processSafeBotMessage(message: Message, context: BotContext) {
  const guild = message.guild;

  if (!guild) {
    return false;
  }

  const settings = await context.api.getSettings(guild.id, message.client.user.id).catch((error) => {
    console.warn("[self-bot] nao foi possivel carregar configuracoes:", errorMessage(error));
    return null;
  });

  if (
    !settings?.safeBotEnabled
    || !settings.safeBotChannelId
    || !settings.safeBotRoleId
    || settings.safeBotChannelId !== message.channelId
  ) {
    return false;
  }

  const member = await resolveMember(message);

  if (!member || member.roles.cache.has(settings.safeBotRoleId)) {
    return false;
  }

  await guild.members.fetchMe().catch(() => null);
  const role = await guild.roles.fetch(settings.safeBotRoleId).catch(() => null);

  if (!role?.editable) {
    await writeDashboardLog(context, message, settings, false, "O cargo Self Bot nao pode ser atribuido pelo bot.");
    return false;
  }

  let assigned = false;
  let assignmentError: string | null = null;

  try {
    await member.roles.add(role, "Self Bot: primeira mensagem no canal configurado");
    const refreshedMember = await member.fetch();

    if (!refreshedMember.roles.cache.has(role.id)) {
      throw new Error("Discord nao confirmou o cargo Self Bot no membro.");
    }

    assigned = true;
  } catch (error) {
    assignmentError = errorMessage(error);
  }

  await Promise.allSettled([
    writeDashboardLog(context, message, settings, assigned, assignmentError),
    assigned ? sendDiscordLog(message, settings, role.id) : Promise.resolve()
  ]);

  if (!assigned) {
    console.warn(`[self-bot] nao foi possivel aplicar cargo a ${message.author.tag}: ${assignmentError ?? "erro desconhecido"}`);
  }

  return assigned;
}

async function resolveMember(message: Message): Promise<GuildMember | null> {
  if (message.member) {
    return message.member;
  }

  return message.guild?.members.fetch(message.author.id).catch(() => null) ?? null;
}

async function sendDiscordLog(message: Message, settings: GuildSettings, roleId: string) {
  const logChannelId = settings.safeBotLogChannelId ?? settings.logChannelId;

  if (!message.guild || !logChannelId) {
    return;
  }

  const channel = await message.guild.channels.fetch(logChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Self Bot - cargo aplicado")
    .setDescription([
      `**Usuario:** ${message.author.tag}`,
      `**ID:** \`${message.author.id}\``,
      `**Canal:** <#${message.channelId}>`,
      `**Cargo:** <@&${roleId}>`,
      `**Mensagem:** [abrir no Discord](${message.url})`
    ].join("\n"))
    .addFields({
      name: "Conteudo",
      value: truncate(message.content.trim() || attachmentSummary(message) || "Mensagem sem texto.", 1024)
    })
    .setTimestamp(message.createdAt);

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds: [embed]
  });
}

async function writeDashboardLog(
  context: BotContext,
  message: Message,
  settings: GuildSettings,
  assigned: boolean,
  assignmentError: string | null
) {
  if (!message.guild) {
    return;
  }

  await context.api.postLog({
    botId: settings.botId,
    guildId: message.guild.id,
    userId: message.author.id,
    type: assigned ? "security.self_bot.role_assigned" : "security.self_bot.assignment_failed",
    message: assigned
      ? `${message.author.tag} recebeu o cargo Self Bot pela primeira mensagem.`
      : `Falha ao aplicar cargo Self Bot para ${message.author.tag}.`,
    metadata: {
      assigned,
      assignmentError,
      attachments: message.attachments.map((attachment) => ({
        contentType: attachment.contentType,
        name: attachment.name,
        size: attachment.size,
        url: attachment.url
      })),
      channelId: message.channelId,
      content: truncate(message.content, 1900),
      messageId: message.id,
      messageUrl: message.url,
      roleId: settings.safeBotRoleId,
      safeBotChannelId: settings.safeBotChannelId,
      userId: message.author.id,
      username: message.author.tag
    }
  }).catch((error) => {
    console.warn("[self-bot] nao foi possivel registrar log na API:", errorMessage(error));
  });
}

export function isSelfBotModuleEnabled() {
  return isBotModuleEnabled(MODULE_ID) || isBotModuleEnabled(FALLBACK_MODULE_ID);
}

async function findOrCreateSelfBotRole(guild: Guild) {
  const roles = await guild.roles.fetch().catch((error) => {
    console.warn(`[self-bot] nao foi possivel buscar cargos em ${guild.name}:`, errorMessage(error));
    return null;
  });
  const existing = roles?.find((role) => role.name.toLowerCase() === SELF_BOT_ROLE_NAME.toLowerCase());

  if (existing) {
    return existing;
  }

  const me = await guild.members.fetchMe().catch(() => null);

  if (!me?.permissions.has("ManageRoles")) {
    console.warn(`[self-bot] sem permissao Gerenciar Cargos em ${guild.name}.`);
    return null;
  }

  return guild.roles.create({
    color: 0x22c55e,
    name: SELF_BOT_ROLE_NAME,
    reason: "Cargo criado automaticamente para o modulo Self Bot"
  }).catch((error) => {
    console.warn(`[self-bot] nao foi possivel criar o cargo em ${guild.name}:`, errorMessage(error));
    return null;
  });
}

function attachmentSummary(message: Message) {
  if (!message.attachments.size) {
    return "";
  }

  return message.attachments
    .map((attachment) => attachment.name || attachment.url)
    .filter(Boolean)
    .join("\n");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
