import { describe, expect, it } from "vitest";
import {
  LAWLEIT_VIOLET,
  RESET_LINK_PATH,
  renderPasswordResetEmail,
  renderUserInviteEmail,
  resetLink,
} from "./templates.js";

const expiresAt = "2026-09-29T12:00:00.000Z";

describe("email templates", () => {
  it("reset: builds the app's /reset-password token URL from APP_BASE_URL", () => {
    const link = resetLink("http://localhost:5173", "tok-123");
    expect(link).toBe(`http://localhost:5173${RESET_LINK_PATH}?token=tok-123`);
    // Trailing slashes on the configured base must not double up.
    expect(resetLink("https://app.lawleit.in/", "t")).toBe(
      `https://app.lawleit.in${RESET_LINK_PATH}?token=t`,
    );
  });

  it("reset: text body carries the link, the one-time/expiry warning and the brand", () => {
    const email = renderPasswordResetEmail(
      { to: "owner@firm.example", token: "tok-123", expiresAt },
      "http://localhost:5173",
    );
    expect(email.kind).toBe("reset");
    expect(email.to).toBe("owner@firm.example");
    expect(email.subject).toContain("Lawleit");
    expect(email.subject.toLowerCase()).toContain("password");
    expect(email.bodyText).toContain(
      "http://localhost:5173/reset-password?token=tok-123",
    );
    expect(email.bodyText).toContain("expires");
    expect(email.bodyText).toContain("2026");
  });

  it("reset: html body is branded (violet header), links the token URL and escapes it", () => {
    const email = renderPasswordResetEmail(
      { to: "owner@firm.example", token: "tok-123", expiresAt },
      "http://localhost:5173",
    );
    expect(email.bodyHtml).toContain(LAWLEIT_VIOLET);
    expect(email.bodyHtml).toContain("Lawleit");
    expect(email.bodyHtml).toContain('href="http://localhost:5173/reset-password?token=tok-123"');
  });

  it("tokens are percent-encoded into the URL, so nothing raw reaches the HTML", () => {
    // Not a real token shape (base64url is URL-safe) — the test pins that
    // hostile token characters survive the URL percent-encoding and never
    // appear unencoded in the HTML body.
    const email = renderPasswordResetEmail(
      { to: "x@y.example", token: 'a<b>&"c', expiresAt },
      "http://localhost:5173",
    );
    expect(email.bodyText).toContain("token=a%3Cb%3E%26%22c");
    expect(email.bodyHtml).toContain("token=a%3Cb%3E%26%22c");
    expect(email.bodyHtml).not.toContain('a<b>&"c');
  });

  it("invite: same link machinery, invite copy, invites ride /reset-password", () => {
    const email = renderUserInviteEmail(
      { to: "new.member@firm.example", token: "inv-9", expiresAt },
      "https://app.lawleit.in",
    );
    expect(email.kind).toBe("invite");
    expect(email.subject).toContain("invited");
    expect(email.bodyText).toContain("https://app.lawleit.in/reset-password?token=inv-9");
    expect(email.bodyHtml).toContain('href="https://app.lawleit.in/reset-password?token=inv-9"');
    expect(email.bodyHtml).toContain(LAWLEIT_VIOLET);
    // The invite IS the reset machinery — the copy must say the link sets
    // the first password, not that it resets an existing one.
    expect(email.bodyText.toLowerCase()).toContain("set your password");
  });

  it("unparseable expiry renders verbatim instead of 'Invalid Date'", () => {
    const email = renderPasswordResetEmail(
      { to: "x@y.example", token: "t", expiresAt: "not-a-date" },
      "http://localhost:5173",
    );
    expect(email.bodyText).toContain("expires at not-a-date");
  });
});
