/**
 * Mailer seam (ticket 18 delivers real email). Nothing else in the codebase
 * knows how a message leaves the system.
 */
export interface PasswordResetEmail {
  to: string;
  token: string;
  /** ISO instant after which the token stops working. */
  expiresAt: string;
}

export interface Mailer {
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
}

/**
 * Stub until ticket 18: logs the reset link so local runs can complete the
 * flow by hand. The token is the only copy that exists — it is never stored
 * in plaintext — so printing it here (dev only) is the handoff mechanism.
 */
export class ConsoleMailer implements Mailer {
  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    const base = process.env.APP_URL ?? "http://localhost:5173";
    console.log(
      `[mailer:stub] password reset for ${email.to}: ${base}/reset-password?token=${email.token} ` +
        `(expires ${email.expiresAt})`,
    );
  }
}
