/**
 * Static-host SPA fallback: copy dist/index.html into one directory per route
 * so deep links (/pricing, /app/cases, …) serve the app on hosts without
 * rewrite rules. Runs automatically after `vite build` (see package.json).
 */
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const routes = [
  "pricing",
  "login",
  "free-trial",
  "schedule-demo",
  "coming-soon",
  "products/client-intake-lead-management",
  "products/case-management",
  "products/client-communications",
  "products/billing-payments",
  "products/legal-ai",
  "products/financial-management",
  "app",
  "app/calendar",
  "app/tasks",
  "app/cases",
  "app/contacts",
  "app/leads",
  "app/billing/time",
  "app/billing/expenses",
  "app/billing/invoices",
  "app/payments",
  "app/accounting",
  "app/documents",
  "app/communications",
  "app/reports",
  "app/settings",
];

for (const route of routes) {
  const dir = join(root, route);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(root, "index.html"), join(dir, "index.html"));
}
console.log(`spa-fallback: wrote ${routes.length} route entrypoints`);
