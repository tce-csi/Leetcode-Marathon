import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { errorHandler } from "@/lib/http";
import { env } from "@/lib/env";
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