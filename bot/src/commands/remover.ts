import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type GuildMember,
  type Interaction
} from "discord.js";
import type { BotCommand, BotContext } from "../types";
import type { FivemFacAbsence, FivemFacSettings } from "../services/apiClient";
import { renderComponentsV2Panel } from "../services/panelVisualRenderer";

const MODULE_ID = "police-absences";
const PREFIX = "remove_absence_role";
const CONFIRM_PREFIX = `${PREFIX}:confirm`;
const CANCEL_PREFIX = `${PREFIX}:cancel`;
const ACTIVE_STATUSES = new Set<FivemFacAbsence["status"]>(["pending", "approved", "active"]);

export const removerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("remover")
    .setDescription("Remove estados temporarios de usuários.")
    .addSubcommand((subcommand) => subcommand
      .setName("cargo")
      .setDescription("Remove o cargo de ausência de um usuário e encerra a ausência.")
      .addUserOption((option) => option
        .setName("usuario")
        .setDescription("Usuário que terá a ausência removida.")
        .setRequired(true))),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() !== "cargo") {
      await interaction.reply({ content: "Subcomando inválido.", ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    const target = interaction.options.getUser("usuario", true);

    if (!guild) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    const settings = await context.api.getFivemFacSettings(guild.id);
    const roleIds = memberRoleIds(interaction.member);

    if (!canModerateAbsences(settings, roleIds)) {
      await interaction.reply({ content: "Você precisa de um cargo aprovador do sistema de ausências para remover essa ausência.", ephemeral: true });
      return;
    }

    const absences = await context.api.getFivemFacUserAbsences(guild.id, target.id);
    const absence = pickActiveAbsence(absences);

    if (!absence) {
      await interaction.reply({ content: `Não encontrei ausência aberta para ${target}.`, ephemeral: true });
      return;
    }

    await interaction.reply(ephemeralPanel({
      actions: [confirmationActions(absence.id, target.id)],
      description: `Confirme para remover o cargo de ausência de ${target} e encerrar a ausência.`,
      fields: absenceFields(absence, settings),
      title: "Remover Cargo de Ausência"
    }));
  }
};

export async function handleRemoverInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) {
    return false;
  }

  if (interaction.customId.startsWith(CANCEL_PREFIX)) {
    await interaction.update(ephemeralPanel({
      description: "Operação cancelada. Nenhum cargo ou registro de ausência foi alterado.",
      title: "Remoção Cancelada"
    }));
    return true;
  }

  if (!interaction.customId.startsWith(CONFIRM_PREFIX)) {
    return false;
  }

  await confirmRemoval(interaction, context);
  return true;
}

async function confirmRemoval(interaction: ButtonInteraction, context: BotContext) {
  const guild = interaction.guild;

  if (!guild) {
    await interaction.update(ephemeralPanel({
      description: "Esta ação precisa ser executada dentro de um servidor.",
      title: "Remoção Não Concluída"
    }));
    return;
  }

  const [, , absenceId, targetUserId] = interaction.customId.split(":");

  if (!absenceId || !targetUserId) {
    await interaction.update(ephemeralPanel({
      description: "Este painel não possui os dados necessarios para concluir a remoção.",
      title: "Painel Inválido"
    }));
    return;
  }

  const settings = await context.api.getFivemFacSettings(guild.id);
  const roleIds = memberRoleIds(interaction.member);

  if (!canModerateAbsences(settings, roleIds)) {
    await interaction.update(ephemeralPanel({
      description: "Você não tem mais um cargo aprovador configurado para concluir esta remoção.",
      title: "Permissão Insuficiente"
    }));
    return;
  }

  const absence = await context.api.getFivemFacAbsence(absenceId);

  if (!absence || absence.guildId !== guild.id || absence.userId !== targetUserId) {
    await interaction.update(ephemeralPanel({
      description: "A ausência selecionada não foi encontrada ou não pertence a este usuário.",
      title: "Ausência Indisponível"
    }));
    return;
  }

  if (!ACTIVE_STATUSES.has(absence.status)) {
    await interaction.update(ephemeralPanel({
      description: "Esta ausência já foi encerrada ou recusada.",
      fields: absenceFields(absence, settings),
      title: "Ausência Já Encerrada"
    }));
    return;
  }

  let roleRemoved = false;
  let roleNote = "Nenhum cargo de ausência está configurado.";

  if (settings.absenceRoleId) {
    const targetMember = await guild.members.fetch(absence.userId).catch(() => null);
    if (!targetMember) {
      roleNote = "Usuário não encontrado no servidor. A ausência será encerrada mesmo assim.";
    } else if (targetMember.roles.cache.has(settings.absenceRoleId)) {
      await targetMember.roles.remove(settings.absenceRoleId, `Ausência removida por ${interaction.user.tag}`);
      roleRemoved = true;
      roleNote = `Cargo <@&${settings.absenceRoleId}> removido.`;
    } else {
      roleRemoved = true;
      roleNote = `O usuário já estava sem o cargo <@&${settings.absenceRoleId}>.`;
    }
  }

  const closed = await context.api.closeFivemFacAbsence(absence.id, {
    moderatorId: interaction.user.id,
    moderatorRoleIds: roleIds,
    reason: "Removido manualmente pelo comando /remover cargo.",
    roleRemoved
  });

  await context.api.postLog({
    guildId: guild.id,
    userId: absence.userId,
    executorId: interaction.user.id,
    module: MODULE_ID,
    action: "absence_role_removed",
    caseId: absence.id,
    status: "success",
    type: "police.absence.role_removed",
    message: "Cargo de ausência removido manualmente.",
    metadata: {
      absenceId: absence.id,
      roleId: settings.absenceRoleId,
      roleRemoved
    }
  }).catch(() => undefined);

  await interaction.update(ephemeralPanel({
    description: `Ausência encerrada para <@${closed.userId}>.\n${roleNote}`,
    fields: absenceFields(closed, settings),
    title: "Cargo de Ausência Removido"
  }));
}

function confirmationActions(absenceId: string, targetUserId: string) {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}:${absenceId}:${targetUserId}`)
        .setLabel("Remover cargo")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${CANCEL_PREFIX}:${absenceId}:${targetUserId}`)
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary)
    )
    .toJSON();
}

function absenceFields(absence: FivemFacAbsence, settings: FivemFacSettings) {
  return [
    `**Usuário:** <@${absence.userId}>\n**Status:** ${absence.status}\n**Periodo:** ${formatDate(absence.startDate)} ate ${formatDate(absence.endDate)}`,
    `**Cargo de ausência:** ${settings.absenceRoleId ? `<@&${settings.absenceRoleId}>` : "Não configurado"}\n**Motivo:** ${truncate(absence.reason, 450)}`
  ];
}

function canModerateAbsences(settings: FivemFacSettings, roleIds: string[]) {
  return settings.approverRoleIds.some((roleId) => roleIds.includes(roleId));
}

function memberRoleIds(member: ButtonInteraction["member"] | GuildMember | null) {
  if (!member || !("roles" in member)) return [];
  if (Array.isArray(member.roles)) return member.roles;
  return member.roles.cache.map((role) => role.id);
}

function pickActiveAbsence(absences: FivemFacAbsence[]) {
  return [...absences]
    .filter((absence) => ACTIVE_STATUSES.has(absence.status))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
}

function ephemeralPanel(input: { actions?: unknown[]; description: string; fields?: string[]; title: string }) {
  const payload = renderComponentsV2Panel({
    accentColor: 0xf97316,
    actions: input.actions,
    description: input.description,
    fields: input.fields,
    moduleId: MODULE_ID,
    title: input.title
  });

  return {
    ...payload,
    flags: Number(payload.flags) | MessageFlags.Ephemeral
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
