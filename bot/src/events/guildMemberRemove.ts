import type { GuildMember, PartialGuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { scheduleHierarchyRefresh } from "../services/fivemHierarchyService";
import { logMemberLeave } from "../services/logService";
import { sendLeaveMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember, context: BotContext) {
  const tasks: Promise<unknown>[] = [];

  if (isBotModuleEnabled("logs")) tasks.push(logMemberLeave(context, member));
  if (isBotModuleEnabled("leave")) tasks.push(sendLeaveMessage(context, member));
  if (isBotModuleEnabled("fivem-hierarchy")) scheduleHierarchyRefresh(member.guild, context);

  await Promise.allSettled(tasks);
}
