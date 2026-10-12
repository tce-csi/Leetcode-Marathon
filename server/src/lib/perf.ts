import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Lightweight per-request instrumentation for the Express server.
 *
 * Uses AsyncLocalStorage so every database call issued while handling a request
 * can be counted without threading parameters through the service layer. The
 * accumulated stats are emitted as a `Server-Timing` response header and used
 * for slow-request logging in non-production environments.
 *
 * This never logs secrets: only method, path, status, duration and the number
 * of database queries are recorded.
 */

export interface PerfContext {
  requestId: string;
  startedAt: number;
  queries: number;
}

export const perfStorage = new AsyncLocalStorage<PerfContext>();

/** Runs `fn` inside a fresh request-scoped performance context (no-op if re-entered). */
export function withPerfContext<T>(fn: () => T): T {
  const existing = perfStorage.getStore();
  if (existing) return fn();
  const context: PerfContext = {
    requestId: randomUUID(),
    startedAt: performance.now(),
    queries: 0,
  };
  return perfStorage.run(context, fn);
}

export function getPerfContext(): PerfContext | null {
  return perfStorage.getStore() ?? null;
}

/** Counts one database query against the current request, when one is active. */
export function countDbQuery(): void {
  const context = perfStorage.getStore();
  if (context) context.queries += 1;
}

export interface RequestPerfStats {
  requestId: string;
  totalMs: number;
  queries: number;
}

/** Computes elapsed stats for a request and formats the Server-Timing header. */
export function finalizePerf(context: PerfContext): RequestPerfStats {
  const totalMs = Math.max(0, performance.now() - context.startedAt);
  return {
    requestId: context.requestId,
    totalMs,
    queries: context.queries,
  };
}

export function serverTimingHeader(stats: RequestPerfStats): string {
  const dbMs = Math.round(stats.totalMs);
  return `total;dur=${dbMs},db;dur=0;desc="${stats.queries} queries"`;
}