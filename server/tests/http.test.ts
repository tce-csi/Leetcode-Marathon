import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { z } from "zod";
import { errors } from "@/lib/errors";
import { asyncHandler, errorHandler, fail, ok } from "@/lib/http";

describe("response envelope", () => {
  it("wraps success payloads in { ok: true, data }", async () => {
    const app = express();
    app.get("/ok", (_req, res) => ok(res, { hello: "world" }));
    const res = await request(app).get("/ok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { hello: "world" } });
  });

  it("wraps failures in { ok: false, error }", async () => {
    const app = express();
    app.get("/fail", (_req, res) => fail(res, "NOPE", "Not allowed", 403, { why: "test" }));
    const res = await request(app).get("/fail");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      error: { code: "NOPE", message: "Not allowed", details: { why: "test" } },
    });
  });
});

describe("error middleware mapping", () => {
  function build() {
    const app = express();
    app.use(
      "/",
      asyncHandler(async (req, res) => {
        if (req.path === "/zod") {
          z.object({ n: z.number() }).parse({ n: "no" });
          ok(res, null);
        } else if (req.path === "/apperror") {
          throw errors.forbidden("Hidden");
        } else if (req.path === "/boom") {
          throw new Error("boom");
        }
        ok(res, 42);
      }),
    );
    app.use(errorHandler);
    return app;
  }

  it("passes through successful handlers", async () => {
    const res = await request(build()).get("/fine");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: 42 });
  });

  it("maps ZodError to 422 with issue details", async () => {
    const res = await request(build()).get("/zod");
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it("maps AppError to its status and code", async () => {
    const res = await request(build()).get("/apperror");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Hidden", details: undefined },
    });
  });

  it("maps unknown errors to a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(build()).get("/boom");
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
      expect(res.body.error.message).not.toContain("boom");
    } finally {
      spy.mockRestore();
    }
  });

  it("serves GET /api/health with status 200", async () => {
    const { createApp } = await import("@/app");
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: "ok" } });
  });
});