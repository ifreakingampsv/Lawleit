import type { FastifyInstance } from "fastify";
import { TrustService } from "../services/trust/service.js";
import { requireAuth } from "./requestAuth.js";

export type TrustRoutesOptions = {
  trustService: TrustService | null;
};

/**
 * Trust routes (ticket 15, docs/API_CONTRACT.md). The contract's trust
 * surface is exactly ONE endpoint — GET /trust/transactions (running
 * `balanceAfter` per client, the reference's `db.trust` array order, oldest
 * first) — so exactly one is built: entries ENTER the ledger through
 * POST /payments with `trustAccount: true` (the contract's "trustAccount
 * routes to trust ledger", wired in the payments service's ticket-15 hook),
 * and the ledger itself is append-only: no PATCH/DELETE, no client-sent
 * entry, no invented deposit/withdrawal/reconcile endpoints (AGENTS.md —
 * never invent endpoints; reconcile is a service-level capability).
 * Registered inside protectedRoutes, so the session guard's 401/503
 * envelopes apply.
 */
export async function trustRoutes(
  app: FastifyInstance,
  options: TrustRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.trustService) throw new Error("service missing while session guard passed");
    return options.trustService;
  };

  app.get("/trust/transactions", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });
}
