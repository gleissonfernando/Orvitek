import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";

type SocialCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName?: string;
  count?: string;
  actionLabel: string;
  disabled?: boolean;
  onAction?: () => void;
  children?: React.ReactNode;
};

export function SocialCard({
  actionLabel,
  children,
  count,
  description,
  disabled,
  icon: Icon,
  iconClassName,
  onAction,
  title
}: SocialCardProps) {
  return (
    <section className="rounded-lg border border-zinc-900 bg-[#0b0b0b] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.38)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-white">
            <Icon className={["h-6 w-6", iconClassName].filter(Boolean).join(" ")} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-semibold text-white">{title}</h3>
              {count ? <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-500">{count}</span> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
          </div>
        </div>

        <Button className="h-9 px-4 text-xs" disabled={disabled} onClick={onAction} type="button">
          {actionLabel}
        </Button>
      </div>

      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
