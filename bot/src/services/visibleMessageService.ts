import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextBasedChannel,
  type TextChannel
} from "discord.js";
import type { BotCommand, BotContext } from "../types";

const WEBHOOK_NAME = "NexTech Mensagem Visível";

export const visibleMessageCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem")
    .setDescription("Envia uma mensagem visível com seu nome e avatar.")
    .addStringOption((option) => option
      .setName("mensagem")
      .setDescription("Mensagem que será enviada como visível.")
      .setRequired(true)
      .setMaxLength(1900))
    .addAttachmentOption((option) => option
      .setName("arquivo")
      .setDescription("Arquivo opcional para enviar junto da mensagem.")),
  async execute(interaction, context) {
    await sendVisibleMessage(interaction, context);
  }
};

async function sendVisibleMessage(interaction: ChatInputCommandInteraction, _context: BotContext) {
  if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
    await interaction.reply({ content: "Use este comando dentro de um canal de texto do servidor.", ephemeral: true });
    return;
  }

  if (!interaction.channel.isTextBased() || !("permissionsFor" in interaction.channel)) {
    await interaction.reply({ content: "Este canal não aceita envio de mensagens visíveis.", ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember | null;
  const channel = interaction.channel as TextBasedChannel & TextChannel;
  const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  const botPermissions = me ? channel.permissionsFor(me) : null;

  if (!botPermissions?.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.ManageWebhooks)) {
    await interaction.reply({
      content: "Não consigo enviar a mensagem visível neste canal. Preciso das permissões Enviar Mensagens e Gerenciar Webhooks.",
      ephemeral: true
    });
    return;
  }

  const memberPermissions = member ? channel.permissionsFor(member) : null;
  if (!memberPermissions?.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({ content: "Você não tem permissão para enviar mensagens neste canal.", ephemeral: true });
    return;
  }

  const text = interaction.options.getString("mensagem", true).trim();
  const attachment = interaction.options.getAttachment("arquivo");

  if (!text && !attachment) {
    await interaction.reply({ content: "Informe uma mensagem ou arquivo para enviar.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const webhook = await getOrCreateVisibleWebhook(channel);
    await webhook.send({
      allowedMentions: { parse: [] },
      avatarURL: interaction.user.displayAvatarURL({ size: 256 }),
      content: text || undefined,
      files: attachment ? [attachmentToFile(attachment)] : undefined,
      username: (member?.displayName || interaction.user.globalName || interaction.user.username).slice(0, 80)
    });

    await interaction.editReply("Mensagem visível enviada.");
  } catch (error) {
    console.error("[visible-message] falha ao enviar:", error instanceof Error ? error.message : error);
    await interaction.editReply("Não foi possível enviar a mensagem visível neste canal.");
  }
}

async function getOrCreateVisibleWebhook(channel: TextChannel) {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find((webhook) => webhook.name === WEBHOOK_NAME && webhook.owner?.id === channel.client.user?.id);
  if (existing) return existing;
  return channel.createWebhook({ name: WEBHOOK_NAME, reason: "Envio de mensagens visíveis pelo comando /mensagem" });
}

function attachmentToFile(attachment: Attachment) {
  return {
    attachment: attachment.url,
    name: attachment.name ?? `arquivo-${attachment.id}`
  };
}
