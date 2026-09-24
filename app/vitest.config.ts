import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Vitest config — unit + contract tests for the data layer.
 *
 *   npm run test          # one shot
 *   npm run test:watch
 *
 * jsdom: the adapters touch localStorage/sessionStorage/window.location.
 * app/tests/httpAdapter.contract.test.ts additionally spawns the reference
 * backend (backend/server.mjs) on a scratch DB and drives it through the
 * real httpAdapter — the same suite can later certify the owner's real
 * backend by setting VITE_API_BASE_URL (see the file header).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // contract test spawns a child server + polls /health — needs headroom
    testTimeout: 20000,
  },
});
