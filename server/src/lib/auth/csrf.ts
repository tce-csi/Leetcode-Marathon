import type { Request } from "express";
import { env } from "@/lib/env";
import { errors } from "@/lib/errors";
import { safeEqual } from "./tokens";

/**
 * Rejects state-changing requests that did not originate from an allowed
 * origin. In a split deployment (frontend and API on different hosts) the
 * configured FRONTEND_URL / CORS_ORIGINS are trusted; same-host requests are
 * also accepted so single-origin deployments and non-browser clients work.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (!origin) return; // Non-browser clients (tests, curl) omit Origin.
  const cleanOrigin = origin.replace(/\/$/, "");
  if (env.corsOrigins.includes(cleanOrigin)) return;
  if (cleanOrigin.endsWith(".netlify.app")) return;

  const host = req.headers.host;
  try {
    const parsed = new URL(origin);
    if (!host || parsed.host !== host) {
      throw errors.forbidden("Cross-origin request rejected.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cross-origin")) throw error;
    throw errors.forbidden("Invalid origin header.");
  }
}

/**
 * Double-submit CSRF check: the value sent in the `x-csrf-token` header must
 * match the token stored in the (JS-readable) CSRF cookie and the token bound
 * to the session record.
 */
export function assertCsrf(
  req: Request,
  cookieToken: string | undefined,
  sessionToken: string | undefined,
): void {
  const header = req.headers["x-csrf-token"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !cookieToken || !sessionToken) {
    throw errors.forbidden("Missing CSRF token.");
  }
  if (!safeEqual(value, cookieToken) || !safeEqual(value, sessionToken)) {
    throw errors.forbidden("Invalid CSRF token.");
  }
}
