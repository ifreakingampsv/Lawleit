import path from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [tailwindcss(), react()],
  server: {
    port: 3000,
    // VITE_API_MODE=http: same-origin /api/v1 requests are proxied to the
    // reference backend (backend/server.mjs, default :8787) — no CORS needed.
    proxy: process.env.VITE_API_PROXY_TARGET
      ? { "/api": { target: process.env.VITE_API_PROXY_TARGET, changeOrigin: true } }
      : undefined,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
