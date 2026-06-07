import type { GuildMember, Role } from "discord.js";
import type { BotContext } from "../types";

export async function applyAutomaticRoles(context: BotContext, member: GuildMember, includeBoosterRole = true) {
  if (member.user.bot) {
    return;
  }

  const settings = await context.api.getSettings(member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.autoRoleEnabled) {
    return;
  }

  const roleIds = new Set(settings.autoRoleIds);

  if (includeBoosterRole && member.premiumSince && settings.boosterRoleId) {
    roleIds.add(settings.boosterRoleId);
  }

  if (!roleIds.size) {
    return;
  }

  const roles = [...roleIds]
    .map((roleId) => member.guild.roles.cache.get(roleId))
    .filter((role): role is Role => Boolean(role?.editable));

  if (!roles.length) {
    console.warn(`[roles] nenhum cargo configurado pode ser atribuido em ${member.guild.name}.`);
    return;
  }

  await member.roles.add(roles, "Cargos automaticos via dashboard");
}
