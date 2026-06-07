import type { Client } from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import { registerGuildCommands } from "../handlers/commandHandler";
import { startSocialNotificationMonitor } from "../services/socialNotificationMonitor";
import type { BotContext } from "../types";

export async function handleReady(client: Client<true>, context: BotContext) {
  console.log(`[bot] conectado como ${client.user.tag}`);
  context.api.setDiscordClientId(client.user.id);

  if (env.BOT_MAIN_GUILD_ID) {
    try {
      await registerGuildCommands([...context.commands.values()], client.user.id, env.BOT_MAIN_GUILD_ID);
      console.log(`[bot] comandos sincronizados no servidor ${env.BOT_MAIN_GUILD_ID}`);
    } catch (error) {
      console.warn("[bot] falha ao sincronizar comandos:", error instanceof Error ? error.message : error);
    }
  }

  context.socket.connect(client);
  context.socket.emitStatus(client, true);
  if (isBotModuleEnabled("live")) {
    startSocialNotificationMonitor(client, context.api);
  }

  const interval = setInterval(() => {
    context.socket.emitStatus(client, true);
  }, 30_000);

  interval.unref();
}
