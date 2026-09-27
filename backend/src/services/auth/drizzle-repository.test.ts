import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "./drizzle-repository.js";
import { AuthService } from "./service.js";
import { FirmService } from "../firm/service.js";
import { UserService } from "../users/service.js";
import { CapturingMailer } from "./testing.js";

/**
 * DB-backed twin of the auth suite: same flows as the in-memory tests, run
 * against real Postgres so the Drizzle repositories prove they implement the
 * seam identically (transactions, partial unique email index, cascades).
 *
 * Runs only when DATABASE_URL is exported (the owner's Supabase project per
 * backend/README.md); skips silently otherwise. Tables are truncated between
 * tests — point it at a scratch database.
 */
describe.skipIf(!process.env.DATABASE_URL)("auth repositories against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table password_reset_tokens, sessions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  it("register → login → session → logout end to end", async () => {
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, new CapturingMailer());

    const registered = await auth.register({
      firstName: "Arjun", lastName: "Kaul", email: "Arjun@Firm.example",
      firmName: "Kaul & Bhatnagar Associates", zip: "110001", phone: "",
    });
    expect(registered.firm.trialEndsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registered.user.email).toBe("arjun@firm.example");

    // Signup leaves no usable password: login must fail until one is set.
    await expect(auth.login("arjun@firm.example", "anything")).rejects.toMatchObject({
      statusCode: 401,
    });

    const mailer = new CapturingMailer();
    const resetAuth = new AuthService(repos, mailer);
    await resetAuth.requestPasswordReset("arjun@firm.example");
    await resetAuth.consumePasswordReset(mailer.sends[0]!.token, "real-password");

    const session = await auth.login("arjun@firm.example", "real-password");
    expect(session.user.email).toBe("arjun@firm.example");
    expect(session.users).toHaveLength(1);

    const bundle = await auth.authenticate(session.token);
    expect(bundle?.firm.name).toBe("Kaul & Bhatnagar Associates");
    const view = await auth.sessionView(bundle!);
    expect(view.user.id).toBe(session.user.id);
    expect(JSON.stringify(view)).not.toContain("passwordHash");

    await auth.logout(session.token);
    expect(await auth.authenticate(session.token)).toBeNull();
  });

  it("email is unique globally — a second signup with the same address is 409", async () => {
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, new CapturingMailer());
    const input = {
      firstName: "A", lastName: "Owner", email: "dupe@firm.example",
      firmName: "First Firm", zip: "", phone: "",
    };
    await auth.register(input);
    await expect(auth.register(input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("firm + owner land in one transaction; cross-firm access is 404", async () => {
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, new CapturingMailer());
    const firmService = new FirmService(repos);
    const userService = new UserService(repos);

    const firmA = await auth.register({
      firstName: "Aditi", lastName: "Rao", email: "aditi@firm-a.example",
      firmName: "Firm A", zip: "", phone: "",
    });
    const firmB = await auth.register({
      firstName: "Bharat", lastName: "Nair", email: "bharat@firm-b.example",
      firmName: "Firm B", zip: "", phone: "",
    });

    const patched = await firmService.update(firmB.firm.id, { name: "Firm B Renamed" });
    expect(patched.name).toBe("Firm B Renamed");
    expect(patched.id).toBe(firmB.firm.id);

    const usersA = await userService.listByFirm(firmA.firm.id);
    expect(usersA.map((u) => u.email)).toEqual(["aditi@firm-a.example"]);

    // Cross-firm entity access 404s and writes nothing.
    await expect(
      userService.update(firmB.firm.id, firmA.user.id, { active: false }),
    ).rejects.toMatchObject({ statusCode: 404, message: "User not found" });

    const usersAAfter = await userService.listByFirm(firmA.firm.id);
    expect(usersAAfter[0]!.active).toBe(true);
    expect(await auth.authenticate(firmA.token)).not.toBeNull();
  });

  it("expired sessions fail authentication and are cleaned up", async () => {
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, new CapturingMailer());
    const registered = await auth.register({
      firstName: "C", lastName: "D", email: "expiry@firm.example",
      firmName: "Expiry Firm", zip: "", phone: "",
    });

    // Force-expire the session row directly, then authenticate.
    await handle.sql`update sessions set expires_at = now() - interval '1 minute'`;
    expect(await auth.authenticate(registered.token)).toBeNull();
    const rows = await handle.sql`select count(*)::int as n from sessions where id = ${registered.token}`;
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it("deactivating a user revokes their sessions (cascade table intact)", async () => {
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, new CapturingMailer());
    const userService = new UserService(repos);
    const registered = await auth.register({
      firstName: "E", lastName: "F", email: "deactivate@firm.example",
      firmName: "Deactivate Firm", zip: "", phone: "",
    });

    const mailer = new CapturingMailer();
    const resetAuth = new AuthService(repos, mailer);
    await resetAuth.requestPasswordReset(registered.user.email);
    await resetAuth.consumePasswordReset(mailer.sends[0]!.token, "password-123");
    const session = await auth.login(registered.user.email, "password-123");
    expect(await auth.authenticate(session.token)).not.toBeNull();

    await userService.update(registered.firm.id, registered.user.id, { active: false });
    expect(await auth.authenticate(session.token)).toBeNull();
  });
});
