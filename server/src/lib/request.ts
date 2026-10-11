import type { Request } from "express";

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value) return value.split(",")[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

export function getUserAgent(req: Request): string {
  const value = req.headers["user-agent"];
  return (typeof value === "string" ? value : "").slice(0, 400);
}
