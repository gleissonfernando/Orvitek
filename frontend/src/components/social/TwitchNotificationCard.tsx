import { Twitch } from "lucide-react";
import { SocialCard } from "./SocialCard";
import { TwitchChannelItem } from "./TwitchChannelItem";
import type { GuildChannelOption, GuildRoleOption, SocialNotification } from "../../types";

type TwitchNotificationCardProps = {
  notifications: SocialNotification[];
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  onAdd: () => void;
  onEdit: (notification: SocialNotification) => void;
  onDelete: (notification: SocialNotification) => void;
};

export function TwitchNotificationCard({ channels, notifications, onAdd, onDelete, onEdit, roles }: TwitchNotificationCardProps) {
  const twitchNotifications = notifications.filter((notification) => notification.platform === "twitch");
  const count = twitchNotifications.length;

  return (
    <SocialCard
      actionLabel="Adicionar canal"
      count={`${count}/5`}
      description="Alertas automaticos quando uma live da Twitch comecar."
      disabled={count >= 5}
      icon={Twitch}
      iconClassName="text-[#9146ff]"
      onAction={onAdd}
      title="Twitch"
    >
      {twitchNotifications.length ? (
        <div className="space-y-3">
          {twitchNotifications.map((notification) => (
            <TwitchChannelItem
              channelName={formatChannelName(channels, notification.discordChannelId)}
              key={notification.id}
              notification={notification}
              onDelete={onDelete}
              onEdit={onEdit}
              roleName={formatRoleName(roles, notification.mentionRoleId)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 p-5 text-sm text-zinc-500">
          Nenhum canal Twitch cadastrado.
        </div>
      )}
    </SocialCard>
  );
}

function formatChannelName(channels: GuildChannelOption[], channelId: string) {
  const channel = channels.find((item) => item.id === channelId);
  return channel ? `#${channel.name}` : channelId;
}

function formatRoleName(roles: GuildRoleOption[], roleId?: string | null) {
  if (!roleId || roleId === "everyone") {
    return "@everyone";
  }

  const role = roles.find((item) => item.id === roleId);
  return role ? `@${role.name}` : roleId;
}
