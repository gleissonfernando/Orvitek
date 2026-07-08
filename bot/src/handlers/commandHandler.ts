import { REST, Routes } from "discord.js";
import { env } from "../config/env";
import type { BotCommand, BotContext } from "../types";

export async function registerGuildCommands(commands: BotCommand[], clientId: string, guildId: string, context?: BotContext) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado.");
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

  const registered = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((command) => command.data.toJSON())
  }) as Array<{ id: string; name: string }>;

  if (!context) return;

  const registeredByName = new Map(registered.map((command) => [command.name, command.id]));

  for (const command of commands) {
    if (!command.syncPermissions) continue;
    const applicationCommandId = registeredByName.get(command.data.name);
    if (!applicationCommandId) continue;

    await command.syncPermissions({
      applicationCommandId,
      applicationId: clientId,
      context,
      guildId
    });
  }
}
