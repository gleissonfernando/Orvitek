import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type GuildMember,
  type PartialGuildMember
} from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";
import { getCachedGuildSettings } from "./guildSettingsCache";

type MemberPanelMode = "welcome" | "leave";

type MemberPanelInput = {
  channelId: string | null;
  channelLabel: string | null;
  color: string;
  description: string | null;
  footerText: string | null;
  imageUrl: string | null;
  mode: MemberPanelMode;
  rules: string | null;
  rulesTitle: string | null;
  title: string | null;
};

type VariableContext = {
  botName: string;
  channel: string;
  memberCount: string;
  server: string;
  user: string;
  username: string;
};

export async function sendWelcomeMessage(context: BotContext, member: GuildMember) {
  const settings = await getCachedGuildSettings(context, member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.welcomeEnabled || !settings.welcomeChannelId) {
    return;
  }

  const channel = await resolveTextChannel(member, settings.welcomeChannelId);

  if (!channel?.isSendable()) {
    return;
  }

  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const variables = panelVariables(member, displayChannelId);
  const payload = createMemberPanelPayload(variables, {
    channelId: displayChannelId,
    channelLabel: settings.welcomeChannelLabel,
    color: settings.welcomeColor,
    description: settings.welcomeMessage,
    footerText: settings.welcomeFooterText,
    imageUrl: settings.welcomeImageUrl,
    mode: "welcome",
    rules: settings.welcomeRules,
    rulesTitle: settings.welcomeRulesTitle,
    title: settings.welcomeTitle
  });

  if (!payload) {
    return;
  }

  await channel.send(payload);
}

export async function sendLeaveMessage(context: BotContext, member: GuildMember | PartialGuildMember) {
  const settings = await getCachedGuildSettings(context, member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.leaveEnabled || !settings.leaveChannelId) {
    return;
  }

  const channel = await resolveTextChannel(member, settings.leaveChannelId);

  if (!channel?.isSendable()) {
    return;
  }

  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  const variables = panelVariables(member, displayChannelId);
  const payload = createMemberPanelPayload(variables, {
    channelId: displayChannelId,
    channelLabel: settings.leaveChannelLabel,
    color: settings.leaveColor,
    description: settings.leaveMessage,
    footerText: settings.leaveFooterText,
    imageUrl: settings.leaveImageUrl,
    mode: "leave",
    rules: settings.leaveRules,
    rulesTitle: settings.leaveRulesTitle,
    title: settings.leaveTitle
  });

  if (!payload) {
    return;
  }

  await channel.send(payload);
}

export function createMemberPanelPayload(
  variables: VariableContext,
  input: MemberPanelInput
) {
  const imageUrl = resolveImageUrl(input.imageUrl);
  const title = renderTemplate(input.title, variables);
  const description = renderTemplate(input.description, variables);
  const rulesTitle = renderTemplate(input.rulesTitle, variables);
  const rules = formatRuleLines(renderTemplate(input.rules, variables));
  const channelLabel = renderTemplate(input.channelLabel, variables);
  const footerText = renderTemplate(input.footerText, variables);
  const contentBlocks: TextDisplayBuilder[] = [];

  if (title) {
    contentBlocks.push(new TextDisplayBuilder().setContent(`## ${title}`));
  }

  if (description) {
    contentBlocks.push(new TextDisplayBuilder().setContent(description));
  }

  if (rulesTitle || rules.length) {
    contentBlocks.push(new TextDisplayBuilder().setContent([
      rulesTitle ? `**${rulesTitle}**` : null,
      ...rules.map((rule, index) => `**${index + 1}.** ${rule}`)
    ].filter(Boolean).join("\n")));
  }

  if (channelLabel || input.channelId) {
    contentBlocks.push(new TextDisplayBuilder().setContent(
      [channelLabel, variables.channel].filter(Boolean).join(" ")
    ));
  }

  if (footerText) {
    contentBlocks.push(new TextDisplayBuilder().setContent(`-# ${footerText}`));
  }

  if (!imageUrl && !contentBlocks.length) {
    return null;
  }

  const container = new ContainerBuilder()
    .setAccentColor(parseColor(input.color));

  if (imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(imageUrl)
          .setDescription(`${input.mode} image`)
      )
    );
  }

  if (contentBlocks.length) {
    container.addTextDisplayComponents(...contentBlocks);
  }

  return {
    allowedMentions: {
      parse: [] as never[]
    },
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function panelVariables(member: GuildMember | PartialGuildMember, channelId: string | null): VariableContext {
  const username = member.user?.username ?? member.displayName ?? member.id;
  const botName = member.client.user?.username ?? "Bot";

  return {
    botName,
    channel: channelId ? `<#${channelId}>` : "",
    memberCount: String(member.guild.memberCount ?? ""),
    server: member.guild.name,
    user: `<@${member.id}>`,
    username
  };
}

function renderTemplate(value: string | null | undefined, variables: VariableContext) {
  const template = value?.trim() ?? "";

  if (!template) {
    return "";
  }

  return template
    .replace(/\{user\}/gi, variables.user)
    .replace(/\{username\}/gi, variables.username)
    .replace(/\{server\}/gi, variables.server)
    .replace(/\{memberCount\}/gi, variables.memberCount)
    .replace(/\{botName\}/gi, variables.botName)
    .replace(/\{channel\}/gi, variables.channel);
}

function resolveImageUrl(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

async function resolveTextChannel(member: GuildMember | PartialGuildMember, channelId: string) {
  const channel = member.guild.channels.cache.get(channelId)
    ?? await member.guild.channels.fetch(channelId).catch(() => null);

  return channel?.isTextBased() ? channel : null;
}

function formatRuleLines(rules: string) {
  return rules
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0xef4444;
}
