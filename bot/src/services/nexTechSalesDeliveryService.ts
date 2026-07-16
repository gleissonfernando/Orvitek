import { MessageFlags, PermissionFlagsBits, type Client, type Guild, type GuildTextBasedChannel } from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { BotContext } from "../types";
import type { NexTechSalePaidEvent } from "../websocket/socketClient";
import { systemEmojiText } from "./systemEmojiService";

const deliveryLocks = new Set<string>();

export function startNexTechSalesDeliveryService(client: Client<true>, context: BotContext) {
  context.socket.onNexTechSalePaid((payload) => {
    void deliverNexTechSale(client, context, payload);
  });
}

async function deliverNexTechSale(client: Client<true>, context: BotContext, payload: NexTechSalePaidEvent) {
  const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;

  if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) {
    return;
  }

  const lockKey = `${payload.guildId}:${payload.saleId}`;
  if (deliveryLocks.has(lockKey)) {
    return;
  }
  deliveryLocks.add(lockKey);

  const deliveredRoleIds: string[] = [];
  const errors: string[] = [];
  let messageId: string | null = null;

  try {
    const guild = await client.guilds.fetch(payload.guildId).catch(() => null);
    if (!guild) {
      throw new Error("O bot não está conectado ao servidor da venda.");
    }

    const member = await guild.members.fetch(payload.buyerId).catch(() => null);
    if (!member) {
      throw new Error("Comprador não encontrado no servidor.");
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      errors.push("Bot sem permissão Gerenciar Cargos.");
    } else {
      const roleIds = unique([payload.customerRoleId ?? null, payload.purchasedRoleId ?? null]);

      for (const roleId of roleIds) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          errors.push(`Cargo ${roleId} não encontrado.`);
          continue;
        }
        if (!role.editable || role.managed) {
          errors.push(`Cargo ${role.name} não pode ser entregue pelo bot.`);
          continue;
        }
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, `Venda Nex Tech paga: ${payload.saleId}`);
        }
        deliveredRoleIds.push(role.id);
      }
    }

    const channel = await resolveDeliveryChannel(guild, payload.saleChannelId ?? payload.logChannelId ?? null);
    if (channel) {
      const message = await channel.send(renderSalePaidMessage(guild, payload, deliveredRoleIds, errors)).catch((error: unknown) => {
        errors.push(error instanceof Error ? error.message : "Falha ao enviar aviso da venda.");
        return null;
      });
      messageId = message?.id ?? null;
    } else {
      errors.push("Canal de aviso de venda não configurado ou inacessível.");
    }

    const status = deliveredRoleIds.length && errors.length ? "partial" : deliveredRoleIds.length ? "delivered" : "failed";
    await context.api.reportNexTechSaleDeliveryResult(payload.guildId, {
      deliveredRoleIds,
      error: errors.join(" | ") || null,
      messageId,
      saleId: payload.saleId,
      status
    });
  } catch (error) {
    await context.api.reportNexTechSaleDeliveryResult(payload.guildId, {
      deliveredRoleIds,
      error: error instanceof Error ? error.message : "Falha ao entregar venda Nex Tech.",
      messageId,
      saleId: payload.saleId,
      status: "failed"
    }).catch(() => null);
  } finally {
    deliveryLocks.delete(lockKey);
  }
}

async function resolveDeliveryChannel(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null;
  return channel;
}

function renderSalePaidMessage(guild: Guild, payload: NexTechSalePaidEvent, deliveredRoleIds: string[], errors: string[]) {
  const productName = payload.productName ?? payload.planName;
  const roleLines = deliveredRoleIds.length
    ? deliveredRoleIds.map((roleId) => `- <@&${roleId}>`).join("\n")
    : "- Nenhum cargo entregue automaticamente.";
  const errorText = errors.length ? `\n\n## Avisos\n${errors.map((error) => `- ${escapeMarkdown(error)}`).join("\n")}` : "";
  const statusEmoji = deliveredRoleIds.length ? systemEmojiText("visto", guild, guild.client) : systemEmojiText("perigo", guild, guild.client);

  return {
    components: [{
      type: 17,
      accent_color: deliveredRoleIds.length ? 0x22c55e : 0xef4444,
      components: [{
        type: 10,
        content: [
          `# ${statusEmoji} Compra aprovada`,
          `Obrigado pela confianca, <@${payload.buyerId}>.`,
          "",
          `**Produto:** ${escapeMarkdown(productName)}`,
          `**Plano:** ${escapeMarkdown(payload.planName)}`,
          `**Valor:** ${formatMoney(payload.amountCents, payload.currency)}`,
          `**Venda:** \`${payload.saleId}\``,
          "",
          "## Cargos liberados",
          roleLines,
          errorText
        ].join("\n")
      }]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value && /^\d{5,32}$/.test(value))))];
}

function formatMoney(cents: number, currency: "BRL" | "USD" | "EUR") {
  return new Intl.NumberFormat("pt-BR", {
    currency,
    style: "currency"
  }).format(cents / 100);
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}
