import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: resolve(__dirname, ".."),
  plugins: [react()],
  server: {
    port: 5173
  }
});
