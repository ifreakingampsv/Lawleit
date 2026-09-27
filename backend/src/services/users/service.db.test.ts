import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { UserService } from "./service.js";

/**
 * DB-backed twin of the user-management suite (drizzle-repository.test.ts
 * pattern): the same flows as the in-memory route tests, run against real
 * Postgres so the Drizzle binding proves it implements the seam identically —
 * transactions, the partial unique email index behind the 409, and session
 * revocation on deactivation. Runs only when DATABASE_URL is exported and
 * skips silently otherwise; point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("user management against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      // cases/case_number_counters hang off firms (ticket 10) — cascade would
      // take them anyway; naming them keeps the wipe explicit.
      "truncate table cases, case_number_counters, password_reset_tokens, sessions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  /** A firm whose owner has a working password (signup leaves none). */
  async function firmWithOwner(
    auth: AuthService,
    mailer: CapturingMailer,
    email: string,
  ) {
    const registered = await auth.register({
      firstName: "Owner", lastName: "Of Firm", email,
      firmName: `Firm of ${email}`, zip: "", phone: "",
    });
    await auth.requestPasswordReset(email);
    await auth.consumePasswordReset(mailer.sends[mailer.sends.length - 1]!.token, "password-123");
    const session = await auth.login(email, "password-123");
    return { registered, session };
  }

  it("invite → consume → login end to end on the same machinery as password reset", async () => {
    const mailer = new CapturingMailer();
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, mailer);
    const users = new UserService(repos, mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");

    const invited = await users.create(session.user, {
      name: "Meera Iyer", email: "Meera@Firm.example", role: "attorney",
    });
    expect(invited).toMatchObject({
      firmId: registered.firm.id, email: "meera@firm.example", role: "attorney", active: true,
    });
    expect(await users.listByFirm(registered.firm.id)).toHaveLength(2);

    expect(mailer.invites).toHaveLength(1);
    await auth.consumePasswordReset(mailer.invites[0]!.token, "member-pass-123");
    const memberSession = await auth.login("meera@firm.example", "member-pass-123");
    expect(memberSession.user.id).toBe(invited.id);

    // Member-read is allowed; member-manage is 403.
    expect(await users.listByFirm(registered.firm.id)).toHaveLength(2);
    await expect(
      users.create(memberSession.user, { name: "X", email: "x@firm.example", role: "staff" }),
    ).rejects.toMatchObject({ statusCode: 403, message: "Only the firm owner can manage users" });
  });

  it("duplicate email is 409 across firms; unknown role and bad email are 400", async () => {
    const mailer = new CapturingMailer();
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, mailer);
    const users = new UserService(repos, mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");

    await expect(
      users.create(a.session.user, { name: "Dup", email: "owner@firm-b.example", role: "staff" }),
    ).rejects.toMatchObject({ statusCode: 409, message: "Email already registered" });
    await expect(
      users.create(a.session.user, { name: "Bad", email: "nope", role: "staff" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      users.create(a.session.user, { name: "Bad", email: "x@firm-a.example", role: "admin" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(b.session.user.email).toBe("owner@firm-b.example");
  });

  it("cross-firm patch is 404; the last active owner cannot be demoted or deactivated", async () => {
    const mailer = new CapturingMailer();
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, mailer);
    const users = new UserService(repos, mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");

    await expect(
      users.update(b.session.user, b.registered.firm.id, a.registered.user.id, { active: false }),
    ).rejects.toMatchObject({ statusCode: 404, message: "User not found" });

    for (const patch of [{ active: false }, { role: "attorney" }]) {
      await expect(
        users.update(a.session.user, a.registered.firm.id, a.registered.user.id, patch),
      ).rejects.toMatchObject({ statusCode: 409, message: "A firm must keep at least one active owner" });
    }
    expect(await auth.authenticate(a.session.token)).not.toBeNull();
  });

  it("deactivating a member revokes their sessions and preserves the record", async () => {
    const mailer = new CapturingMailer();
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, mailer);
    const users = new UserService(repos, mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");

    const invited = await users.create(session.user, {
      name: "Meera Iyer", email: "meera@firm.example", role: "paralegal",
    });
    await auth.consumePasswordReset(mailer.invites[0]!.token, "member-pass-123");
    const memberSession = await auth.login("meera@firm.example", "member-pass-123");
    expect(await auth.authenticate(memberSession.token)).not.toBeNull();

    const patched = await users.update(session.user, registered.firm.id, invited.id, { active: false });
    expect(patched.active).toBe(false);
    expect(await auth.authenticate(memberSession.token)).toBeNull();
    await expect(auth.login("meera@firm.example", "member-pass-123")).rejects.toMatchObject({
      statusCode: 403,
      message: "Account is deactivated",
    });

    const rows = await users.listByFirm(registered.firm.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((u) => u.id === invited.id)).toMatchObject({ active: false });
  });
});
