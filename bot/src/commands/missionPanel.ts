import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { publishConfiguredMissionToolsPanel } from "../services/missionToolsService";
import type { BotCommand } from "../types";

export const missionPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mission-panel")
    .setDescription("Publish or update the Mission Tools Control Center.")
    .addChannelOption((option) => option
      .setName("canal")
      .setDescription("Canal onde o Control Center sera publicado.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  moduleId: "mission-tools",
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Use this command inside a server.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = interaction.options.getChannel("canal");
      const panelChannelId = channel?.id ?? interaction.channelId;
      const settings = await publishConfiguredMissionToolsPanel(context.client, context, interaction.guildId, {
        panelChannelId
      });
      await interaction.editReply({
        content: settings.panelMessageId
          ? `Control Center publicado ou atualizado no canal configurado. Mensagem: ${settings.panelMessageId}.`
          : "Control Center published or updated."
      });
    } catch (error) {
      const message = readRequestMessage(error) ?? (error instanceof Error ? error.message : "The Control Center could not be published.");
      await interaction.editReply({
        content: `${message} Configure o canal no dashboard ou use /mission-panel canal:#canal.`
      });
    }
  }
};

function readRequestMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}
