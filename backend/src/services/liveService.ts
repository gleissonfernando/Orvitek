import { randomUUID } from "node:crypto";

export type LiveEventDto = {
  id: string;
  botId: string | null;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
  createdAt: string;
};

const liveEvents: LiveEventDto[] = [];

export function createLiveEvent(input: Omit<LiveEventDto, "id" | "createdAt">) {
  const event: LiveEventDto = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
    botId: normalizeBotId(input.botId)
  };

  liveEvents.unshift(event);
  return event;
}

export function listLiveEvents(guildId?: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  return liveEvents
    .filter((event) => (!guildId || event.guildId === guildId) && event.botId === normalizedBotId)
    .slice(0, 50);
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}
