import { afterAll, describe, expect, it } from "vitest";
import { testApp as app, testDb as db } from "./helpers";

afterAll(() => db.$disconnect());

describe("GET /api/health", () => {
  it("reports the database as reachable", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, error: null, data: { ok: true, db: true } });
  });

  it("returns the JSON envelope for unknown routes", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("allows CORS only for configured web origins", async () => {
    const allowed = await app.request("/api/health", { headers: { Origin: "http://localhost:8081" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
    const denied = await app.request("/api/health", { headers: { Origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("health without a database client", () => {
  it("reports db:false instead of crashing", async () => {
    const { createApp } = await import("../src/app");
    const broken = createApp({
      db: () => {
        throw new Error("DATABASE_URL is not set");
      },
    });
    const res = await broken.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { ok: false, db: false } });
    expect((await broken.request("/api/me")).status).toBe(500);
  });
});
