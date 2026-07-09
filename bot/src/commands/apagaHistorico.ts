import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember
} from "discord.js";
import type { FivemFacSettings } from "../services/apiClient";
import type { BotCommand, BotContext } from "../types";

const MODULE_ID = "fivem-fac";

export const apagaHistoricoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("apaga-historico")
    .setDescription("Apaga historicos de teste do FAC, Pedido Set e Metas.")
    .addBooleanOption((option) => option
      .setName("confirmar")
      .setDescription("Confirme que deseja apagar os historicos de teste.")
      .setRequired(true)),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.options.getBoolean("confirmar", true)) {
      await interaction.reply({
        content: "Operacao cancelada. Use `confirmar:true` apenas quando quiser apagar os historicos de teste.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const settings = await context.api.getFivemFacSettings(guild.id);
    const roleIds = memberRoleIds(interaction.member);

    if (!canUseFacHistoryReset(settings, roleIds)) {
      await interaction.editReply("Voce precisa de um cargo aprovador configurado no sistema FAC para usar este comando.");
      return;
    }

    const result = await context.api.resetFivemFacTestHistory({
      actorId: interaction.user.id,
      guildId: guild.id
    });
    const channelDeletion = await deleteLinkedDiscordChannels(guild, result.discordChannelIds.all, interaction);

    await interaction.editReply([
      "Historico de teste apagado.",
      "",
      `FAC ausencias: ${result.deleted.facAbsences}`,
      `Pedido Set: ${result.deleted.manualRegistrationSubmissions} pedidos e ${result.deleted.manualRegistrationLogs} logs`,
      `Metas/Farme: ${result.deleted.fivemGoalEntries} registros, ${result.deleted.fivemGoalSubmissions} envios, ${result.deleted.fivemGoalLogs} logs e ${result.deleted.fivemGoalUserChannels} canais vinculados`,
      `Canais do Discord removidos: ${channelDeletion.deleted}`,
      channelDeletion.failed.length ? `Falhas ao remover canais: ${channelDeletion.failed.length}` : null,
      `Total de registros apagados: ${result.deleted.total}`
    ].filter(Boolean).join("\n"));
  }
};

function canUseFacHistoryReset(settings: FivemFacSettings, roleIds: string[]) {
  return settings.approverRoleIds.length > 0 && settings.approverRoleIds.some((roleId) => roleIds.includes(roleId));
}

function memberRoleIds(member: ChatInputCommandInteraction["member"] | GuildMember | null) {
  if (!member || !("roles" in member)) return [];
  if (Array.isArray(member.roles)) return member.roles;
  return member.roles.cache.map((role) => role.id);
}

async function deleteLinkedDiscordChannels(guild: Guild, channelIds: string[], interaction: ChatInputCommandInteraction) {
  let deleted = 0;
  const failed: string[] = [];

  for (const channelId of unique(channelIds)) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      continue;
    }

    if (!("delete" in channel) || typeof channel.delete !== "function") {
      failed.push(channelId);
      continue;
    }

    await channel.delete(`Historico FAC apagado por ${interaction.user.tag} (${interaction.user.id})`)
      .then(() => {
        deleted += 1;
      })
      .catch(() => {
        failed.push(channelId);
      });
  }

  return { deleted, failed };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
