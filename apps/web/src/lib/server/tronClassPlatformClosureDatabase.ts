import 'server-only';
import { createRequire } from 'node:module';
import { NuniError } from '@campus/shared/src/nuni';
import type { SqlQuery } from '../nuni/assignmentFileStore';

type ClosurePool = {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  end(): Promise<void>;
};
type ClosurePoolOptions = {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
  options: string;
};
type ClosureDatabase = { query: SqlQuery; close(): Promise<void> };
const databases = new Map<string, ClosureDatabase>();

function unavailable(): never { throw new NuniError(503, 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE'); }

/** pg URL parameters override client settings, so these must not weaken bounds. */
export function isTronClassPlatformClosureDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username ||
      !url.pathname || url.pathname === '/') return false;
    return !['options', 'statement_timeout', 'query_timeout', 'connectionTimeoutMillis', 'connect_timeout']
      .some(key => url.searchParams.has(key));
  } catch { return false; }
}

function defaultPool(options: ClosurePoolOptions): ClosurePool {
  const pg = createRequire(import.meta.url)('pg') as { Pool: new (options: ClosurePoolOptions) => ClosurePool };
  return new pg.Pool(options);
}

/** Dedicated pool: neither the general file store nor its unbounded I/O settings. */
export function createTronClassPlatformClosureDatabase(
  connectionString: string,
  createPool: (options: ClosurePoolOptions) => ClosurePool = defaultPool,
): ClosureDatabase {
  if (!isTronClassPlatformClosureDatabaseUrl(connectionString)) return unavailable();
  let pool: ClosurePool;
  try {
    pool = createPool({ connectionString, max: 2, connectionTimeoutMillis: 5_000,
      query_timeout: 10_000, statement_timeout: 10_000,
      options: '-c search_path=pg_catalog,public,pg_temp' });
    // An idle connection failure must not become an uncaught EventEmitter error.
    pool.on('error', () => { console.warn('TronClass platform account cleanup database connection failed'); });
  } catch { return unavailable(); }
  return {
    async query(sql, parameters) {
      // Server statement_timeout cancels SQL; pg-pool destroys failed clients.
      // No Promise.race leaves an unbounded database command running elsewhere.
      try { return (await pool.query(sql, parameters)).rows; }
      catch { return unavailable(); }
    },
    async close() {
      try { await pool.end(); } catch { return unavailable(); }
    },
  };
}

export function tronClassPlatformClosureQuery(connectionString: string): SqlQuery {
  let database = databases.get(connectionString);
  if (!database) {
    database = createTronClassPlatformClosureDatabase(connectionString);
    databases.set(connectionString, database);
  }
  return database.query;
}
