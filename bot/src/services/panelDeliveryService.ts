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
  { flag: PermissionFlagsBits.UseExternalEmojis, label: "Use External Emojis" }
] as const;
const PANEL_PIN_PERMISSION = [
  { flag: PermissionFlagsBits.PinMessages, label: "Pin Messages" }
] as const;

export function assertPanelChannelPermissions(channel: GuildTextBasedChannel, client: Client, panelName: string, options: { requirePinMessages?: boolean } = {}) {
  const botId = client.user?.id;

  if (!botId) {
    throw new Error(`Não foi possível validar permissoes do painel ${panelName}: bot não identificado.`);
  }

  const permissions = channel.permissionsFor(botId);
  const requiredPermissions = options.requirePinMessages === false
    ? PANEL_CHANNEL_PERMISSIONS
    : [...PANEL_CHANNEL_PERMISSIONS, ...PANEL_PIN_PERMISSION];
  const missingPermissions = requiredPermissions
    .filter((permission) => !permissions?.has(permission.flag))
    .map((permission) => permission.label);

  if (missingPermissions.length) {
    const action = options.requirePinMessages === false ? "enviar" : "enviar/fixar";
    throw new Error(`Bot sem permissão para ${action} o painel ${panelName}: ${missingPermissions.join(", ")}.`);
  }
}

export async function pinPanelMessage(message: Message, panelName: string) {
  if (message.pinned) {
    return;
  }

  try {
    await message.pin(`Painel ${panelName} publicado pela dashboard.`);
  } catch (error) {
    throw new Error(`Não foi possível fixar o painel ${panelName}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
