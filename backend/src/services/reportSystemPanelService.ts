import axios from "axios";
import type { GuildSettingsDto } from "./settingsService";

const DISCORD_API = "https://discord.com/api/v10";
const PANEL_SELECT_ID = "iab_report_select";
const COMPONENTS_V2_FLAG = 1 << 15;

type DiscordMessage = {
  id: string;
};

export async function publishReportSystemPanelToDiscord(settings: GuildSettingsDto, botToken: string | null) {
  if (!botToken) {
    throw new Error("Token do bot nao configurado para publicar o painel de denuncias.");
  }

  const report = settings.reportSystem;

  if (!report.enabled) {
    throw new Error("Ative o sistema Denuncias Corregedoria antes de publicar o painel.");
  }

  if (!report.panelChannelId) {
    throw new Error("Selecione o canal onde o painel sera publicado.");
  }

  const options = report.categories
    .filter((category) => category.enabled)
    .slice(0, 25)
    .map((category) => ({
      label: category.name.slice(0, 100),
      value: category.id.slice(0, 100),
      ...(category.description ? { description: category.description.slice(0, 100) } : {}),
      ...(category.emoji ? { emoji: parseEmoji(category.emoji) } : {})
    }));

  if (!options.length) {
    throw new Error("Ative pelo menos um orgao/categoria antes de publicar.");
  }

  const payload = {
    components: [
      {
        type: 17,
        accent_color: parseColor(report.panelColor),
        components: [
          { type: 10, content: `# ${report.panelEmoji ?? "🛡️"} ${report.panelTitle}\n${report.panelDescription}`.slice(0, 4000) },
          ...(report.infoMessage ? [{ type: 10, content: report.infoMessage.slice(0, 4000) }] : []),
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: PANEL_SELECT_ID,
                placeholder: report.panelPlaceholder.slice(0, 150),
                min_values: 1,
                max_values: 1,
                options
              }
            ]
          },
          ...(report.footerText ? [{ type: 10, content: `-# ${report.footerText}`.slice(0, 4000) }] : [])
        ]
      }
    ],
    flags: COMPONENTS_V2_FLAG
  };

  const { data } = await axios.post<DiscordMessage>(
    `${DISCORD_API}/channels/${report.panelChannelId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      timeout: 10_000
    }
  );

  return data.id;
}

function parseColor(value: string) {
  const normalized = value.replace("#", "").trim();
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xdc2626;
}

function parseEmoji(value: string) {
  const custom = value.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/);

  if (custom) {
    return {
      id: custom[2],
      name: custom[1]
    };
  }

  return {
    name: value
  };
}
