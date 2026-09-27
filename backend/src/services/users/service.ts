import type { ApiUser, AuthRepositories, UserPatch } from "../auth/repository.js";
import { toApiUser } from "../auth/repository.js";
import { HttpError } from "../httpError.js";

/**
 * Minimal firm-user surface for ticket 07 (GET /users, PATCH /users/:id) so
 * the cross-firm isolation pattern has real data to protect. Ticket 08 adds
 * invites and the admin-only permission check on top of this service.
 */
export class UserService {
  constructor(private readonly repos: AuthRepositories) {}

  async listByFirm(firmId: string): Promise<ApiUser[]> {
    const rows = await this.repos.users.listByFirm(firmId);
    return rows.map(toApiUser);
  }

  /**
   * The user id must belong to the session's firm — anything else is 404, so
   * another firm's users cannot even be probed for existence.
   */
  async update(firmId: string, userId: string, patch: UserPatch): Promise<ApiUser> {
    const updated = await this.repos.transaction(async (tx) => {
      const existing = await tx.users.findById(userId);
      if (!existing || existing.firmId !== firmId) return null;
      // Deactivation revokes the user's live sessions in the same transaction.
      if (patch.active === false) await tx.sessions.deleteForUser(userId);
      const row = await tx.users.update(userId, patch);
      return row;
    });
    if (!updated) throw new HttpError(404, "User not found");
    return toApiUser(updated);
  }
}
