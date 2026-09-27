import { api, apiMode } from "./index";
import { seedUsers } from "./seed";
import type { Session } from "./types";

/**
 * Demo Version session entry (ADR 0001): the visitor lands in the seeded
 * Demo Firm with no signup, no login form, and no payment info. The local DB
 * seeds itself on first load; an existing session is kept so a returning
 * visitor (or one who signed up earlier) keeps their current identity.
 * Mock mode only — the Production Version keeps its real auth gate.
 */
export async function startDemoSession(): Promise<Session | null> {
  if (apiMode !== "mock") return null;
  const existing = await api.getSession();
  if (existing) return existing;
  return api.login(seedUsers[0].email, "");
}
