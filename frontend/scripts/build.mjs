import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const frontendRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

await build({
  root: frontendRoot,
  envDir: path.resolve(frontendRoot, ".."),
  configFile: false,
  plugins: [react()]
});
