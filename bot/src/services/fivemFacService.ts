import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type TextBasedChannel
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { FivemFacAbsence, FivemFacSettings } from "./apiClient";

const FAC_PREFIX = "fivem_fac";
const REQUEST_BUTTON_ID = `${FAC_PREFIX}:request`;
const MINE_BUTTON_ID = `${FAC_PREFIX}:mine`;
const REQUEST_MODAL_PREFIX = `${FAC_PREFIX}:request_modal`;
const REJECT_MODAL_PREFIX = `${FAC_PREFIX}:reject_modal`;
const APPROVE_PREFIX = `${FAC_PREFIX}:approve`;
const REJECT_PREFIX = `${FAC_PREFIX}:reject`;
const CLOSE_PREFIX = `${FAC_PREFIX}:close`;
const FAC_CHECK_INTERVAL_MS = 60_000;

let dueCheckRunning = false;

export function startFivemFacService(client: Client, context: BotContext) {
  if (!isBotModuleEnabled("fivem-fac")) {
    return;
  }

  context.socket.onFivemFacSettingsUpdated((payload) => {
    if (!isPayloadForThisBot(payload.botId)) {
      return;
    }

    console.log(`[fivem-fac] configuracao atualizada em tempo real para ${payload.guildId}.`);
  });

  context.socket.onFivemFacPanelPublish((payload) => {
    if (!isPayloadForThisBot(payload.botId)) {
      return;
    }

    void publishFivemFacPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[fivem-fac] falha ao publicar painel em ${payload.guildId}:`, errorMessage(error));
    });
  });

  void context.api.getActiveFivemFacConfigs()
    .then((configs) => console.log(`[fivem-fac] ${configs.length} configuracao(oes) ativa(s) carregada(s).`))
    .catch((error) => console.warn("[fivem-fac] nao foi possivel carregar configuracoes:", errorMessage(error)));

  void processDueFivemFacAbsences(client, context);
  const interval = setInterval(() => {
    void processDueFivemFacAbsences(client, context);
  }, FAC_CHECK_INTERVAL_MS);

  interval.unref();
}

export async function handleFivemFacInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) {
    return false;
  }

  const customId = interaction.customId;

  if (!customId.startsWith(`${FAC_PREFIX}:`)) {
    return false;
  }

  if (!isBotModuleEnabled("fivem-fac")) {
    await replySafely(interaction, "O sistema FAC nao foi liberado para este bot na dashboard.");
    return true;
  }

  if (!interaction.guild) {
    await replySafely(interaction, "Este recurso esta disponivel apenas em servidores.");
    return true;
  }

  if (interaction.isButton()) {
    await handleFivemFacButton(interaction, context);
    return true;
  }

  await handleFivemFacModal(interaction, context);
  return true;
}

async function handleFivemFacButton(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId === REQUEST_BUTTON_ID) {
    await showRequestModal(interaction);
    return;
  }

  if (interaction.customId === MINE_BUTTON_ID) {
    await showMyAbsences(interaction, context);
    return;
  }

  const [prefix, action, absenceId] = interaction.customId.split(":");

  if (prefix !== FAC_PREFIX || !absenceId) {
    await interaction.reply({
      content: "Acao do FAC invalida.",
      ephemeral: true
    });
    return;
  }

  if (action === "approve") {
    await approveAbsence(interaction, context, absenceId);
    return;
  }

  if (action === "reject") {
    await showRejectModal(interaction, absenceId);
    return;
  }

  if (action === "close") {
    await closeAbsence(interaction, context, absenceId);
    return;
  }

  await interaction.reply({
    content: "Acao do FAC nao reconhecida.",
    ephemeral: true
  });
}

async function handleFivemFacModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId.startsWith(`${REQUEST_MODAL_PREFIX}:`)) {
    await submitAbsenceRequest(interaction, context);
    return;
  }

  if (interaction.customId.startsWith(`${REJECT_MODAL_PREFIX}:`)) {
    const absenceId = interaction.customId.slice(`${REJECT_MODAL_PREFIX}:`.length);
    await rejectAbsence(interaction, context, absenceId);
    return;
  }

  await interaction.reply({
    content: "Formulario do FAC nao reconhecido.",
    ephemeral: true
  });
}

async function showRequestModal(interaction: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId(`${REQUEST_MODAL_PREFIX}:${interaction.guildId}`)
    .setTitle("Solicitar Ausencia");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Motivo da ausencia")
        .setMaxLength(800)
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("startDate")
        .setLabel("Data de inicio")
        .setPlaceholder("AAAA-MM-DD ou DD/MM/AAAA")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("endDate")
        .setLabel("Data de termino")
        .setPlaceholder("AAAA-MM-DD ou DD/MM/AAAA")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Observacoes adicionais")
        .setMaxLength(1000)
        .setRequired(false)
        .setStyle(TextInputStyle.Paragraph)
    )
  );

  await interaction.showModal(modal);
}

async function showRejectModal(interaction: ButtonInteraction, absenceId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`${REJECT_MODAL_PREFIX}:${absenceId}`)
    .setTitle("Reprovar Ausencia");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Motivo da reprovacao")
        .setMaxLength(800)
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
    )
  );

  await interaction.showModal(modal);
}

async function submitAbsenceRequest(interaction: ModalSubmitInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  const startDate = normalizeDateInput(interaction.fields.getTextInputValue("startDate"));
  const endDate = normalizeDateInput(interaction.fields.getTextInputValue("endDate"));

  if (!startDate || !endDate) {
    await interaction.editReply("Use apenas datas no formato AAAA-MM-DD ou DD/MM/AAAA. Horarios nao sao aceitos.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);
    const absence = await context.api.createFivemFacAbsence({
      guildId: guild.id,
      userId: interaction.user.id,
      username: interaction.member instanceof Object && "displayName" in interaction.member
        ? interaction.member.displayName
        : interaction.user.username,
      reason: interaction.fields.getTextInputValue("reason"),
      startDate,
      endDate,
      notes: interaction.fields.getTextInputValue("notes") || null
    });
    const channelResult = await createAbsenceChannel(guild, settings, absence);

    if (channelResult.channel && channelResult.messageId) {
      await context.api.updateFivemFacAbsenceChannel(absence.id, {
        privateChannelId: channelResult.channel.id,
        requestMessageId: channelResult.messageId
      });
    }

    await sendFacLog(guild, settings, "Solicitacao criada", absence, interaction.user.id);
    await interaction.editReply(
      channelResult.channel
        ? `${settings.messages.requestCreated}\nCanal privado: <#${channelResult.channel.id}>`
        : `${settings.messages.requestCreated}\nA solicitacao foi salva, mas nao consegui criar o canal privado. Avise a equipe.`
    );
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel criar sua solicitacao de ausencia.");
  }
}

async function showMyAbsences(interaction: ButtonInteraction, context: BotContext) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const absences = await context.api.getFivemFacUserAbsences(guild.id, interaction.user.id);

    if (!absences.length) {
      await interaction.editReply("Voce ainda nao possui ausencias registradas.");
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Minhas ausencias")
          .setDescription(absences.map(formatAbsenceLine).join("\n"))
      ]
    });
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel buscar suas ausencias.");
  }
}

async function approveAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui cargo autorizado para aprovar ausencias.");
      return;
    }

    let absence = await context.api.approveFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction)
    });

    if (absence.startDate <= currentDateKey()) {
      const roleAdded = await addAbsenceRole(guild, settings, absence);
      absence = await context.api.markFivemFacAbsenceStarted(absence.id, roleAdded);
      await sendFacLog(guild, settings, roleAdded ? "Cargo adicionado" : "Ausencia iniciada sem cargo", absence, interaction.user.id);
    }

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, "Solicitacao aprovada", absence, interaction.user.id);
    await notifyAbsenceUser(guild, absence, settings.messages.approved);
    await interaction.editReply("Ausencia aprovada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel aprovar essa ausencia.");
  }
}

async function rejectAbsence(interaction: ModalSubmitInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui cargo autorizado para reprovar ausencias.");
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason");
    const absence = await context.api.rejectFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction),
      reason
    });

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, "Solicitacao reprovada", absence, interaction.user.id, reason);
    await notifyAbsenceUser(guild, absence, `${settings.messages.rejected}\nMotivo: ${reason}`);
    await interaction.editReply("Ausencia reprovada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel reprovar essa ausencia.");
  }
}

async function closeAbsence(interaction: ButtonInteraction, context: BotContext, absenceId: string) {
  await interaction.deferReply({
    ephemeral: true
  });

  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("Servidor nao encontrado.");
    return;
  }

  try {
    const settings = await context.api.getFivemFacSettings(guild.id);

    if (!hasApproverRole(interaction, settings)) {
      await interaction.editReply("Voce nao possui cargo autorizado para encerrar ausencias.");
      return;
    }

    const current = await context.api.getFivemFacAbsence(absenceId);
    const roleRemoved = await removeAbsenceRole(guild, settings, current);
    const absence = await context.api.closeFivemFacAbsence(absenceId, {
      moderatorId: interaction.user.id,
      moderatorRoleIds: interactionRoleIds(interaction),
      roleRemoved
    });

    await updateAbsenceMessage(interaction, settings, absence);
    await sendFacLog(guild, settings, roleRemoved ? "Cargo removido" : "Ausencia encerrada", absence, interaction.user.id);
    await notifyAbsenceUser(guild, absence, "Sua ausencia foi encerrada pela equipe.");
    await interaction.editReply("Ausencia encerrada.");
  } catch (error) {
    await interaction.editReply(readRequestErrorMessage(error) ?? "Nao foi possivel encerrar essa ausencia.");
  }
}

async function publishFivemFacPanel(client: Client, context: BotContext, guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const settings = await context.api.getFivemFacSettings(guildId);

  if (!settings.enabled || !settings.panelChannelId) {
    throw new Error("FAC nao esta ativo ou sem canal de painel.");
  }

  const channel = await guild.channels.fetch(settings.panelChannelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error("Canal de painel FAC invalido.");
  }

  const payload = buildPanelPayload(settings);
  let messageId: string | null = null;

  if (settings.panelMessageId) {
    const oldMessage = await channel.messages.fetch(settings.panelMessageId).catch(() => null);

    if (oldMessage) {
      const edited = await oldMessage.edit(payload);
      messageId = edited.id;
    }
  }

  if (!messageId) {
    const message = await channel.send(payload);
    messageId = message.id;
  }

  await context.api.updateFivemFacPanelState({
    guildId,
    messageId
  });
  await sendFacLog(guild, settings, "Painel publicado", null, client.user?.id ?? null);
  console.log(`[fivem-fac] painel publicado em ${guild.name}.`);
}

async function createAbsenceChannel(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  const panelChannel = settings.panelChannelId
    ? await guild.channels.fetch(settings.panelChannelId).catch(() => null)
    : null;
  const parent = panelChannel && "parentId" in panelChannel ? panelChannel.parentId : null;
  const allowedRoleIds = unique([...settings.viewerRoleIds, ...settings.approverRoleIds]).filter((roleId) => roleId !== guild.id);
  const channel = await guild.channels.create({
    name: `ausencia-${sanitizeChannelName(absence.username ?? absence.userId)}`,
    parent: parent ?? undefined,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: absence.userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...allowedRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }))
    ],
    reason: "Canal privado para solicitacao de ausencia FAC",
    type: ChannelType.GuildText
  });
  const message = await channel.send({
    embeds: [buildAbsenceEmbed(absence)],
    components: buildAbsenceComponents(absence)
  });

  return {
    channel,
    messageId: message.id
  };
}

async function processDueFivemFacAbsences(client: Client, context: BotContext) {
  if (dueCheckRunning || !isBotModuleEnabled("fivem-fac")) {
    return;
  }

  dueCheckRunning = true;

  try {
    const today = currentDateKey();
    const absences = await context.api.getFivemFacDueAbsences(today);

    for (const absence of absences) {
      await processDueAbsence(client, context, absence, today).catch((error) => {
        console.warn(`[fivem-fac] falha ao processar ausencia ${absence.id}:`, errorMessage(error));
      });
    }
  } catch (error) {
    console.warn("[fivem-fac] falha no monitor de datas:", errorMessage(error));
  } finally {
    dueCheckRunning = false;
  }
}

async function processDueAbsence(client: Client, context: BotContext, absence: FivemFacAbsence, today: string) {
  const guild = await client.guilds.fetch(absence.guildId);
  const settings = await context.api.getFivemFacSettings(absence.guildId);
  let current = absence;

  if (current.status === "approved" && current.startDate <= today) {
    const roleAdded = await addAbsenceRole(guild, settings, current);
    current = await context.api.markFivemFacAbsenceStarted(current.id, roleAdded);
    await sendFacLog(guild, settings, roleAdded ? "Cargo adicionado" : "Ausencia iniciada sem cargo", current, null);
    await sendFacLog(guild, settings, "Ausencia iniciada", current, null);
    await notifyAbsenceUser(guild, current, settings.messages.started);
    await updateStoredAbsenceMessage(guild, current);
  }

  if ((current.status === "active" || current.status === "approved") && current.endDate <= today) {
    const roleRemoved = await removeAbsenceRole(guild, settings, current);
    current = await context.api.markFivemFacAbsenceFinished(current.id, roleRemoved);
    await sendFacLog(guild, settings, roleRemoved ? "Cargo removido" : "Ausencia finalizada sem cargo", current, null);
    await sendFacLog(guild, settings, "Ausencia finalizada", current, null);
    await notifyAbsenceUser(guild, current, settings.messages.finished);
    await updateStoredAbsenceMessage(guild, current);
  }
}

async function addAbsenceRole(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (!settings.absenceRoleId) {
    return false;
  }

  const member = await guild.members.fetch(absence.userId).catch(() => null);

  if (!member) {
    return false;
  }

  if (member.roles.cache.has(settings.absenceRoleId)) {
    return true;
  }

  await member.roles.add(settings.absenceRoleId, "Inicio de ausencia FAC");
  return true;
}

async function removeAbsenceRole(guild: Guild, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (!settings.absenceRoleId) {
    return false;
  }

  const member = await guild.members.fetch(absence.userId).catch(() => null);

  if (!member) {
    return false;
  }

  if (!member.roles.cache.has(settings.absenceRoleId)) {
    return true;
  }

  await member.roles.remove(settings.absenceRoleId, "Fim de ausencia FAC");
  return true;
}

async function updateAbsenceMessage(interaction: ButtonInteraction | ModalSubmitInteraction, settings: FivemFacSettings, absence: FivemFacAbsence) {
  if (interaction.isMessageComponent() && interaction.message.editable) {
    await interaction.message.edit({
      embeds: [buildAbsenceEmbed(absence)],
      components: buildAbsenceComponents(absence)
    }).catch(() => null);
    return;
  }

  if (interaction.guild) {
    await updateStoredAbsenceMessage(interaction.guild, absence);
  }
}

async function updateStoredAbsenceMessage(guild: Guild, absence: FivemFacAbsence) {
  if (!absence.privateChannelId || !absence.requestMessageId) {
    return;
  }

  const channel = await guild.channels.fetch(absence.privateChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(absence.requestMessageId).catch(() => null);
  await message?.edit({
    embeds: [buildAbsenceEmbed(absence)],
    components: buildAbsenceComponents(absence)
  }).catch(() => null);
}

async function sendFacLog(
  guild: Guild,
  settings: FivemFacSettings,
  title: string,
  absence: FivemFacAbsence | null,
  actorId: string | null,
  reason?: string | null
) {
  if (!settings.logChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`FAC - ${title}`)
    .setTimestamp(new Date());

  if (absence) {
    embed.addFields(
      { name: "Usuario", value: `<@${absence.userId}>`, inline: true },
      { name: "ID Discord", value: absence.userId, inline: true },
      { name: "Status", value: statusLabel(absence.status), inline: true },
      { name: "Inicio", value: formatDateOnly(absence.startDate), inline: true },
      { name: "Termino", value: formatDateOnly(absence.endDate), inline: true },
      { name: "Moderador", value: actorId ? `<@${actorId}>` : absence.moderatorId ? `<@${absence.moderatorId}>` : "Automatico", inline: true },
      { name: "Motivo", value: truncate(absence.reason, 1024), inline: false }
    );

    if (reason || absence.rejectionReason) {
      embed.addFields({ name: "Detalhe", value: truncate(reason ?? absence.rejectionReason ?? "", 1024), inline: false });
    }
  } else if (actorId) {
    embed.addFields({ name: "Responsavel", value: `<@${actorId}>`, inline: true });
  }

  await channel.send({
    embeds: [embed]
  }).catch(() => null);
}

async function notifyAbsenceUser(guild: Guild, absence: FivemFacAbsence, message: string) {
  const user = await guild.client.users.fetch(absence.userId).catch(() => null);

  await user?.send(message).catch(() => null);

  if (!absence.privateChannelId) {
    return;
  }

  const channel = await guild.channels.fetch(absence.privateChannelId).catch(() => null);

  if (channel?.isTextBased()) {
    await channel.send(`<@${absence.userId}> ${message}`).catch(() => null);
  }
}

function buildPanelPayload(settings: FivemFacSettings) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(settings.messages.panelTitle)
        .setDescription([
          settings.messages.panelDescription,
          "",
          "Use os botoes abaixo para solicitar ausencia ou consultar seus registros.",
          "O sistema usa somente datas, sem horario de inicio ou termino."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(REQUEST_BUTTON_ID)
          .setLabel("Solicitar Ausencia")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(MINE_BUTTON_ID)
          .setLabel("Minhas Ausencias")
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function buildAbsenceEmbed(absence: FivemFacAbsence) {
  const embed = new EmbedBuilder()
    .setColor(statusColor(absence.status))
    .setTitle("Solicitacao de Ausencia")
    .setDescription(absence.notes ? truncate(absence.notes, 1000) : "Sem observacoes adicionais.")
    .addFields(
      { name: "Usuario", value: `<@${absence.userId}>`, inline: true },
      { name: "Status", value: statusLabel(absence.status), inline: true },
      { name: "Periodo", value: `${formatDateOnly(absence.startDate)} ate ${formatDateOnly(absence.endDate)}`, inline: true },
      { name: "Motivo", value: truncate(absence.reason, 1024), inline: false }
    )
    .setFooter({ text: `ID: ${absence.id}` })
    .setTimestamp(new Date(absence.updatedAt));

  if (absence.rejectionReason) {
    embed.addFields({ name: "Motivo da reprovacao", value: truncate(absence.rejectionReason, 1024), inline: false });
  }

  return embed;
}

function buildAbsenceComponents(absence: FivemFacAbsence) {
  const closed = ["rejected", "finished", "closed"].includes(absence.status);
  const pending = absence.status === "pending";

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${APPROVE_PREFIX}:${absence.id}`)
        .setDisabled(!pending)
        .setLabel("Aprovar")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${REJECT_PREFIX}:${absence.id}`)
        .setDisabled(!pending)
        .setLabel("Reprovar")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${CLOSE_PREFIX}:${absence.id}`)
        .setDisabled(closed)
        .setLabel("Encerrar")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function hasApproverRole(interaction: ButtonInteraction | ModalSubmitInteraction, settings: FivemFacSettings) {
  const allowed = new Set(settings.approverRoleIds);
  return interactionRoleIds(interaction).some((roleId) => allowed.has(roleId));
}

function interactionRoleIds(interaction: ButtonInteraction | ModalSubmitInteraction) {
  const member = interaction.member;
  const roleIds = new Set<string>();

  if (interaction.guildId) {
    roleIds.add(interaction.guildId);
  }

  if (!member) {
    return [...roleIds];
  }

  if (member instanceof Object && "roles" in member) {
    const roles = member.roles;

    if (Array.isArray(roles)) {
      roles.forEach((roleId) => roleIds.add(roleId));
    } else if (roles instanceof Object && "cache" in roles) {
      [...(roles as GuildMember["roles"]).cache.keys()].forEach((roleId) => roleIds.add(roleId));
    }
  }

  return [...roleIds];
}

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return trimmed;
  }

  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!brMatch) {
    return null;
  }

  const [, day, month, year] = brMatch;
  return `${year}-${month}-${day}`;
}

function currentDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatAbsenceLine(absence: FivemFacAbsence) {
  return `**${statusLabel(absence.status)}** - ${formatDateOnly(absence.startDate)} ate ${formatDateOnly(absence.endDate)} - ${truncate(absence.reason, 90)}`;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function statusLabel(status: FivemFacAbsence["status"]) {
  const labels: Record<FivemFacAbsence["status"], string> = {
    active: "Ativa",
    approved: "Aprovada",
    closed: "Encerrada",
    finished: "Finalizada",
    pending: "Pendente",
    rejected: "Reprovada"
  };

  return labels[status];
}

function statusColor(status: FivemFacAbsence["status"]) {
  const colors: Record<FivemFacAbsence["status"], number> = {
    active: 0x22c55e,
    approved: 0x3b82f6,
    closed: 0x71717a,
    finished: 0xa1a1aa,
    pending: 0xf59e0b,
    rejected: 0xef4444
  };

  return colors[status];
}

function sanitizeChannelName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "membro";
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isPayloadForThisBot(botId: string | null | undefined) {
  return !botId || !env.DASHBOARD_BOT_ID || botId === env.DASHBOARD_BOT_ID;
}

async function replySafely(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content,
    ephemeral: true
  });
}

function readRequestErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
