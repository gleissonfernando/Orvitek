import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";

export const clearCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Apaga mensagens recentes do canal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName("quantidade")
        .setDescription("Quantidade de mensagens para apagar, de 1 a 100.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Comando disponivel apenas em servidores.",
        ephemeral: true
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: "Voce precisa da permissao Gerenciar Mensagens para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const channel = interaction.channel;
    const amount = interaction.options.getInteger("quantidade", true);

    if (!channel || typeof (channel as { bulkDelete?: unknown }).bulkDelete !== "function") {
      await interaction.reply({
        content: "Este canal nao permite apagar mensagens em massa.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({
      ephemeral: true
    });

    const deleted = await (channel as { bulkDelete: (limit: number, filterOld?: boolean) => Promise<{ size: number }> }).bulkDelete(amount, true);

    await context.api.postLog({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      type: "moderation.clear",
      message: `${interaction.user.tag} apagou ${deleted.size} mensagens em #${"name" in channel ? channel.name : "canal"}.`,
      metadata: {
        amount,
        deleted: deleted.size,
        channelId: channel.id
      }
    });

    context.socket.emitLog({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      type: "moderation.clear",
      message: `${deleted.size} mensagens apagadas.`,
      metadata: {
        amount,
        deleted: deleted.size,
        channelId: channel.id
      }
    });

    await interaction.editReply({
      content: `${deleted.size} mensagens apagadas. Mensagens com mais de 14 dias sao ignoradas pelo Discord.`
    });
  }
};
