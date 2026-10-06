import { randomUUID } from "node:crypto";
import type {
  GatewayAccountPatch,
  GatewayAccountRepository,
  GatewayAccountRow,
  GatewayEventRepository,
  GatewayEventRow,
  NewGatewayAccount,
  NewGatewayEvent,
  NewPaymentLink,
  PaymentLinkPatch,
  PaymentLinkRepository,
  PaymentLinkRow,
} from "./repository.js";

/**
 * In-memory gateway repositories for tests — the payments twin of
 * services/payments/in-memory.ts. Honor the seam's semantics (firm scoping,
 * soft deletes, newest-first listings) so service and route tests exercise
 * real logic without a database; the DB twin proves the Drizzle binding stays
 * behaviorally identical.
 */
export class InMemoryGatewayAccountRepository implements GatewayAccountRepository {
  constructor(private readonly accounts: GatewayAccountRow[]) {}

  async findByFirm(firmId: string): Promise<GatewayAccountRow | null> {
    return this.accounts.find((a) => a.firmId === firmId && a.deletedAt === null) ?? null;
  }

  async create(input: NewGatewayAccount): Promise<GatewayAccountRow> {
    const row: GatewayAccountRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    this.accounts.push(row);
    return row;
  }

  async update(firmId: string, patch: GatewayAccountPatch): Promise<GatewayAccountRow | null> {
    const row = await this.findByFirm(firmId);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }

  async delete(firmId: string): Promise<boolean> {
    const row = await this.findByFirm(firmId);
    if (!row) return false;
    row.deletedAt = new Date();
    return true;
  }
}

export class InMemoryPaymentLinkRepository implements PaymentLinkRepository {
  constructor(private readonly links: PaymentLinkRow[]) {}

  async create(input: NewPaymentLink): Promise<PaymentLinkRow> {
    const row: PaymentLinkRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.links.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<PaymentLinkRow | null> {
    return (
      this.links.find((l) => l.id === id && l.firmId === firmId && l.deletedAt === null) ?? null
    );
  }

  async listByInvoice(firmId: string, invoiceId: string): Promise<PaymentLinkRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the order.
    return this.links.filter(
      (l) => l.firmId === firmId && l.invoiceId === invoiceId && l.deletedAt === null,
    );
  }

  async findByProviderLinkId(firmId: string, providerLinkId: string): Promise<PaymentLinkRow | null> {
    return (
      this.links.find(
        (l) => l.providerLinkId === providerLinkId && l.firmId === firmId && l.deletedAt === null,
      ) ?? null
    );
  }

  async update(firmId: string, id: string, patch: PaymentLinkPatch): Promise<PaymentLinkRow | null> {
    const row = await this.findById(firmId, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
}

/**
 * The webhook ledger's fake. A duplicate (provider, provider_event_id) throws
 * the SAME 23505 error shape the Drizzle binding surfaces from the unique
 * index, so the service's isUniqueViolation catch treats both identically.
 */
export class InMemoryGatewayEventRepository implements GatewayEventRepository {
  constructor(private readonly events: GatewayEventRow[]) {}

  async create(input: NewGatewayEvent): Promise<GatewayEventRow> {
    if (
      this.events.some(
        (e) => e.provider === input.provider && e.providerEventId === input.providerEventId,
      )
    ) {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      });
    }
    const row: GatewayEventRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.events.unshift(row);
    return row;
  }

  async listByFirm(firmId: string): Promise<GatewayEventRow[]> {
    // unshift keeps the store newest-first.
    return this.events.filter((e) => e.firmId === firmId);
  }
}
