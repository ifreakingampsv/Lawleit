import type { LawleitApi } from "./api";
import { mockAdapter } from "./mockAdapter";
import { httpAdapter } from "./httpAdapter";

/**
 * THE BACKEND SWAP POINT — now env-driven.
 *
 *   VITE_API_MODE=mock (default) → mockAdapter: seeded in-memory DB persisted to
 *                                  localStorage; works with zero backend.
 *   VITE_API_MODE=http           → httpAdapter: REST client implementing
 *                                  docs/API_CONTRACT.md 1:1. Point VITE_API_BASE_URL
 *                                  at the bundled reference backend (backend/server.mjs)
 *                                  or the owner's real API. See docs/BACKEND.md.
 *
 * Source-level switching is no longer needed; to hard-pin an adapter regardless of
 * env, change the default below.
 */
const mode = (import.meta.env.VITE_API_MODE as "mock" | "http" | undefined) ?? "mock";

export const api: LawleitApi = mode === "http" ? httpAdapter : mockAdapter;

export const apiMode: "mock" | "http" = mode;

export { ApiError } from "./httpAdapter";
export * from "./types";
