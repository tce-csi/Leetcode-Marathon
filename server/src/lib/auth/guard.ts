import type { Request } from "express";
import { errors } from "@/lib/errors";
import type { AdminRole } from "@/lib/types";
import {
  getAdminSession,
  getStudentSession,
  type ActiveAdminSession,
  type ActiveStudentSession,
} from "./session";

export async function requireStudent(req: Request): Promise<ActiveStudentSession> {
  const session = await getStudentSession(req);
  if (!session) throw errors.unauthorized("Please sign in to continue.");
  return session;
}

export async function requireAdmin(req: Request, roles?: AdminRole[]): Promise<ActiveAdminSession> {
  const session = await getAdminSession(req);
  if (!session) throw errors.unauthorized("Administrator sign-in required.");
  if (roles && roles.length > 0 && !roles.includes(session.admin.role)) {
    throw errors.forbidden("Your administrator role cannot perform this action.");
  }
  return session;
}
