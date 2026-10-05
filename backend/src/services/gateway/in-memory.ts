import { randomUUID } from "node:crypto";
import type {
  GatewayAccountPatch,
  GatewayAccountRepository,
  GatewayAccountRow,
  NewGatewayAccount,
} from "./repository.js";

/**
 * In-memory gateway-account repository for tests — the payments twin of
 * services/payments/in-memory.ts. Honors the seam's semantics (firm scoping,
 * soft deletes) so service and route tests exercise real logic without a
 * database; the DB twin proves the Drizzle binding stays behaviorally
 * identical.
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
