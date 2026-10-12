import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type { ServerResponse } from "node:http";
import { errorHandler } from "@/lib/http";
import { env } from "@/lib/env";
import { finalizePerf, perfStorage, serverTimingHeader, withPerfContext } from "@/lib/perf";
import { adminRoutes } from "@/routes/admin.routes";
import { authRoutes } from "@/routes/auth.routes";
import { contestRoutes } from "@/routes/contest.routes";
import { studentRoutes } from "@/routes/student.routes";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const clean = origin.replace(/\/$/, "");
        if (env.corsOrigins.includes(clean)) {
          return callback(null, true);
        }
        if (clean.endsWith(".netlify.app")) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed."));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const inbound = Array.isArray(req.headers["x-request-id"]) ? req.headers["x-request-id"][0] : req.headers["x-request-id"];
    if (typeof inbound === "string" && inbound.length > 0 && inbound.length <= 128) {
      res.setHeader("x-request-id", inbound);
    }
    withPerfContext(() => {
      const originalEnd = res.end;
      res.end = function (this: ServerResponse, ...args: Parameters<ServerResponse["end"]>) {
        const context = perfStorage.getStore();
        if (context) {
          const stats = finalizePerf(context);
          if (!res.headersSent) {
            res.setHeader("server-timing", serverTimingHeader(stats));
            res.setHeader("x-request-id", stats.requestId);
          }
          if (process.env.NODE_ENV !== "test" && !env.isProduction && stats.totalMs > 750) {
            console.warn(
              `[perf] slow ${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(stats.totalMs)}ms ${stats.queries} queries id=${stats.requestId}`,
            );
          }
        }
        return originalEnd.apply(res, args);
      } as typeof res.end;
      next();
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, data: { status: "ok" } });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api", contestRoutes);
  app.use("/api/student", studentRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "The requested route does not exist." },
    });
  });

  app.use(errorHandler);

  return app;
}