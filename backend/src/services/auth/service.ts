import { randomBytes } from "node:crypto";
import { ConsoleMailer, type Mailer } from "./mailer.js";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./passwords.js";
import type { ApiFirm, ApiUser, AuthRepositories, SessionBundle } from "./repository.js";
import { toApiFirm, toApiUser } from "./repository.js";
import { generateSessionToken, hashToken } from "./tokens.js";
import { HttpError } from "../httpError.js";

/** Matches the reference backend's cookie Max-Age: one week, in seconds. */
export const SESSION_TTL_SECONDS = 604800;
/** Requested reset links die after one hour. */
const RESET_TTL_MS = 3_600_000;
const TRIAL_DAYS_MS = 10 * 86_400_000;
const OWNER_HOURLY_RATE_PAISE = 300000;

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  firmName: string;
  zip: string;
  phone: string;
}

export interface SessionView {
  user: ApiUser;
  firm: ApiFirm;
  users: ApiUser[];
}

export interface AuthResult extends SessionView {
  token: string;
}

/**
 * Postgres unique-violation detector, shared with the users service (ticket
 * 08) so a raced duplicate email renders as the contract's 409 everywhere.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Auth business logic (register/login/session/logout/password reset). All
 * state goes through AuthRepositories, so the class is testable against
 * in-memory fakes and the Drizzle binding swaps in via composition.
 */
export class AuthService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly mailer: Mailer = new ConsoleMailer(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Firm + owner user + first session, atomically. */
  async register(input: SignupInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.repos.users.findByEmail(email);
    if (existing) throw new HttpError(409, "Email already registered");

    const now = this.now();
    const name = `${input.firstName} ${input.lastName}`.trim() || "Firm Owner";
    // The contract's signup payload has no password (free-trial signup): the
    // account starts with an unguessable unset password, and the password
    // reset flow (its email is the ticket-18 mailer) sets the first real one.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));

    try {
      const result = await this.repos.transaction(async (tx) => {
        const firm = await tx.firms.create({
          name: input.firmName,
          practiceAreas: [],
          phone: input.phone,
          email,
          address: input.zip,
          plan: "basic",
          trialEndsAt: isoDate(now.getTime() + TRIAL_DAYS_MS),
        });
        const user = await tx.users.create({
          firmId: firm.id,
          name,
          email,
          passwordHash,
          role: "owner",
          avatarColor: "#4B4ACF",
          hourlyRate: OWNER_HOURLY_RATE_PAISE,
          active: true,
        });
        const token = generateSessionToken();
        await tx.sessions.create({
          token,
          userId: user.id,
          firmId: firm.id,
          expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
        });
        return { token, firm, user };
      });
      return {
        token: result.token,
        user: toApiUser(result.user),
        firm: toApiFirm(result.firm),
        users: [toApiUser(result.user)],
      };
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, "Email already registered");
      throw error;
    }
  }

  async login(email: unknown, password: unknown): Promise<AuthResult> {
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      throw new HttpError(401, "Email and password required");
    }
    const normalized = email.trim().toLowerCase();
    const user = await this.repos.users.findByEmail(normalized);
    // Unknown emails verify against a fixed dummy hash so response timing
    // cannot reveal whether an account exists.
    const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!user || !passwordOk) throw new HttpError(401, "Invalid email or password");
    if (!user.active) throw new HttpError(403, "Account is deactivated");

    const token = generateSessionToken();
    await this.repos.sessions.create({
      token,
      userId: user.id,
      firmId: user.firmId,
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_SECONDS * 1000),
    });
    const firm = await this.repos.firms.findById(user.firmId);
    if (!firm) throw new HttpError(401, "Invalid email or password");
    const users = await this.repos.users.listByFirm(user.firmId);
    return { token, user: toApiUser(user), firm: toApiFirm(firm), users: users.map(toApiUser) };
  }

  /** Guard primitive: bearer-or-cookie token → live session bundle, or null. */
  async authenticate(token: string | null): Promise<SessionBundle | null> {
    if (!token) return null;
    return this.repos.sessions.findActive(token, this.now());
  }

  /**
   * Full session payload (contract: { user, firm, users }). Every user row —
   * the session's own and the firm list — goes through the toApiUser
   * whitelist: repositories return storage rows (UserRow carries the argon2
   * hash for login verification), and this is the boundary that must strip it
   * before the payload reaches the browser.
   */
  async sessionView(bundle: SessionBundle): Promise<SessionView> {
    const users = await this.repos.users.listByFirm(bundle.firmId);
    return {
      user: toApiUser(bundle.user),
      firm: toApiFirm(bundle.firm),
      users: users.map(toApiUser),
    };
  }

  async logout(token: string | null): Promise<void> {
    if (token) await this.repos.sessions.delete(token);
  }

  /** Silent for unknown emails — the response must not reveal who has an account. */
  async requestPasswordReset(email: unknown): Promise<void> {
    if (typeof email !== "string" || !email.trim()) {
      throw new HttpError(400, "Email is required");
    }
    const user = await this.repos.users.findByEmail(email.trim().toLowerCase());
    if (!user || !user.active) return;

    const token = generateSessionToken();
    const expiresAt = new Date(this.now().getTime() + RESET_TTL_MS);
    await this.repos.passwordResets.create({
      userId: user.id,
      firmId: user.firmId,
      tokenHash: hashToken(token),
      expiresAt,
    });
    await this.mailer.sendPasswordReset({
      to: user.email,
      token,
      expiresAt: expiresAt.toISOString(),
      firmId: user.firmId,
    });
  }

  /** Verifies token + expiry, sets the new password, revokes every session. */
  async consumePasswordReset(token: unknown, newPassword: unknown): Promise<void> {
    if (typeof token !== "string" || !token || typeof newPassword !== "string") {
      throw new HttpError(400, "Invalid or expired reset token");
    }
    if (newPassword.length < 8) {
      throw new HttpError(400, "Password must be at least 8 characters");
    }
    const reset = await this.repos.passwordResets.findActive(hashToken(token), this.now());
    if (!reset) throw new HttpError(400, "Invalid or expired reset token");

    const passwordHash = await hashPassword(newPassword);
    await this.repos.transaction(async (tx) => {
      await tx.passwordResets.markUsed(reset.id);
      await tx.users.updatePasswordHash(reset.userId, passwordHash);
      await tx.sessions.deleteForUser(reset.userId);
    });
  }
}
