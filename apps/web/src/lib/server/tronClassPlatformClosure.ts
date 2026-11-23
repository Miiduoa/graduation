import 'server-only';
import { randomUUID } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import { isPlatformAssistantAccountId } from '@campus/shared/src/platformAssistantPermissions';
import type { SqlQuery } from '../nuni/assignmentFileStore';
import { isTronClassPlatformClosureDatabaseUrl, tronClassPlatformClosureQuery } from './tronClassPlatformClosureDatabase';

const LEASE_SECONDS = 300;
const MAX_BATCH_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type TronClassPlatformClosureLease = {
  id: string;
  accountId: string;
  token: string;
  attempts: number;
};
export type TronClassPlatformClosureStore = {
  claim(): Promise<TronClassPlatformClosureLease | null>;
  complete(lease: TronClassPlatformClosureLease): Promise<boolean>;
  retry(lease: TronClassPlatformClosureLease): Promise<boolean>;
};
export type TronClassPlatformClosureBatch = { claimed: number; completed: number; failed: number; stale: number };

export const TRONCLASS_PLATFORM_CLOSURE_SQL = {
  claim: `WITH ready AS MATERIALIZED (
      SELECT id FROM tronclass_account_closure_outbox
      WHERE next_attempt_at <= clock_timestamp()
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE tronclass_account_closure_outbox event
      SET lease_token = $1::uuid, lease_expires_at = clock_timestamp() + make_interval(secs => $2::integer),
        attempts = LEAST(event.attempts + 1, 1000000)
      FROM ready WHERE event.id = ready.id
      RETURNING event.id::text, event.platform_account_id, event.reason, event.attempts, event.lease_token::text`,
  complete: `DELETE FROM tronclass_account_closure_outbox
    WHERE id = $1::bigint AND lease_token = $2::uuid RETURNING id::text`,
  retry: `UPDATE tronclass_account_closure_outbox
    SET lease_token = NULL, lease_expires_at = NULL, last_failure = 'cleanup_failed',
      next_attempt_at = clock_timestamp() + make_interval(secs => LEAST(1800, (30 * power(2, LEAST(attempts - 1, 6)))::integer))
    WHERE id = $1::bigint AND lease_token = $2::uuid RETURNING id::text`,
  // Readiness of the whole closure pipeline, not just the worker's configuration:
  // the outbox exists with the worker's privileges and both enabled triggers are
  // installed on the platform account table that the worker's search path resolves.
  ready: `SELECT (
      to_regclass('tronclass_account_closure_outbox') IS NOT NULL
      AND to_regclass('platform_accounts') IS NOT NULL
      AND coalesce(has_table_privilege(to_regclass('tronclass_account_closure_outbox'), 'SELECT'), false)
      AND coalesce(has_any_column_privilege(to_regclass('tronclass_account_closure_outbox'), 'UPDATE'), false)
      AND coalesce(has_table_privilege(to_regclass('tronclass_account_closure_outbox'), 'DELETE'), false)
      AND (SELECT count(DISTINCT trigger.tgname) FROM pg_trigger trigger
        WHERE trigger.tgrelid = to_regclass('platform_accounts') AND NOT trigger.tgisinternal
          AND trigger.tgenabled IN ('O', 'A')
          AND trigger.tgname IN ('tronclass_account_closed', 'tronclass_account_deleted')) = 2
    ) AS ready`,
} as const;

/** Fails closed unless the outbox, worker privileges and closure triggers are all in place. */
export async function verifyTronClassPlatformClosureReady(query: SqlQuery): Promise<void> {
  let rows: Record<string, unknown>[];
  try { rows = await query(TRONCLASS_PLATFORM_CLOSURE_SQL.ready, []); } catch { return unavailable(); }
  if (rows.length !== 1 || rows[0].ready !== true) return unavailable();
}

function unavailable(): never { throw new NuniError(503, 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE'); }
function eventId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= BigInt('9223372036854775807');
}
function validLease(value: TronClassPlatformClosureLease): boolean {
  return !!value && eventId(value.id) && isPlatformAssistantAccountId(value.accountId) &&
    typeof value.token === 'string' && UUID.test(value.token) && Number.isInteger(value.attempts) &&
    value.attempts >= 1 && value.attempts <= 1000000;
}

/** Parameterized server-only queue access. No account scan or request-selected owner. */
export function createSqlTronClassPlatformClosureStore(query: SqlQuery): TronClassPlatformClosureStore {
  async function run(sql: string, parameters: unknown[]) {
    try { return await query(sql, parameters); } catch { return unavailable(); }
  }
  async function finish(sql: string, lease: TronClassPlatformClosureLease) {
    if (!validLease(lease)) return unavailable();
    const rows = await run(sql, [lease.id, lease.token]);
    if (rows.length === 0) return false; // another lease owns the event now
    if (rows.length !== 1 || rows[0].id !== lease.id) return unavailable();
    return true;
  }
  return {
    async claim() {
      const token = randomUUID();
      const rows = await run(TRONCLASS_PLATFORM_CLOSURE_SQL.claim, [token, LEASE_SECONDS]);
      if (rows.length === 0) return null;
      if (rows.length !== 1) return unavailable();
      const row = rows[0];
      const lease = { id: row.id, accountId: row.platform_account_id, token: row.lease_token, attempts: row.attempts };
      if (!validLease(lease as TronClassPlatformClosureLease) || row.lease_token !== token ||
        (row.reason !== 'closed' && row.reason !== 'deleted')) return unavailable();
      return lease as TronClassPlatformClosureLease;
    },
    complete: lease => finish(TRONCLASS_PLATFORM_CLOSURE_SQL.complete, lease),
    retry: lease => finish(TRONCLASS_PLATFORM_CLOSURE_SQL.retry, lease),
  };
}

/** At-least-once delivery to the existing idempotent Firestore closure hook. */
export function createTronClassPlatformClosureWorker({
  store, closeOwner,
}: { store: TronClassPlatformClosureStore; closeOwner(ownerKey: string): Promise<void> }) {
  return async function runBatch(limit = 10): Promise<TronClassPlatformClosureBatch> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) return unavailable();
    const result: TronClassPlatformClosureBatch = { claimed: 0, completed: 0, failed: 0, stale: 0 };
    for (let index = 0; index < limit; index++) {
      const lease = await store.claim();
      if (!lease) break;
      if (!validLease(lease)) return unavailable();
      result.claimed++;
      try {
        await closeOwner(`platform:${lease.accountId}`);
      } catch {
        // Only a fixed error marker is stored; session data and raw errors never are.
        if (!await store.retry(lease)) result.stale++;
        result.failed++;
        continue;
      }
      // Removing the successful event also removes its now-unneeded platform ID.
      // A crash before this point causes a safe, idempotent retry after lease expiry.
      if (await store.complete(lease)) result.completed++;
      else result.stale++;
    }
    return result;
  };
}

export function readTronClassPlatformClosureConfig(env: Record<string, string | undefined> = process.env) {
  if (env.TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED !== 'true') return null;
  const databaseUrl = env.TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL?.trim();
  if (!databaseUrl || !isTronClassPlatformClosureDatabaseUrl(databaseUrl)) return null;
  return { databaseUrl };
}

/** No HTTP entry point. Only explicit worker configuration can reach either store. */
export async function runDefaultTronClassPlatformClosureBatch(
  env: Record<string, string | undefined> = process.env,
): Promise<TronClassPlatformClosureBatch> {
  const config = readTronClassPlatformClosureConfig(env);
  if (!config) return { claimed: 0, completed: 0, failed: 0, stale: 0 };
  const [{ getFirebaseAdmin }, { closeTronClassOwner }] = await Promise.all([
    import('./firebaseAdmin'), import('../../../../../backend/functions/tronClassAccountLifecycle.js'),
  ]);
  const admin = await getFirebaseAdmin();
  if (!admin?.db) return unavailable();
  const query = tronClassPlatformClosureQuery(config.databaseUrl);
  await verifyTronClassPlatformClosureReady(query);
  const store = createSqlTronClassPlatformClosureStore(query);
  const result = await createTronClassPlatformClosureWorker({ store,
    closeOwner: ownerKey => closeTronClassOwner({ db: admin.db, ownerKey }),
  })();
  if (result.failed > 0) console.warn('TronClass platform account cleanup failed');
  return result;
}
