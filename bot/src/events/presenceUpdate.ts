import type { Presence } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { handleAutoActivityPresenceUpdate } from "../services/autoActivityClockBotService";
import { handlePresenceUpdate } from "../services/liveService";
import type { BotContext } from "../types";

export async function handlePresenceEvent(oldPresence: Presence | null, newPresence: Presence, context: BotContext) {
  const tasks: Array<Promise<void>> = [];
  if (isBotModuleEnabled("live")) tasks.push(handlePresenceUpdate(context, oldPresence, newPresence));
  if (isBotModuleEnabled("auto-activity-clock")) tasks.push(handleAutoActivityPresenceUpdate(context, oldPresence, newPresence));
  await Promise.all(tasks);
}
