import { randomBytes } from "node:crypto";
import { hashPassword } from "../auth/passwords.js";
import { ConsoleMailer, type Mailer } from "../auth/mailer.js";
import type { ApiUser, AuthRepositories, UserPatch } from "../auth/repository.js";
import { toApiUser } from "../auth/repository.js";
import { isUniqueViolation } from "../auth/service.js";
import { generateSessionToken, hashToken } from "../auth/tokens.js";
import { HttpError } from "../httpError.js";

/**
 * The role vocabulary of the API contract (app/src/lib/data/types.ts User).
 * The tickets' "admin" is the contract's "owner": the firm creator, exactly
 * one at signup, and the only role allowed to manage users.
 */
export const USER_ROLES = ["owner", "attorney", "paralegal", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Invites ride the password-reset machinery; the window is longer because an admin — not the user — controls when it is sent. */
const INVITE_TTL_MS = 7 * 86_400_000;
/** Only owners manage users; members are answered 403 with this message. */
const MANAGE_FORBIDDEN = "Only the firm owner can manage users";
/** Guard message for the last-active-owner invariant. */
const LAST_OWNER = "A firm must keep at least one active owner";
const DEFAULT_AVATAR_COLOR = "#4B4ACF";

export interface InviteInput {
  name: string;
  email: string;
  role: string;
  hourlyRate?: number;
  avatarColor?: string;
}

function requireOwner(actor: ApiUser): void {
  if (actor.role !== "owner") throw new HttpError(403, MANAGE_FORBIDDEN);
}

const emailLike = (value: string) => /^\S+@\S+\.\S+$/.test(value);

/**
 * Firm-user management (ticket 08) on the ticket-07 seam. Authorization lives
 * here, not in the routes (ADR-0003): the service is the single choke point
 * that checks the actor's role, scopes every lookup by the session's firm, and
 * keeps the last-active-owner invariant.
 */
export class UserService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly mailer: Mailer = new ConsoleMailer(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Member-read is allowed: the contract's session payload ({ user, firm,
   * users }) already hands the firm's user list to every signed-in member, so
   * the list endpoint does not pretend otherwise. Ordering (created_at, id)
   * is the repository's.
   */
  async listByFirm(firmId: string): Promise<ApiUser[]> {
    const rows = await this.repos.users.listByFirm(firmId);
    return rows.map(toApiUser);
  }

  /**
   * Invite (POST /users): owner-only. Creates an active user in the actor's
   * firm with an unguessable unset password (the signup approach) and issues
   * a single-use invite token through the password-reset machinery; the
   * mailer delivers it and /auth/password-reset/consume sets the first
   * password. Email is unique globally — inviting an address that already
   * belongs to any firm is a 409 that names no firm.
   */
  async create(actor: ApiUser, input: InviteInput): Promise<ApiUser> {
    requireOwner(actor);

    const name = input.name?.trim() ?? "";
    if (!name) throw new HttpError(400, "Name is required");
    const email = input.email?.trim().toLowerCase() ?? "";
    if (!email || !emailLike(email)) throw new HttpError(400, "A valid email is required");
    if (!USER_ROLES.includes(input.role as UserRole)) {
      throw new HttpError(400, "Role must be owner, attorney, paralegal, or staff");
    }

    const existing = await this.repos.users.findByEmail(email);
    if (existing) throw new HttpError(409, "Email already registered");

    // The account starts unusable: the hash is of a value nobody knows, so
    // login fails until the invite link sets a real password.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    const token = generateSessionToken();
    const expiresAt = new Date(this.now().getTime() + INVITE_TTL_MS);

    try {
      const user = await this.repos.transaction(async (tx) => {
        const row = await tx.users.create({
          firmId: actor.firmId,
          name,
          email,
          passwordHash,
          role: input.role,
          avatarColor: input.avatarColor ?? DEFAULT_AVATAR_COLOR,
          hourlyRate: input.hourlyRate ?? 0,
          active: true,
        });
        await tx.passwordResets.create({
          userId: row.id,
          firmId: row.firmId,
          tokenHash: hashToken(token),
          expiresAt,
        });
        return row;
      });
      await this.mailer.sendUserInvite({ to: email, token, expiresAt: expiresAt.toISOString() });
      return toApiUser(user);
    } catch (error) {
      // Raced duplicate (the partial unique index fires between our check and
      // the insert): the DB twin suite proves this path on real Postgres.
      if (isUniqueViolation(error)) throw new HttpError(409, "Email already registered");
      throw error;
    }
  }

  /**
   * PATCH /users/:id — owner-only (which includes role changes). The user id
   * must belong to the session's firm — anything else is 404, so another
   * firm's users cannot even be probed for existence. Deactivation revokes
   * the user's live sessions in the same transaction.
   */
  async update(actor: ApiUser, firmId: string, userId: string, patch: UserPatch): Promise<ApiUser> {
    requireOwner(actor);

    const updated = await this.repos.transaction(async (tx) => {
      const existing = await tx.users.findById(userId);
      if (!existing || existing.firmId !== firmId) return null;

      // Last-active-owner invariant: the firm's only active owner can neither
      // be deactivated nor demoted (this also blocks an owner deactivating
      // themselves in the common single-owner firm).
      const removesOwnership =
        existing.role === "owner" &&
        existing.active &&
        (patch.active === false || (patch.role !== undefined && patch.role !== "owner"));
      if (removesOwnership) {
        const firmUsers = await tx.users.listByFirm(firmId);
        const activeOwners = firmUsers.filter((u) => u.role === "owner" && u.active);
        if (activeOwners.length === 1 && activeOwners[0]?.id === userId) {
          throw new HttpError(409, LAST_OWNER);
        }
      }

      if (patch.active === false) await tx.sessions.deleteForUser(userId);
      return tx.users.update(userId, patch);
    });
    if (!updated) throw new HttpError(404, "User not found");
    return toApiUser(updated);
  }
}
