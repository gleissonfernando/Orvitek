import * as React from "react";
import { cn } from "../../lib/utils";

type AvatarProps = React.HTMLAttributes<HTMLDivElement> & {
  src?: string | null;
  fallback: string;
};

export function Avatar({ src, fallback, className, ...props }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const [currentSrc, setCurrentSrc] = React.useState(src ?? null);
  const initials = fallback
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  React.useEffect(() => {
    setFailed(false);
    setCurrentSrc(src ?? null);
  }, [src]);

  function handleImageError() {
    const retrySrc = currentSrc ? discordWebpFallback(currentSrc) : null;

    if (retrySrc && retrySrc !== currentSrc) {
      setCurrentSrc(retrySrc);
      return;
    }

    setFailed(true);
  }

  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-sm font-semibold text-foreground",
        className
      )}
      {...props}
    >
      {currentSrc && !failed ? (
        <img src={currentSrc} alt="" className="h-full w-full object-cover" onError={handleImageError} />
      ) : (
        initials || "DC"
      )}
    </div>
  );
}

function discordWebpFallback(src: string) {
  try {
    const url = new URL(src);
    const isDiscordCdn = url.hostname === "cdn.discordapp.com" || url.hostname.endsWith(".discordapp.com");

    if (!isDiscordCdn || !/\.(?:gif|jpe?g|png)$/i.test(url.pathname)) {
      return null;
    }

    url.pathname = url.pathname.replace(/\.(?:gif|jpe?g|png)$/i, ".webp");
    return url.toString();
  } catch {
    return null;
  }
}
