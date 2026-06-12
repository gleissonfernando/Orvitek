import type { Message } from "discord.js";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { handleLinkAntiSpamMessage } from "../services/linkAntiSpamService";
import type { BotContext } from "../types";

export async function handleMessageCreate(message: Message, context: BotContext) {
  const linkBlocked = await handleLinkAntiSpamMessage(message, context);

  if (linkBlocked) {
    return;
  }

  await handleImageAntiSpamMessage(message, context);
}
