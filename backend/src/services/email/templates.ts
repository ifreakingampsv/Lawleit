import type { InviteEmail, PasswordResetEmail } from "../auth/mailer.js";

/**
 * The two V1 email templates (ticket 18 minimal set — reset + invite;
 * invoice/reminder mail is V2). Simple, branded, English-first: a violet
 * Lawleit header, one paragraph of copy, one call-to-action button, and the
 * plain link as the no-HTML / no-button-click fallback. Pure functions —
 * they render from the envelope + base URL and nothing else, which is what
 * makes them trivially testable.
 */

/** Brand violet, the same token the app and the seed data use. */
export const LAWLEIT_VIOLET = "#4B4ACF";

/**
 * The app route both links open: the invite IS the reset machinery (ticket
 * 08) — the token URL sets the account's first password either way.
 */
export const RESET_LINK_PATH = "/reset-password";

export interface RenderedEmail {
  kind: "reset" | "invite";
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export function resetLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${RESET_LINK_PATH}?token=${encodeURIComponent(token)}`;
}

/** HTML-escape interpolated values; bodies are static except the URL. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatExpiry(expiresAt: string): string {
  const at = new Date(expiresAt);
  return Number.isNaN(at.getTime()) ? expiresAt : at.toUTCString();
}

function shell(contentHtml: string): string {
  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2430;">`,
    `  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">`,
    `    <tr><td style="background:${LAWLEIT_VIOLET};padding:20px 32px;"><span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">Lawleit</span></td></tr>`,
    `    <tr><td style="padding:32px;">${contentHtml}</td></tr>`,
    `    <tr><td style="padding:16px 32px;background:#f4f4f6;color:#6b7280;font-size:12px;">Lawleit — practice management for Indian law firms. If you did not expect this email, you can ignore it.</td></tr>`,
    `  </table>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:${LAWLEIT_VIOLET};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:6px;">${label}</a></p>`;
}

const CTA = "Set your password";

/** Password reset: "someone (hopefully you) asked to reset this password". */
export function renderPasswordResetEmail(
  email: Pick<PasswordResetEmail, "to" | "token" | "expiresAt">,
  baseUrl: string,
): RenderedEmail {
  const link = resetLink(baseUrl, email.token);
  const expires = formatExpiry(email.expiresAt);
  return {
    kind: "reset",
    to: email.to,
    subject: "Reset your Lawleit password",
    bodyText: [
      "Hello,",
      "",
      "We received a request to reset the password for your Lawleit account. Open the link below to choose a new password:",
      "",
      link,
      "",
      `This link works once and expires at ${expires}. If you did not request a reset, you can ignore this email — your password stays as it is.`,
    ].join("\n"),
    bodyHtml: shell(
      [
        `<h1 style="margin:0 0 16px;font-size:20px;">Reset your password</h1>`,
        `<p style="margin:0;line-height:1.6;">We received a request to reset the password for your Lawleit account. Click the button below to choose a new password.</p>`,
        button(link, CTA),
        `<p style="margin:16px 0 0;line-height:1.6;">Or paste this link into your browser:<br><a href="${link}" style="color:${LAWLEIT_VIOLET};word-break:break-all;">${escapeHtml(link)}</a></p>`,
        `<p style="margin:16px 0 0;line-height:1.6;color:#6b7280;">This link works once and expires at ${escapeHtml(expires)}. If you did not request a reset, you can ignore this email.</p>`,
      ].join("\n"),
    ),
  };
}

/** User invite: "you have been added to a Lawleit firm; set your password". */
export function renderUserInviteEmail(
  email: Pick<InviteEmail, "to" | "token" | "expiresAt">,
  baseUrl: string,
): RenderedEmail {
  const link = resetLink(baseUrl, email.token);
  const expires = formatExpiry(email.expiresAt);
  return {
    kind: "invite",
    to: email.to,
    subject: "You have been invited to Lawleit",
    bodyText: [
      "Hello,",
      "",
      "You have been added to a firm on Lawleit, the practice management platform for law firms. Open the link below to set your password and sign in:",
      "",
      link,
      "",
      `This link works once and expires at ${expires}. After it expires, ask your firm's owner to send a fresh invite.`,
    ].join("\n"),
    bodyHtml: shell(
      [
        `<h1 style="margin:0 0 16px;font-size:20px;">You have been invited to Lawleit</h1>`,
        `<p style="margin:0;line-height:1.6;">You have been added to a firm on Lawleit, the practice management platform for law firms. Click the button below to set your password and sign in.</p>`,
        button(link, CTA),
        `<p style="margin:16px 0 0;line-height:1.6;">Or paste this link into your browser:<br><a href="${link}" style="color:${LAWLEIT_VIOLET};word-break:break-all;">${escapeHtml(link)}</a></p>`,
        `<p style="margin:16px 0 0;line-height:1.6;color:#6b7280;">This link works once and expires at ${escapeHtml(expires)}. After it expires, ask your firm's owner to send a fresh invite.</p>`,
      ].join("\n"),
    ),
  };
}
