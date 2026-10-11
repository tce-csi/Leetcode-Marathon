/**
 * Domain error type used throughout the service layer. Route handlers convert
 * these into consistent JSON error responses with the correct HTTP status.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  badRequest: (message: string, details?: unknown) =>
    new AppError("BAD_REQUEST", message, 400, details),
  unauthorized: (message = "Authentication required.") =>
    new AppError("UNAUTHORIZED", message, 401),
  forbidden: (message = "You do not have permission to do that.") =>
    new AppError("FORBIDDEN", message, 403),
  notFound: (message = "Not found.") => new AppError("NOT_FOUND", message, 404),
  conflict: (message: string) => new AppError("CONFLICT", message, 409),
  tooManyRequests: (message = "Too many requests. Please slow down.") =>
    new AppError("RATE_LIMITED", message, 429),
  locked: (message: string) => new AppError("LEVEL_LOCKED", message, 403),
  unavailable: (message: string) => new AppError("UNAVAILABLE", message, 503),
};
