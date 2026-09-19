import type { LawleitApi } from "./api";
import { mockAdapter } from "./mockAdapter";
import { httpAdapter } from "./httpAdapter";

/**
 * THE BACKEND SWAP POINT.
 *
 * mockAdapter — fully working today (localStorage persistence, seeded demo firm).
 * httpAdapter — implement against your real API (docs/API_CONTRACT.md) and flip:
 *
 *   export const api: LawleitApi = httpAdapter;
 */
export const api: LawleitApi = mockAdapter;

export * from "./types";
