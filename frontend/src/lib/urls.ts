function normalizeUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") || "/" : undefined;
}

function isLocalHttpUrl(value?: string) {
  if (!value || !/^https?:\/\//i.test(value)) {
    return false;
  }

  const url = new URL(value);
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
}

export function isLocalBrowserOrigin() {
  return isLocalHttpUrl(window.location.origin);
}

export function publicOrigin() {
  const configuredPublicUrl = normalizeUrl(import.meta.env.VITE_FRONTEND_URL);

  if (configuredPublicUrl && !isLocalHttpUrl(configuredPublicUrl)) {
    return configuredPublicUrl;
  }

  return isLocalBrowserOrigin() ? "" : normalizeUrl(window.location.origin) ?? "";
}

export function appUrl(path = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const origin = publicOrigin();

  return origin ? `${origin}${normalizedPath}` : normalizedPath;
}

export function dashboardUrl() {
  return appUrl("/dashboard");
}

export function normalizePublicUrl(value?: string) {
  const normalized = normalizeUrl(value);
  return normalized && !isLocalHttpUrl(normalized) ? normalized : undefined;
}
