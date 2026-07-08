import * as React from "react";
import { cn } from "../../lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "muted";
};

const variants = {
  default: "border-[#FFD500]/35 bg-[#FFD500]/10 text-[#FFEA70]",
  success: "border-[#3DDC84]/40 bg-[#3DDC84]/10 text-[#3DDC84]",
  warning: "border-[#FFD500]/40 bg-[#FFD500]/10 text-[#FFEA70]",
  danger: "border-zinc-700 bg-zinc-900 text-zinc-200",
  muted: "border-[#FFD500]/15 bg-[#141414] text-zinc-400"
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
