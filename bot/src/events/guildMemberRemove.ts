import type { GuildMember, PartialGuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { deleteMaintenanceChannels } from "../services/databaseMaintenanceService";
import { scheduleHierarchyMemberRemoval } from "../services/fivemHierarchyService";
import { logMemberLeave } from "../services/logService";
import { sendLeaveMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember, context: BotContext) {
  const tasks: Promise<unknown>[] = [];

  if (isBotModuleEnabled("logs")) tasks.push(logMemberLeave(context, member));
  if (isBotModuleEnabled("leave")) tasks.push(sendLeaveMessage(context, member));
  if (isBotModuleEnabled("fivem-hierarchy")) scheduleHierarchyMemberRemoval(member.guild, context, member.id);
  tasks.push(cleanupMemberDatabaseLinks(member, context));

  await Promise.allSettled(tasks);
}

async function cleanupMemberDatabaseLinks(member: GuildMember | PartialGuildMember, context: BotContext) {
  const result = await context.api.cleanupUserLinksAfterGuildLeave(member.guild.id, member.id);
  await deleteMaintenanceChannels(context.client, context, {
    channelIds: result.channelIds,
    guildId: member.guild.id,
    reason: "Usuario saiu do servidor; limpeza automatica de vinculos.",
    userId: member.id
  });
}
