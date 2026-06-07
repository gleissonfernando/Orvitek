import type { ReactNode } from "react";
import { useState } from "react";
import { Sidebar, type ViewId } from "./sidebar";
import { Topbar } from "./topbar";
import type { AuthUser, DashboardBot, DashboardGuild, DashboardMeUser } from "../../types";

type DashboardLayoutProps = {
  activeView: ViewId;
  bots?: DashboardBot[];
  children: ReactNode;
  dashboardUser?: DashboardMeUser | null;
  guilds: DashboardGuild[];
  selectedBotId?: string | null;
  selectedGuildId: string | null;
  showDev: boolean;
  enabledModules: string[];
  showAllModules: boolean;
  user: AuthUser;
  onChangeView: (view: ViewId) => void;
  onLogout: () => void;
  onSelectBot?: (botId: string | null) => void;
  onSelectGuild: (guildId: string) => void;
};

export function DashboardLayout({
  activeView,
  bots = [],
  children,
  dashboardUser,
  enabledModules,
  guilds,
  selectedGuildId,
  showAllModules,
  showDev,
  user,
  onChangeView,
  onLogout,
  onSelectBot,
  onSelectGuild,
  selectedBotId = null
}: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#050505] lg:pl-72">
      <Sidebar
        activeView={activeView}
        bots={bots}
        enabledModules={enabledModules}
        isOpen={menuOpen}
        onChangeView={onChangeView}
        onClose={() => setMenuOpen(false)}
        onSelectBot={(botId) => onSelectBot?.(botId)}
        selectedBotId={selectedBotId}
        server={guilds.find((guild) => guild.id === selectedGuildId) ?? guilds[0] ?? null}
        showDev={showDev}
        showAllModules={showAllModules}
      />
      <Topbar
        guilds={guilds}
        onLogout={onLogout}
        onOpenMenu={() => setMenuOpen(true)}
        onSelectGuild={onSelectGuild}
        selectedGuildId={selectedGuildId}
        dashboardUser={dashboardUser}
        user={user}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
