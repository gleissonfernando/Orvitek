import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import { createPolicePatrolFromCommand, showPolicePatrolViewer } from "../services/policePatrolReportService";
import { executeCourseReportCommand } from "../services/courseSystemService";

export const policePatrolReportCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("relatorio").setDescription("Cria relatórios operacionais.")
    .addSubcommand((subcommand) => subcommand
      .setName("patrulha")
      .setDescription("Cria um relatório policial de patrulhamento.")
      .addUserOption((option) => option.setName("policial").setDescription("Policial que será avaliado").setRequired(true))
      .addStringOption((option) => option.setName("tipo").setDescription("Tipo de patrulhamento").setMaxLength(100))
      .addStringOption((option) => option.setName("observacoes").setDescription("Observações iniciais").setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("curso")
      .setDescription("Lança relatório de curso.")),
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "curso") {
      await executeCourseReportCommand(interaction, context);
      return;
    }

    await createPolicePatrolFromCommand(interaction, context);
  }
};

export const viewPolicePatrolReportCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("vrelatorio").setDescription("Consulta relatórios policiais e estatísticas."),
  moduleId: "police-patrol-reports",
  execute: showPolicePatrolViewer
};
