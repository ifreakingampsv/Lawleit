import { and, desc, eq, isNull } from "drizzle-orm";
import { gatewayAccounts, paymentLinks } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  GatewayAccountPatch,
  GatewayAccountRepository,
  GatewayAccountRow,
  NewGatewayAccount,
  NewPaymentLink,
  PaymentLinkPatch,
  PaymentLinkRepository,
  PaymentLinkRow,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the gateway repository seams (tickets 02–05)
 * — the production implementation used when DATABASE_URL is set. Every read
 * filters soft deletes and the firm scope (ADR-0003); the write path sets
 * updated_at itself (no triggers, per drizzle/README.md).
 */

const liveAccount = () => isNull(gatewayAccounts.deletedAt);
const liveLink = () => isNull(paymentLinks.deletedAt);

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

export class DrizzlePaymentLinkRepository implements PaymentLinkRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewPaymentLink): Promise<PaymentLinkRow> {
    const [row] = await this.exec.insert(paymentLinks).values(input).returning();
    if (!row) throw new Error("payment link insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<PaymentLinkRow | null> {
    const [row] = await this.exec
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.id, id), eq(paymentLinks.firmId, firmId), liveLink()))
      .limit(1);
    return row ?? null;
  }

  async listByInvoice(firmId: string, invoiceId: string): Promise<PaymentLinkRow[]> {
    return this.exec
      .select()
      .from(paymentLinks)
      .where(
        and(
          eq(paymentLinks.firmId, firmId),
          eq(paymentLinks.invoiceId, invoiceId),
          liveLink(),
        ),
      )
      // Newest first (the mock/reference unshift); id breaks ties.
      .orderBy(desc(paymentLinks.createdAt), desc(paymentLinks.id));
  }

  async update(firmId: string, id: string, patch: PaymentLinkPatch): Promise<PaymentLinkRow | null> {
    const [row] = await this.exec
      .update(paymentLinks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(paymentLinks.id, id), eq(paymentLinks.firmId, firmId), liveLink()))
      .returning();
    return row ?? null;
  }
}
