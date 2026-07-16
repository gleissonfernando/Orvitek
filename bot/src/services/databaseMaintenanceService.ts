import type { Client } from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotContext } from "../types";

export function startDatabaseMaintenanceService(client: Client<true>, context: BotContext) {
  context.socket.onDatabaseMaintenanceDeleteChannels((payload) => {
    const runtimeBotId = currentRuntimeBotId();
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) return;
    void deleteMaintenanceChannels(client, context, {
      channelIds: payload.channelIds,
      guildId: payload.guildId,
      reason: `Manutenção do banco: ${payload.reason}`,
      userId: payload.userId ?? null
    });
  });
}

export async function deleteMaintenanceChannels(
  client: Client,
  context: BotContext,
  input: {
    channelIds: string[];
    guildId: string;
    reason: string;
    userId?: string | null;
  }
) {
  const channelIds = [...new Set(input.channelIds.filter(Boolean))];
  if (!channelIds.length) return { deleted: 0, failed: [] as Array<{ channelId: string; message: string }> };

  const guild = client.guilds.cache.get(input.guildId) ?? await client.guilds.fetch(input.guildId).catch(() => null);
  if (!guild) {
    const failed = channelIds.map((channelId) => ({ channelId, message: "Servidor não encontrado no cache do bot." }));
    await logChannelCleanup(context, input.guildId, input.userId ?? null, 0, failed, input.reason);
    return { deleted: 0, failed };
  }

  let deleted = 0;
  const failed: Array<{ channelId: string; message: string }> = [];

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    try {
      await channel.delete(input.reason);
      deleted += 1;
    } catch (error) {
      failed.push({
        channelId,
        message: error instanceof Error ? error.message : "Falha desconhecida ao apagar canal."
      });
    }
  }

  await logChannelCleanup(context, input.guildId, input.userId ?? null, deleted, failed, input.reason);
  return { deleted, failed };
}

async function logChannelCleanup(
  context: BotContext,
  guildId: string,
  userId: string | null,
  deleted: number,
  failed: Array<{ channelId: string; message: string }>,
  reason: string
) {
  await context.api.postLog({
    guildId,
    message: `Limpeza de canais temporarios concluida: ${deleted} removido(s), ${failed.length} falha(s).`,
    metadata: {
      deleted,
      failed,
      reason
    },
    type: "database_maintenance.channels_deleted",
    userId
  }).catch(() => null);
}
