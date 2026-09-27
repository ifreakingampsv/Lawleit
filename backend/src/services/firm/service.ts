import type { ApiFirm, AuthRepositories, FirmPatch } from "../auth/repository.js";
import { toApiFirm } from "../auth/repository.js";
import { HttpError } from "../httpError.js";

/** PATCH /firm — always scoped to the session's own firm (ADR-0003). */
export class FirmService {
  constructor(private readonly repos: AuthRepositories) {}

  async update(firmId: string, patch: FirmPatch): Promise<ApiFirm> {
    const row = await this.repos.firms.update(firmId, patch);
    if (!row) throw new HttpError(404, "Firm not found");
    return toApiFirm(row);
  }
}
