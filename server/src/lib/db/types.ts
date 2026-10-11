/**
 * Minimal, driver-agnostic database interface.
 *
 * Both the production PostgreSQL driver (node-postgres) and the in-process test
 * database (PGlite) implement this interface, which lets all business logic and
 * integration tests share a single code path.
 */

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;

  /**
   * Runs `fn` inside a database transaction. The callback receives a `Db`
   * scoped to the transaction. If the callback throws, the transaction is
   * rolled back; otherwise it is committed.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export type Params = readonly unknown[];
