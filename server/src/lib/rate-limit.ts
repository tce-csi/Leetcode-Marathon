import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/types";
import { env } from "@/lib/env";

export interface RateLimitOptions {
  limit?: number;
  windowSeconds?: number;
  db?: Db;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  current: number;
}

/**
 * Fixed-window rate limiter backed by the database so that it behaves
 * correctly across serverless instances (unlike in-process counters).
 */
export async function checkRateLimit(
  bucketKey: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const db = options.db ?? getDb();
  const limit = options.limit ?? env.rateLimitMaxRequests;
  const windowSeconds = options.windowSeconds ?? env.rateLimitWindowSeconds;
  const windowMs = windowSeconds * 1000;
  const windowStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + windowMs);

  const result = await db.query<{ count: number }>(
    `insert into rate_limits (bucket_key, window_start, count)
     values ($1, $2, 1)
     on conflict (bucket_key, window_start)
     do update set count = rate_limits.count + 1
     returning count`,
    [bucketKey, windowStart.toISOString()],
  );

  const current = result.rows[0]?.count ?? 1;
  return {
    allowed: current <= limit,
    limit,
    remaining: Math.max(0, limit - current),
    resetAt,
    current,
  };
}

export async function isRateLimited(
  bucketKey: string,
  options: RateLimitOptions = {},
): Promise<boolean> {
  const result = await checkRateLimit(bucketKey, options);
  return !result.allowed;
}
