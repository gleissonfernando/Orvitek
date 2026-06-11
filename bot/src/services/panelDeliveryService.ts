import {
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
  type Message
} from "discord.js";

const PANEL_CHANNEL_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
  { flag: PermissionFlagsBits.SendMessages, label: "Send Messages" },
  { flag: PermissionFlagsBits.EmbedLinks, label: "Embed Links" },
  { flag: PermissionFlagsBits.UseExternalEmojis, label: "Use External Emojis" },
  { flag: PermissionFlagsBits.PinMessages, label: "Pin Messages" }
] as const;

export function assertPanelChannelPermissions(channel: GuildTextBasedChannel, client: Client, panelName: string) {
  const botId = client.user?.id;

  if (!botId) {
    throw new Error(`Nao foi possivel validar permissoes do painel ${panelName}: bot nao identificado.`);
  }

  const permissions = channel.permissionsFor(botId);
  const missingPermissions = PANEL_CHANNEL_PERMISSIONS
    .filter((permission) => !permissions?.has(permission.flag))
    .map((permission) => permission.label);

  if (missingPermissions.length) {
    throw new Error(`Bot sem permissao para enviar/fixar o painel ${panelName}: ${missingPermissions.join(", ")}.`);
  }
}

export async function pinPanelMessage(message: Message, panelName: string) {
  if (message.pinned) {
    return;
  }

  try {
    await message.pin(`Painel ${panelName} publicado pela dashboard.`);
  } catch (error) {
    throw new Error(`Nao foi possivel fixar o painel ${panelName}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
