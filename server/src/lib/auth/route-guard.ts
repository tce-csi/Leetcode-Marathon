import type { Request } from "express";
import { errors } from "@/lib/errors";
import type { AdminRole } from "@/lib/types";
import { assertCsrf, assertSameOrigin } from "./csrf";
import {
  getAdminCsrfCookie,
  getAdminSession,
  getStudentCsrfCookie,
  getStudentSession,
  type ActiveAdminSession,
  type ActiveStudentSession,
} from "./session";

/**
 * Validates origin + CSRF for state-changing requests made by an authenticated
 * student, then returns the active session.
 */
export async function requireStudentMutation(req: Request): Promise<ActiveStudentSession> {
  assertSameOrigin(req);
  const session = await getStudentSession(req);
  if (!session) throw errors.unauthorized("Please sign in to continue.");
  assertCsrf(req, getStudentCsrfCookie(req), session.csrfToken);
  return session;
}

export async function requireAdminMutation(
  req: Request,
  roles?: AdminRole[],
): Promise<ActiveAdminSession> {
  assertSameOrigin(req);
  const session = await getAdminSession(req);
  if (!session) throw errors.unauthorized("Administrator sign-in required.");
  if (roles && roles.length > 0 && !roles.includes(session.admin.role)) {
    throw errors.forbidden("Your administrator role cannot perform this action.");
  }
  assertCsrf(req, getAdminCsrfCookie(req), session.csrfToken);
  return session;
}
