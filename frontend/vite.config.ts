import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: resolve(__dirname, ".."),
  plugins: [
    react({
      babel: {
        plugins: [
          // Otimização de React: remove comentários em produção
          ["@babel/plugin-transform-react-constant-elements"],
          // Remove propTypes em produção
          ["@babel/plugin-transform-remove-console"]
        ]
      }
    })
  ],
  server: {
    port: 5173,
    // Otimizações de desenvolvimento
    middlewareMode: false,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 5173
    }
  },
  build: {
    // Chunking otimizado
    rollupOptions: {
      output: {
        manualChunks: {
          // Separa libs pesadas em chunks próprios
          "vendor-react": ["react", "react-dom"],
          "vendor-ui": ["lucide-react"],
          "vendor-animation": ["framer-motion"],
          "vendor-utils": ["zod"],
          // Agrupa componentes por feature
          "feature-dev": ["./src/pages/DevDashboard.tsx", "./src/components/dev/DevPanel.tsx"],
          "feature-dashboard": ["./src/pages/Dashboard.tsx"],
          "feature-giveaway": ["./src/pages/GiveawayRoulette.tsx"],
        }
      }
    },
    // Tamanho mínimo para chunk splitting
    chunkSizeWarningLimit: 1000,
    // Otimização de minificação
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    // Paralelize builds
    reportCompressedSize: false
  },
  // Optimização de resolução de módulos
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src")
    }
  },
  // Cache otimizado
  cacheDir: ".vite"
});
