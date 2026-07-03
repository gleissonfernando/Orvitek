import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { ManualPaymentOrder, ManualPaymentOrderStatus, ManualPaymentService, ManualPaymentSettings } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "manual_pay";

export function startManualPaymentService(client: Client<true>, context: BotContext) {
  context.socket.onManualPaymentPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishManualPaymentPanel(guild, context);
  });
}

export async function handleManualPaymentInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:buy:`)) { await startPurchase(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:pix_key:`)) { await choosePaymentMethod(interaction, context, "PIX_KEY"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:pix_qr:`)) { await choosePaymentMethod(interaction, context, "PIX_QR_CODE"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:paid:`)) { await askProof(interaction); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:cancel_customer:`)) { await customerCancel(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:approve:`)) { await approvePayment(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:reject:`)) { await showReasonModal(interaction, "reject"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:new_proof:`)) { await requestNewProof(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:cancel_staff:`)) { await showReasonModal(interaction, "cancel_staff"); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:open:`)) { await openOrderChannel(interaction); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:status:`)) { await setServiceStatus(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:finish:`)) { await finishOrder(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:support:`)) { await openSupport(interaction); return true; }
  if (interaction.isButton() && (interaction.customId.startsWith(`${PREFIX}:add_staff:`) || interaction.customId.startsWith(`${PREFIX}:remove_staff:`) || interaction.customId.startsWith(`${PREFIX}:send_data:`))) { await interaction.reply({ content: "Use as permissoes do canal para ajustar equipe ou envie os dados diretamente neste atendimento.", ephemeral: true }); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:reason:`)) { await submitReason(interaction, context); return true; }
  return false;
}

export async function handleManualPaymentMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.attachments.size) return false;
  const runtime = await context.api.getManualPaymentRuntime(message.guild.id).catch(() => null);
  const order = runtime?.orders.find((item) => item.paymentChannelId === message.channelId && ["PENDING_PAYMENT", "REJECTED"].includes(item.status));
  if (!runtime || !order || order.userId !== message.author.id) return false;
  const attachment = message.attachments.find((item) => item.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif|pdf)$/i.test(item.url));
  if (!attachment) return false;
  const updated = await context.api.updateManualPaymentOrder(message.guild.id, order.id, {
    action: "proof_uploaded",
    channelId: message.channelId,
    proofMessageId: message.id,
    proofUrl: attachment.url,
    status: "WAITING_STAFF_APPROVAL"
  });
  await message.react("✅").catch(() => null);
  await refreshPaymentPanel(message.guild, context, runtime.settings, updated);
  await sendStaffApprovalLog(message.guild, context, runtime.settings, updated);
  return true;
}

async function publishManualPaymentPanel(guild: Guild, context: BotContext, fallbackChannelId?: string | null) {
  const { settings } = await context.api.getManualPaymentRuntime(guild.id);
  if (!settings.enabled) return null;
  const channelId = settings.salePanelChannelId ?? fallbackChannelId ?? null;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = createSalesPanel(settings);
  let message = settings.salePanelMessageId && "messages" in channel ? await channel.messages.fetch(settings.salePanelMessageId).catch(() => null) : null;
  if (message) await message.edit(payload).catch(() => null); else message = await channel.send(payload);
  await context.api.updateManualPaymentPanelState(guild.id, message.id);
  return channel.id;
}

function createSalesPanel(settings: ManualPaymentSettings) {
  const services = settings.services.filter((item) => item.active).sort((a, b) => a.order - b.order).slice(0, 10);
  const actions: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < services.length; index += 5) {
    actions.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      services.slice(index, index + 5).map((service) => new ButtonBuilder().setCustomId(`${PREFIX}:buy:${service.id}`).setLabel(`Comprar ${service.name}`.slice(0, 80)).setStyle(ButtonStyle.Success))
    ));
  }
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions,
    description: settings.salePanelDescription,
    fields: services.map((service) => `**${service.name}** - ${money(service.amount)}\n${service.description ?? "Servico disponivel para compra."}`),
    image: settings.bannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.bannerUrl } : null,
    moduleId: "manual-payments",
    title: settings.salePanelTitle
  });
}

async function startPurchase(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const serviceId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const service = runtime.settings.services.find((item) => item.id === serviceId && item.active);
  if (!runtime.settings.enabled || !service) return interaction.editReply("Servico indisponivel.");
  const order = await context.api.createManualPaymentOrder(interaction.guild.id, { serviceId, userId: interaction.user.id, username: interaction.user.username });
  if (order.paymentChannelId) return interaction.editReply(`Voce ja tem um canal para este pedido: <#${order.paymentChannelId}>.`);
  const channel = await createPaymentChannel(interaction.guild, runtime.settings, order, interaction.user.id);
  const updated = await context.api.updateManualPaymentOrder(interaction.guild.id, order.id, { action: "payment_channel_created", paymentChannelId: channel.id });
  const message = await channel.send(createPaymentPanel(runtime.settings, updated, service));
  await context.api.updateManualPaymentOrder(interaction.guild.id, order.id, { action: "payment_panel_sent", paymentMessageId: message.id });
  setTimeout(() => void expirePaymentChannel(interaction.guild!, context, updated.id), Math.max(5, runtime.settings.maxPaymentMinutes) * 60_000).unref();
  await interaction.editReply(`Pedido criado: <#${channel.id}>.`);
}

async function createPaymentChannel(guild: Guild, settings: ManualPaymentSettings, order: ManualPaymentOrder, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const staffRoleIds = [...new Set([...settings.approveRoleIds, ...settings.rejectRoleIds, ...settings.logViewRoleIds])];
  return guild.channels.create({
    name: `pagamento-${slug(member?.displayName ?? order.username ?? userId)}-${String(order.orderNumber).padStart(3, "0")}`.slice(0, 90),
    parent: settings.paymentCategoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    reason: `Pagamento manual pedido ${order.orderNumber}`,
    type: ChannelType.GuildText
  }) as Promise<TextChannel>;
}

function createPaymentPanel(settings: ManualPaymentSettings, order: ManualPaymentOrder, service?: ManualPaymentService | null) {
  const actions = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pix_key:${order.id}`).setLabel("Pagar com chave Pix").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pix_qr:${order.id}`).setLabel("Pagar com QR Code").setStyle(ButtonStyle.Primary).setDisabled(!settings.pixQrCodeUrl),
      new ButtonBuilder().setCustomId(`${PREFIX}:paid:${order.id}`).setLabel("Ja fiz o pagamento").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:cancel_customer:${order.id}`).setLabel("Cancelar compra").setStyle(ButtonStyle.Danger)
    )
  ];
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions,
    description: `Pedido **#${String(order.orderNumber).padStart(3, "0")}** - ${statusLabel(order.status)}`,
    fields: [
      `**Cliente:** <@${order.userId}>\n**Servico:** ${order.serviceName}\n**Valor:** ${money(order.amount)}\n**Status:** ${statusLabel(order.status)}`,
      `**Instrucoes**\n${service?.customText ?? settings.paymentInstructions}`,
      `**Pix**\nRecebedor: ${settings.receiverName ?? "Nao informado"}\nBanco: ${settings.receiverBank ?? "Nao informado"}\nChave: ${settings.pixKey ?? "Nao configurada"}`,
      order.proofUrl ? `**Comprovante:** [abrir arquivo](${order.proofUrl})` : "**Comprovante:** aguardando envio neste canal."
    ],
    image: settings.pixQrCodeUrl && order.paymentMethod === "PIX_QR_CODE" ? { imageEnabled: true, imagePosition: "bottom", imageUrl: settings.pixQrCodeUrl } : null,
    moduleId: "manual-payments",
    title: "Pagamento manual"
  });
}

async function choosePaymentMethod(interaction: ButtonInteraction, context: BotContext, paymentMethod: "PIX_KEY" | "PIX_QR_CODE") {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: paymentMethod === "PIX_KEY" ? "pix_key_selected" : "pix_qr_selected", channelId: interaction.channelId, paymentMethod });
  await refreshPaymentPanel(interaction.guild, context, runtime.settings, order);
  await interaction.reply({ content: paymentMethod === "PIX_KEY" ? `**Chave Pix:** \`${runtime.settings.pixKey ?? "nao configurada"}\`` : runtime.settings.pixQrCodeUrl ? `QR Code: ${runtime.settings.pixQrCodeUrl}` : "QR Code nao configurado.", ephemeral: true });
}

async function askProof(interaction: ButtonInteraction) {
  await interaction.reply({ content: "Envie o comprovante como imagem ou arquivo neste canal. O pedido so vai para aprovacao depois do anexo.", ephemeral: true });
}

async function customerCancel(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "cancelled_by_customer", channelId: interaction.channelId, status: "CANCELLED_BY_CUSTOMER" });
  await interaction.editReply("Compra cancelada.");
  setTimeout(() => void interaction.guild?.channels.cache.get(order.paymentChannelId ?? "")?.delete("Compra cancelada pelo cliente").catch(() => null), 2000).unref();
}

async function sendStaffApprovalLog(guild: Guild, context: BotContext, settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  if (!settings.logChannelId) return null;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = renderComponentsV2Panel({
    accentColor: 0xf59e0b,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${order.id}`).setLabel("Aprovar pagamento").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${order.id}`).setLabel("Recusar pagamento").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${PREFIX}:new_proof:${order.id}`).setLabel("Solicitar novo comprovante").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setLabel("Abrir canal").setStyle(ButtonStyle.Link).setURL(order.paymentChannelId ? `https://discord.com/channels/${guild.id}/${order.paymentChannelId}` : `https://discord.com/channels/${guild.id}`)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel_staff:${order.id}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger)
      )
    ],
    description: `Pedido #${String(order.orderNumber).padStart(3, "0")} aguardando aprovacao manual.`,
    fields: [`Cliente: <@${order.userId}>\nServico: **${order.serviceName}**\nValor: **${money(order.amount)}**\nStatus: ${statusLabel(order.status)}\nCanal: ${order.paymentChannelId ? `<#${order.paymentChannelId}>` : "nao informado"}`, order.proofUrl ? `Comprovante: ${order.proofUrl}` : "Sem comprovante."],
    image: order.proofUrl ? { imageEnabled: true, imagePosition: "bottom", imageUrl: order.proofUrl } : null,
    moduleId: "manual-payments",
    title: "Aprovacao de pagamento"
  });
  const message = await channel.send(payload);
  await context.api.updateManualPaymentOrder(guild.id, order.id, { action: "staff_log_sent", staffMessageId: message.id });
  return message;
}

async function approvePayment(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const orderId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.approveRoleIds))) return interaction.editReply("Voce nao pode aprovar pagamentos.");
  const current = await context.api.getManualPaymentOrder(interaction.guild.id, orderId);
  if (!current?.proofUrl) return interaction.editReply("Nao e possivel aprovar sem comprovante.");
  const approved = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "payment_approved", channelId: interaction.channelId, staffId: interaction.user.id, status: "APPROVED" });
  const serviceChannel = await createServiceChannel(interaction.guild, runtime.settings, approved, interaction.user.id);
  const updated = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "service_channel_created", serviceChannelId: serviceChannel.id, staffId: interaction.user.id, status: "IN_PROGRESS" });
  await serviceChannel.send(createServicePanel(runtime.settings, updated));
  if (approved.paymentChannelId) setTimeout(() => void interaction.guild?.channels.cache.get(approved.paymentChannelId ?? "")?.delete("Pagamento aprovado").catch(() => null), 3000).unref();
  await interaction.editReply(`Pagamento aprovado. Atendimento criado: <#${serviceChannel.id}>.`);
}

async function createServiceChannel(guild: Guild, settings: ManualPaymentSettings, order: ManualPaymentOrder, staffId: string) {
  const staffRoleIds = [...new Set([...settings.approveRoleIds, ...settings.finalizeRoleIds, ...settings.logViewRoleIds])];
  return guild.channels.create({
    name: `atendimento-${slug(order.username ?? order.userId)}-${String(order.orderNumber).padStart(3, "0")}`.slice(0, 90),
    parent: settings.attendanceCategoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: order.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
      { id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
    ],
    reason: `Atendimento pedido ${order.orderNumber}`,
    type: ChannelType.GuildText
  }) as Promise<TextChannel>;
}

function createServicePanel(settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.color),
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:send_data:${order.id}`).setLabel("Enviar dados").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:IN_PROGRESS:${order.id}`).setLabel("Em producao").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:WAITING_CUSTOMER:${order.id}`).setLabel("Aguardando cliente").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status:DELIVERED:${order.id}`).setLabel("Marcar entregue").setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:finish:${order.id}`).setLabel("Acabou / Finalizar pedido").setStyle(ButtonStyle.Danger).setDisabled(order.status !== "DELIVERED"),
        new ButtonBuilder().setCustomId(`${PREFIX}:support:${order.id}`).setLabel("Abrir suporte").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:add_staff:${order.id}`).setLabel("Adicionar staff").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:remove_staff:${order.id}`).setLabel("Remover staff").setStyle(ButtonStyle.Secondary)
      )
    ],
    description: `Pedido #${String(order.orderNumber).padStart(3, "0")} - ${statusLabel(order.status)}`,
    fields: [`Cliente: <@${order.userId}>\nServico: **${order.serviceName}**\nValor pago: **${money(order.amount)}**\nAprovado por: ${order.approvedBy ? `<@${order.approvedBy}>` : "staff"}`, "Cliente e equipe podem conversar neste canal ate a entrega. Depois de finalizado, use apenas o sistema de ticket/suporte."],
    image: settings.bannerUrl ? { imageEnabled: true, imagePosition: "top", imageUrl: settings.bannerUrl } : null,
    moduleId: "manual-payments",
    title: "Atendimento / Producao"
  });
}

async function setServiceStatus(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const [, , status, orderId] = interaction.customId.split(":");
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.finalizeRoleIds))) return interaction.editReply("Voce nao pode atualizar este atendimento.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId ?? "", { action: `status_${status}`, channelId: interaction.channelId, staffId: interaction.user.id, status: status as ManualPaymentOrderStatus });
  await interaction.message.edit(createServicePanel(runtime.settings, order)).catch(() => null);
  await interaction.editReply(`Status atualizado para ${statusLabel(order.status)}.`);
}

async function finishOrder(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.finalizeRoleIds))) return interaction.editReply("Voce nao pode finalizar este pedido.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "order_finished", channelId: interaction.channelId, staffId: interaction.user.id, status: "FINISHED" });
  await interaction.editReply("Pedido finalizado. Este canal sera fechado.");
  if (order.serviceChannelId) setTimeout(() => void interaction.guild?.channels.cache.get(order.serviceChannelId ?? "")?.delete("Pedido finalizado").catch(() => null), 5000).unref();
}

async function showReasonModal(interaction: ButtonInteraction, kind: "reject" | "cancel_staff") {
  const orderId = interaction.customId.split(":")[2] ?? "";
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:reason:${kind}:${orderId}`).setTitle(kind === "reject" ? "Recusar pagamento" : "Cancelar pedido");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo").setRequired(true).setStyle(TextInputStyle.Paragraph)));
  await interaction.showModal(modal);
}

async function submitReason(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const [, , kind, orderId] = interaction.customId.split(":");
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  const roleIds = kind === "reject" ? runtime.settings.rejectRoleIds : runtime.settings.finalizeRoleIds;
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, roleIds))) return interaction.editReply("Voce nao possui permissao.");
  const reason = interaction.fields.getTextInputValue("reason");
  const status = kind === "reject" ? "REJECTED" : "CANCELLED_BY_STAFF";
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId ?? "", { action: kind === "reject" ? "payment_rejected" : "cancelled_by_staff", channelId: interaction.channelId, reason, staffId: interaction.user.id, status });
  if (kind === "reject" && order.paymentChannelId) {
    const channel = interaction.guild.channels.cache.get(order.paymentChannelId);
    if (channel?.isSendable()) await channel.send(`Pagamento recusado: **${reason}**\nEnvie um novo comprovante ou cancele a compra.`).catch(() => null);
  }
  await interaction.editReply(kind === "reject" ? "Pagamento recusado." : "Pedido cancelado.");
}

async function requestNewProof(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const orderId = interaction.customId.split(":")[2] ?? "";
  await interaction.deferReply({ ephemeral: true });
  const runtime = await context.api.getManualPaymentRuntime(interaction.guild.id);
  if (!(await hasAnyRole(interaction.guild, interaction.user.id, runtime.settings.rejectRoleIds))) return interaction.editReply("Voce nao pode solicitar comprovante.");
  const order = await context.api.updateManualPaymentOrder(interaction.guild.id, orderId, { action: "new_proof_requested", channelId: interaction.channelId, staffId: interaction.user.id, status: "PENDING_PAYMENT" });
  const channel = order.paymentChannelId ? interaction.guild.channels.cache.get(order.paymentChannelId) : null;
  if (channel?.isSendable()) await channel.send(`<@${order.userId}> envie um novo comprovante neste canal.`).catch(() => null);
  await interaction.editReply("Novo comprovante solicitado.");
}

async function refreshPaymentPanel(guild: Guild, context: BotContext, settings: ManualPaymentSettings, order: ManualPaymentOrder) {
  if (!order.paymentChannelId || !order.paymentMessageId) return;
  const channel = await guild.channels.fetch(order.paymentChannelId).catch(() => null);
  if (!channel || !("messages" in channel)) return;
  const message = await channel.messages.fetch(order.paymentMessageId).catch(() => null);
  if (message) await message.edit(createPaymentPanel(settings, order, settings.services.find((item) => item.id === order.serviceId))).catch(() => null);
}

async function expirePaymentChannel(guild: Guild, context: BotContext, orderId: string) {
  const runtime = await context.api.getManualPaymentRuntime(guild.id).catch(() => null);
  const order = runtime?.orders.find((item) => item.id === orderId);
  if (!runtime || !order || order.status !== "PENDING_PAYMENT") return;
  await context.api.updateManualPaymentOrder(guild.id, order.id, { action: "payment_expired", status: "CANCELLED_BY_STAFF", reason: "Tempo maximo de pagamento expirado." }).catch(() => null);
  if (order.paymentChannelId) await guild.channels.cache.get(order.paymentChannelId)?.delete("Pagamento expirado").catch(() => null);
}

async function openOrderChannel(interaction: ButtonInteraction) {
  await interaction.reply({ content: "Use o botao/link do proprio Discord para abrir o canal do pedido.", ephemeral: true });
}

async function openSupport(interaction: ButtonInteraction) {
  await interaction.reply({ content: "Depois da finalizacao, use o painel normal de tickets/suporte do servidor.", ephemeral: true });
}

async function hasAnyRole(guild: Guild, userId: string, roleIds: string[]) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some((role) => roleIds.includes(role.id));
}

function statusLabel(status: ManualPaymentOrderStatus) {
  return ({
    APPROVED: "Pagamento aprovado",
    CANCELLED_BY_CUSTOMER: "Cancelado pelo cliente",
    CANCELLED_BY_STAFF: "Cancelado pelo staff",
    DELIVERED: "Servico entregue",
    FINISHED: "Finalizado",
    IN_PROGRESS: "Em producao",
    PENDING_PAYMENT: "Aguardando pagamento",
    REJECTED: "Pagamento recusado",
    WAITING_CUSTOMER: "Aguardando cliente",
    WAITING_STAFF_APPROVAL: "Aguardando aprovacao do staff"
  } as const)[status];
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x22c55e;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";
}
