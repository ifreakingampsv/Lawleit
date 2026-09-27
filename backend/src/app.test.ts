import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { closeDb } from "./db/client.js";
import type { AppConfig } from "./config.js";

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
};

afterEach(async () => {
  await closeDb();
});

describe("health", () => {
  it("GET /health returns the contract health shape", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; service: string; now: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("lawleit-api");
    expect(typeof body.now).toBe("string");
    await app.close();
  });

  it("reports db:unconfigured when DATABASE_URL is not set", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json().db).toBe("unconfigured");
    await app.close();
  });

  it("reports db:unreachable (not a crash) when the database refuses connections", async () => {
    const app = await buildApp({
      ...testConfig,
      // Port 1 on loopback refuses immediately — no real database needed.
      databaseUrl: "postgresql://lawleit:lawleit@127.0.0.1:1/lawleit?sslmode=disable",
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().db).toBe("unreachable");
    await app.close();
  });

  it("GET /api/v1/health serves the same shape under the contract prefix", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });
});

describe("error envelope", () => {
  it("unknown routes return 404 { error }", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/definitely-not-a-route" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "No route: GET /definitely-not-a-route" });
    await app.close();
  });

  it("unknown routes under /api/v1 return the same shape", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/definitely-not-a-route" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/^No route: GET /);
    await app.close();
  });

  it("unexpected handler errors surface as 500 { error } without internals", async () => {
    const app = await buildApp(testConfig);
    app.post("/__test/boom", async () => {
      throw new Error("database password is hunter2");
    });
    const res = await app.inject({ method: "POST", url: "/__test/boom", payload: {} });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Internal error" });
    await app.close();
  });

  it("malformed JSON bodies return 400 { error }", async () => {
    const app = await buildApp(testConfig);
    app.post("/__test/echo", async (request) => request.body);
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
    await app.close();
  });
});

describe("CORS allow-list", () => {
  it("reflects allow-listed origins with credentials", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });

  it("withholds CORS headers from non-allow-listed origins", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
