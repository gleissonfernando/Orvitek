import { io } from "socket.io-client";
import { isLocalBrowserOrigin, normalizePublicUrl, publicOrigin } from "./urls";

function resolveDevelopmentSocketUrl() {
  const configuredSocketUrl = normalizePublicUrl(import.meta.env.VITE_SOCKET_URL);

  if (configuredSocketUrl) {
    return configuredSocketUrl;
  }

  const origin = publicOrigin();
  return isLocalBrowserOrigin() && origin ? origin : window.location.origin;
}

export const SOCKET_URL = import.meta.env.PROD ? window.location.origin : resolveDevelopmentSocketUrl();

export function createDashboardSocket() {
  return io(SOCKET_URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
}
