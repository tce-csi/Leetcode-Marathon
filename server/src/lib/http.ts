import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, data } satisfies ApiSuccess<T>);
}

export function fail(
  res: Response,
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): void {
  res.status(status).json({ ok: false, error: { code, message, details } } satisfies ApiFailure);
}

/** Wraps an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Converts domain errors into consistent JSON error responses. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ZodError) {
    fail(res, "VALIDATION_ERROR", "The submitted data is invalid.", 422, error.issues);
    return;
  }
  if (error instanceof AppError) {
    fail(res, error.code, error.message, error.status, error.details);
    return;
  }
  console.error("[api] unhandled error", error);
  fail(res, "INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
