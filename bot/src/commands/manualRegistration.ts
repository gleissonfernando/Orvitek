import { SlashCommandBuilder } from "discord.js";
import { publishManualRegistrationPanel } from "../services/manualRegistrationService";
import type { BotCommand } from "../types";

export const manualRegistrationCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("cadastro-manual")
    .setDescription("Publica o painel de Cadastro Manual em Components V2."),
  moduleId: "manual-registration",
  async execute(interaction, context) {
    await publishManualRegistrationPanel(interaction, context);
  }
};
