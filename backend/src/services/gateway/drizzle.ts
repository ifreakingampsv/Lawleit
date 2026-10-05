import { and, eq, isNull } from "drizzle-orm";
import { gatewayAccounts } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  GatewayAccountPatch,
  GatewayAccountRepository,
  GatewayAccountRow,
  NewGatewayAccount,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the gateway-account repository seam (ticket
 * 02) — the production implementation used when DATABASE_URL is set. Every
 * read filters soft deletes and the firm scope (ADR-0003); the write path
 * sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveAccount = () => isNull(gatewayAccounts.deletedAt);

export class DrizzleGatewayAccountRepository implements GatewayAccountRepository {
  constructor(private readonly exec: DbExecutor) {}

  async findByFirm(firmId: string): Promise<GatewayAccountRow | null> {
    const [row] = await this.exec
      .select()
      .from(gatewayAccounts)
      .where(and(eq(gatewayAccounts.firmId, firmId), liveAccount()))
      .limit(1);
    return row ?? null;
  }

  async create(input: NewGatewayAccount): Promise<GatewayAccountRow> {
    const [row] = await this.exec.insert(gatewayAccounts).values(input).returning();
    if (!row) throw new Error("gateway account insert returned no row");
    return row;
  }

  async update(firmId: string, patch: GatewayAccountPatch): Promise<GatewayAccountRow | null> {
    const [row] = await this.exec
      .update(gatewayAccounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(gatewayAccounts.firmId, firmId), liveAccount()))
      .returning();
    return row ?? null;
  }

  async delete(firmId: string): Promise<boolean> {
    const [row] = await this.exec
      .update(gatewayAccounts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(gatewayAccounts.firmId, firmId), liveAccount()))
      .returning();
    return row !== undefined;
  }
}
