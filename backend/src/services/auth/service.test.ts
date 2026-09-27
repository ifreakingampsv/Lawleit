import { describe, expect, it } from "vitest";
import { AuthService } from "./service.js";
import { inMemoryAuthRepositories, CapturingMailer } from "./testing.js";
import { UserService } from "../users/service.js";
import { HttpError } from "../httpError.js";

const signupInput = {
  firstName: "Arjun",
  lastName: "Kaul",
  email: "Arjun@KaulBhatnagar.example",
  firmName: "Kaul & Bhatnagar Associates",
  zip: "110001",
  phone: "+91 11 4355 6210",
};

function build(mailer = new CapturingMailer(), now = () => new Date()) {
  return {
    service: new AuthService(inMemoryAuthRepositories(), mailer, now),
    mailer,
  };
}

describe("AuthService.register", () => {
  it("creates the firm, its owner, and a session token", async () => {
    const { service } = build();
    const result = await service.register(signupInput);

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.user.email).toBe("arjun@kaulbhatnagar.example");
    expect(result.user.role).toBe("owner");
    expect(result.user.firmId).toBe(result.firm.id);
    expect("passwordHash" in result.user).toBe(false);
    expect(result.firm.name).toBe("Kaul & Bhatnagar Associates");
    expect(result.firm.trialEndsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.users).toHaveLength(1);
  });

  it("rejects a duplicate email with 409", async () => {
    const { service } = build();
    await service.register(signupInput);
    await expect(service.register(signupInput)).rejects.toMatchObject({
      name: "HttpError",
      statusCode: 409,
    });
  });
});

describe("AuthService.login", () => {
  it("empty credentials → 401 'Email and password required' (contract message)", async () => {
    const { service } = build();
    await expect(service.login("", "")).rejects.toMatchObject({
      statusCode: 401,
      message: "Email and password required",
    });
  });

  it("rejects unknown emails and wrong passwords with one identical 401", async () => {
    const { service } = build();
    await service.register(signupInput);
    await expect(service.login("nobody@example.com", "pw")).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid email or password",
    });
    await expect(service.login(signupInput.email, "wrong")).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid email or password",
    });
  });

  it("an account created without a password cannot log in until one is set", async () => {
    const { service } = build();
    await service.register(signupInput);
    await expect(service.login(signupInput.email, "any-guess")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("after the password is set, login succeeds and issues a session", async () => {
    const { service, mailer } = build();
    await service.register(signupInput);
    await service.requestPasswordReset(signupInput.email);
    await service.consumePasswordReset(mailer.sends[0]!.token, "first-password");

    const result = await service.login("arjun@kaulbhatnagar.example", "first-password");
    expect(result.user.email).toBe("arjun@kaulbhatnagar.example");
    expect(result.users).toHaveLength(1);
  });
});

describe("AuthService sessions", () => {
  it("authenticate resolves a live session and logout kills it", async () => {
    const { service } = build();
    const { token } = await service.register(signupInput);

    const auth = await service.authenticate(token);
    expect(auth?.user.email).toBe("arjun@kaulbhatnagar.example");
    expect(auth?.firm.name).toBe("Kaul & Bhatnagar Associates");

    await service.logout(token);
    expect(await service.authenticate(token)).toBeNull();
  });

  it("unknown and malformed tokens are null", async () => {
    const { service } = build();
    expect(await service.authenticate(null)).toBeNull();
    expect(await service.authenticate("not-a-real-token")).toBeNull();
  });

  it("expired sessions no longer authenticate", async () => {
    let nowMs = 1_000_000_000_000;
    const { service } = build(new CapturingMailer(), () => new Date(nowMs));
    const { token } = await service.register(signupInput);

    nowMs += 7 * 86_400_000 - 60_000; // just before the week is up
    expect(await service.authenticate(token)).not.toBeNull();

    nowMs += 120_000; // just past it
    expect(await service.authenticate(token)).toBeNull();
  });
});

describe("AuthService password reset", () => {
  it("hands the single-use token to the mailer; response never leaks it", async () => {
    const { service, mailer } = build();
    await service.register(signupInput);
    await service.requestPasswordReset(signupInput.email);

    expect(mailer.sends).toHaveLength(1);
    expect(mailer.sends[0]!.to).toBe("arjun@kaulbhatnagar.example");
    expect(mailer.sends[0]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stays silent for unknown emails (no account enumeration)", async () => {
    const { service, mailer } = build();
    await service.requestPasswordReset("nobody@example.com");
    expect(mailer.sends).toHaveLength(0);
  });

  it("consume sets the new password, revokes old sessions, and burns the token", async () => {
    const { service, mailer } = build();
    const { token: sessionToken } = await service.register(signupInput);
    await service.requestPasswordReset(signupInput.email);
    const resetToken = mailer.sends[0]!.token;

    await service.consumePasswordReset(resetToken, "brand-new-pw");

    expect(await service.authenticate(sessionToken)).toBeNull();
    await expect(service.consumePasswordReset(resetToken, "again-pw")).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid or expired reset token",
    });
    await expect(
      service.login(signupInput.email, "any-guess"),
    ).rejects.toMatchObject({ statusCode: 401 });
    const result = await service.login(signupInput.email, "brand-new-pw");
    expect(result.user.email).toBe("arjun@kaulbhatnagar.example");
  });

  it("rejects expired tokens", async () => {
    let nowMs = 1_000_000_000_000;
    const { service, mailer } = build(new CapturingMailer(), () => new Date(nowMs));
    await service.register(signupInput);
    await service.requestPasswordReset(signupInput.email);

    nowMs += 3_600_000 + 1_000; // one hour TTL + 1s
    await expect(
      service.consumePasswordReset(mailer.sends[0]!.token, "new-password"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a missing or short password", async () => {
    const { service, mailer } = build();
    await service.register(signupInput);
    await service.requestPasswordReset(signupInput.email);
    const token = mailer.sends[0]!.token;

    await expect(service.consumePasswordReset(token, "")).rejects.toBeInstanceOf(HttpError);
    await expect(service.consumePasswordReset("", "long-enough-password")).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe("UserService firm scoping (ticket 07 slice)", () => {
  it("deactivation revokes live sessions and blocks the next login", async () => {
    const repos = inMemoryAuthRepositories();
    const mailer = new CapturingMailer();
    const auth = new AuthService(repos, mailer);
    const users = new UserService(repos, mailer);

    const { user, firm } = await auth.register(signupInput);
    // Set a password first so the login below exercises credentials, not the
    // unset-password path.
    await auth.requestPasswordReset(signupInput.email);
    await auth.consumePasswordReset(mailer.sends[0]!.token, "live-password");
    const session = await auth.login(signupInput.email, "live-password");
    expect(session.token).toBeTruthy();

    // Ticket 08: the victim is an invited member — the owner (the firm's last
    // active owner) can no longer deactivate themselves.
    const member = await users.create(user, {
      name: "Meera Iyer", email: "meera@kaulbhatnagar.example", role: "attorney",
    });
    await auth.consumePasswordReset(mailer.invites[0]!.token, "member-pass-123");
    const memberLogin = await auth.login("meera@kaulbhatnagar.example", "member-pass-123");

    await users.update(user, firm.id, member.id, { active: false });

    // (token, the signup session, died earlier when the owner consumed their
    // password reset — consumePasswordReset revokes that user's sessions.)
    expect(await auth.authenticate(memberLogin.token)).toBeNull();
    expect(await auth.authenticate(session.token)).not.toBeNull();
    await expect(auth.login("meera@kaulbhatnagar.example", "member-pass-123")).rejects.toMatchObject({
      statusCode: 403,
      message: "Account is deactivated",
    });
  });
});
