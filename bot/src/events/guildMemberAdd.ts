import type { GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { enforceAccountAgeSecurity } from "../services/accountAgeSecurityService";
import { logMemberJoin } from "../services/logService";
import { applyAutomaticRoles } from "../services/roleService";
import { sendWelcomeMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberAdd(member: GuildMember, context: BotContext) {
  const blocked = await enforceAccountAgeSecurity(context, member);

  if (blocked) {
    return;
  }

  const tasks: Promise<unknown>[] = [];
  const welcomeEnabled = isBotModuleEnabled("welcome");
  const rolesEnabled = isBotModuleEnabled("roles");

  if (isBotModuleEnabled("logs")) tasks.push(logMemberJoin(context, member));
  if (welcomeEnabled || rolesEnabled) tasks.push(applyAutomaticRoles(context, member, rolesEnabled));
  if (welcomeEnabled) tasks.push(sendWelcomeMessage(context, member));

  await Promise.allSettled(tasks);
}
