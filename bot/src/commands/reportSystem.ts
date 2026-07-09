import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import { openReportSystemAdmin } from "../services/reportSystemService";

export const sistemaCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("sistema")
    .setDescription("Abre o painel administrativo do Sistema de Denuncias IAB/Corregedoria."),
  execute: openReportSystemAdmin,
  moduleId: "tickets"
};

export const iabCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("iab")
    .setDescription("Gerencia o sistema de Denuncias IAB/Corregedoria.")
    .addSubcommand((subcommand) => subcommand.setName("config").setDescription("Abre o painel IAB Config.")),
  execute: openReportSystemAdmin,
  moduleId: "police-iab"
};

export const configCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Abre paineis de configuracao do bot.")
    .addSubcommand((subcommand) => subcommand.setName("iab").setDescription("Abre o painel IAB Config.")),
  execute: openReportSystemAdmin,
  moduleId: "police-iab"
};
