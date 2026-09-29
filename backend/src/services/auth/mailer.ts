/**
 * Mailer seam (ticket 18 delivered the real sender). Nothing else in the
 * codebase knows how a message leaves the system: the auth services call
 * this interface, and buildApp binds either the ticket-18 outbox pipeline
 * (services/email/mailer.ts — durable rows + Resend/console delivery) or,
 * stateless, the console stub below.
 */
export interface PasswordResetEmail {
  to: string;
  token: string;
  /** ISO instant after which the token stops working. */
  expiresAt: string;
  /**
   * Ticket 18: the recipient's firm, recorded on the outbox row as an
   * informational soft link (support/debug — "what did we mail firm X").
   * Optional so every existing Mailer implementation stays valid.
   */
  firmId?: string;
}

/**
 * Ticket 08: an invite is the same single-use token machinery as a password
 * reset (the consume route sets the user's first password), so the envelope is
 * identical — only the email copy differs.
 */
export type InviteEmail = PasswordResetEmail;

export interface Mailer {
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
  sendUserInvite(email: InviteEmail): Promise<void>;
}

/**
 * The no-database binding (stateless boots, some unit tests): logs the reset
 * link so local runs can complete the flow by hand. The token is the only
 * copy that exists — it is never stored in plaintext — so printing it here
 * (dev only) is the handoff mechanism. With a database the outbox pipeline
 * takes over and the same link is logged by the console SENDER inside the
 * worker (RESEND_API_KEY unset) or delivered by Resend (set).
 */
export class ConsoleMailer implements Mailer {
  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    const base = process.env.APP_BASE_URL ?? "http://localhost:5173";
    console.log(
      `[mailer:stub] password reset for ${email.to}: ${base}/reset-password?token=${email.token} ` +
        `(expires ${email.expiresAt})`,
    );
  }

  async sendUserInvite(email: InviteEmail): Promise<void> {
    const base = process.env.APP_BASE_URL ?? "http://localhost:5173";
    console.log(
      `[mailer:stub] user invite for ${email.to}: ${base}/reset-password?token=${email.token} ` +
        `(expires ${email.expiresAt})`,
    );
  }
}
