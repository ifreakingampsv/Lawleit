import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("fails boot naming the missing required variable", () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/);
  });

  it("defaults PORT to 3001 and parses the CORS allow-list", () => {
    const config = loadConfig({
      SESSION_SECRET: "s3cret",
      CORS_ORIGINS: "http://localhost:5173, https://demo.lawleit.in",
      PORT: "3005",
    });
    expect(config).toEqual({
      port: 3005,
      corsOrigins: ["http://localhost:5173", "https://demo.lawleit.in"],
      sessionSecret: "s3cret",
      databaseUrl: null,
      cookieSameSite: "lax",
      cookieSecure: false,
      storage: null,
      email: {
        from: "Lawleit <onboarding@resend.dev>",
        resendApiKey: null,
        baseUrl: "http://localhost:5173",
      },
      gatewayEncryptionKey: null,
    });
  });

  it("treats DATABASE_URL as optional", () => {
    const config = loadConfig({ SESSION_SECRET: "s3cret" });
    expect(config.databaseUrl).toBeNull();
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: "s3cret", DATABASE_URL: "mysql://db.example/x" }),
    ).toThrow(/postgres/);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => loadConfig({ SESSION_SECRET: "s3cret", PORT: "99999" })).toThrow(/PORT/);
  });

  it("parses cookie knobs and rejects an unknown SameSite value", () => {
    const config = loadConfig({
      SESSION_SECRET: "s3cret",
      COOKIE_SAMESITE: "none",
      COOKIE_SECURE: "true",
    });
    expect(config.cookieSameSite).toBe("none");
    expect(config.cookieSecure).toBe(true);
    expect(() =>
      loadConfig({ SESSION_SECRET: "s3cret", COOKIE_SAMESITE: "strict" }),
    ).toThrow(/COOKIE_SAMESITE/);
  });

  it("treats the S3_* group as optional (storage: null when all unset)", () => {
    const config = loadConfig({ SESSION_SECRET: "s3cret" });
    expect(config.storage).toBeNull();
  });

  it("parses the full S3_* set with the 25 MB default cap", () => {
    const config = loadConfig({
      SESSION_SECRET: "s3cret",
      S3_ENDPOINT: "https://ref.supabase.co/storage/v1/s3",
      S3_REGION: "ap-south-1",
      S3_BUCKET: "lawleit-documents",
      S3_ACCESS_KEY_ID: "ref-access-key",
      S3_SECRET_ACCESS_KEY: "ref-secret",
    });
    expect(config.storage).toEqual({
      endpoint: "https://ref.supabase.co/storage/v1/s3",
      region: "ap-south-1",
      bucket: "lawleit-documents",
      accessKeyId: "ref-access-key",
      secretAccessKey: "ref-secret",
      maxUploadBytes: 25 * 1024 * 1024,
    });
  });

  it("parses S3_MAX_UPLOAD_MB into bytes", () => {
    const config = loadConfig({
      SESSION_SECRET: "s3cret",
      S3_ENDPOINT: "https://ref.supabase.co/storage/v1/s3",
      S3_REGION: "ap-south-1",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_MAX_UPLOAD_MB: "10",
    });
    expect(config.storage?.maxUploadBytes).toBe(10 * 1024 * 1024);
  });

  it("fails boot naming a partial S3_* set (a misconfiguration, not a mode)", () => {
    const partial = {
      SESSION_SECRET: "s3cret",
      S3_ENDPOINT: "https://ref.supabase.co/storage/v1/s3",
      S3_ACCESS_KEY_ID: "k",
    };
    expect(() => loadConfig(partial)).toThrow(/S3_REGION, S3_BUCKET, S3_SECRET_ACCESS_KEY/);
    expect(() => loadConfig(partial)).toThrow(/see backend\/\.env\.example/);
  });

  // Ticket 18: the email knobs are optional — no key means the console
  // sender (behavior identical to the stub era), and a blank string counts
  // as unset like DATABASE_URL does.
  it("treats the email group as optional (console sender, default from/base URL)", () => {
    const config = loadConfig({ SESSION_SECRET: "s3cret" });
    expect(config.email).toEqual({
      from: "Lawleit <onboarding@resend.dev>",
      resendApiKey: null,
      baseUrl: "http://localhost:5173",
    });
  });

  it("parses RESEND_API_KEY, EMAIL_FROM and APP_BASE_URL when set", () => {
    const config = loadConfig({
      SESSION_SECRET: "s3cret",
      RESEND_API_KEY: " re_test_123 ",
      EMAIL_FROM: "Lawleit <notifications@lawleit.in>",
      APP_BASE_URL: "https://app.lawleit.in/",
    });
    expect(config.email).toEqual({
      from: "Lawleit <notifications@lawleit.in>",
      resendApiKey: "re_test_123",
      baseUrl: "https://app.lawleit.in/",
    });
  });

  it("treats a blank RESEND_API_KEY as unset (console sender, not an empty bearer token)", () => {
    const config = loadConfig({ SESSION_SECRET: "s3cret", RESEND_API_KEY: "   " });
    expect(config.email.resendApiKey).toBeNull();
  });

  // V2 slice 1 (ticket 02): the gateway encryption key is optional as a group
  // of one — unset means the gateway surface is inert (503s, boot succeeds);
  // a too-short key is a misconfiguration that fails boot naming the variable.
  it("treats GATEWAY_ENCRYPTION_KEY as optional (null → the gateway feature stays inert)", () => {
    const config = loadConfig({ SESSION_SECRET: "s3cret" });
    expect(config.gatewayEncryptionKey).toBeNull();
  });

  it("parses GATEWAY_ENCRYPTION_KEY when set (trimmed)", () => {
    const config = loadConfig({
      SESSION_SECRET: "s3cret",
      GATEWAY_ENCRYPTION_KEY: "  0123456789abcdef0123456789abcdef  ",
    });
    expect(config.gatewayEncryptionKey).toBe("0123456789abcdef0123456789abcdef");
  });

  it("treats a blank GATEWAY_ENCRYPTION_KEY as unset", () => {
    const config = loadConfig({ SESSION_SECRET: "s3cret", GATEWAY_ENCRYPTION_KEY: "   " });
    expect(config.gatewayEncryptionKey).toBeNull();
  });

  it("fails boot naming GATEWAY_ENCRYPTION_KEY when the key is too short (weak keys are a misconfiguration, not a mode)", () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: "s3cret", GATEWAY_ENCRYPTION_KEY: "too-short" }),
    ).toThrow(/GATEWAY_ENCRYPTION_KEY/);
  });
});
