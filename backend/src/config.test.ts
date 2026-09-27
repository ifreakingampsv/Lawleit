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
});
