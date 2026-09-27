import { api } from "@/lib/data";

/**
 * The "Reset demo data" action (Demo Version, ADR 0001): wipes the persisted
 * local DB, re-seeds the pristine Demo Firm, then reloads into the dashboard
 * so every screen starts from the clean first-run state.
 */
export async function resetDemoData(): Promise<void> {
  await api.resetDemoData();
  window.location.assign("/app");
}
