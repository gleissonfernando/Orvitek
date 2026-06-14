import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import { handleMissionPanelPublishCommand } from "../services/missionToolsService";

export const missionPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mission-panel")
    .setDescription("Publica ou atualiza o painel interativo Mission Tools.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: "mission-tools",
  async execute(interaction, context) {
    await handleMissionPanelPublishCommand(interaction, context);
  }
};
