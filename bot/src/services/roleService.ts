import type { GuildMember, Role } from "discord.js";
import type { BotContext } from "../types";

const MAX_AUTOMATIC_ROLES = 2;
const ROLE_ASSIGNMENT_ATTEMPTS = 3;
const ROLE_ASSIGNMENT_RETRY_MS = 1_500;

export async function applyAutomaticRoles(context: BotContext, member: GuildMember, includeBoosterRole = true) {
  if (member.user.bot) {
    return;
  }

  const settings = await loadSettings(context, member);

  if (!settings?.autoRoleEnabled) {
    return;
  }

  const roleIds = new Set(settings.autoRoleIds.slice(0, MAX_AUTOMATIC_ROLES));

  if (includeBoosterRole && member.premiumSince && settings.boosterRoleId) {
    roleIds.add(settings.boosterRoleId);
  }

  if (!roleIds.size) {
    return;
  }

  let roles: Role[];

  try {
    roles = await resolveAssignableRoles(member, [...roleIds]);
  } catch (error) {
    void writeRoleLog(context, member, settings.botId, "dashboard.roles.assignment_failed", "Falha ao verificar os cargos automaticos.", {
      error: errorMessage(error),
      roleIds: [...roleIds]
    });
    console.error(
      `[roles] falha ao verificar cargos em ${member.guild.name}:`,
      errorMessage(error)
    );
    return;
  }

  if (!roles.length) {
    void writeRoleLog(context, member, settings.botId, "dashboard.roles.assignment_failed", "Nenhum cargo automatico pode ser atribuido.", {
      roleIds: [...roleIds]
    });
    console.warn(`[roles] nenhum cargo configurado pode ser atribuido em ${member.guild.name}.`);
    return;
  }

  const missingRoleIds = roles
    .map((role) => role.id)
    .filter((roleId) => !member.roles.cache.has(roleId));

  if (!missingRoleIds.length) {
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ROLE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    try {
      await member.roles.add(missingRoleIds, "Cargos automaticos via dashboard");
      const refreshedMember = await member.fetch();
      const rolesStillMissing = missingRoleIds.filter((roleId) => !refreshedMember.roles.cache.has(roleId));

      if (rolesStillMissing.length) {
        throw new Error(`Discord nao confirmou os cargos: ${rolesStillMissing.join(", ")}.`);
      }

      void writeRoleLog(context, member, settings.botId, "dashboard.roles.assigned", `${missingRoleIds.length} cargo(s) automatico(s) aplicado(s).`, {
        roleIds: missingRoleIds
      });
      console.log(`[roles] ${missingRoleIds.length} cargo(s) aplicado(s) a ${member.user.tag} em ${member.guild.name}.`);
      return;
    } catch (error) {
      lastError = error;

      if (attempt < ROLE_ASSIGNMENT_ATTEMPTS) {
        await delay(ROLE_ASSIGNMENT_RETRY_MS);
      }
    }
  }

  void writeRoleLog(context, member, settings.botId, "dashboard.roles.assignment_failed", "Nao foi possivel aplicar os cargos automaticos.", {
    error: errorMessage(lastError),
    roleIds: missingRoleIds
  });
  console.error(
    `[roles] falha ao aplicar cargos a ${member.user.tag} em ${member.guild.name}:`,
    errorMessage(lastError)
  );
}

async function loadSettings(context: BotContext, member: GuildMember) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ROLE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    try {
      return await context.api.getSettings(member.guild.id, member.client.user.id);
    } catch (error) {
      lastError = error;

      if (attempt < ROLE_ASSIGNMENT_ATTEMPTS) {
        await delay(ROLE_ASSIGNMENT_RETRY_MS);
      }
    }
  }

  console.error(
    `[roles] nao foi possivel carregar as configuracoes de ${member.guild.name}:`,
    errorMessage(lastError)
  );
  return null;
}

async function resolveAssignableRoles(member: GuildMember, roleIds: string[]) {
  await member.guild.members.fetchMe();
  const availableRoles = await member.guild.roles.fetch();

  return roleIds
    .map((roleId) => availableRoles.get(roleId))
    .filter((role): role is Role => Boolean(role?.editable));
}

async function writeRoleLog(
  context: BotContext,
  member: GuildMember,
  botId: string | null,
  type: string,
  message: string,
  metadata: Record<string, unknown>
) {
  await context.api.postLog({
    botId,
    guildId: member.guild.id,
    userId: member.id,
    type,
    message,
    metadata
  }).catch(() => null);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
