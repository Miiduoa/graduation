import 'server-only';
import {
  TRONCLASS_ACCOUNT_LOGIN_LIMIT, TRONCLASS_LOGIN_WINDOW_MS, TRONCLASS_OWNER_LOGIN_LIMIT, TRONCLASS_TARGET_LOGIN_LIMIT, tronClassLoginAttemptTimestamp,
} from './tronClassBinding';

type Data = Record<string, unknown>;
type Ref = { path: string };
type Snapshot = { exists: boolean; ref: Ref; data(): Data | undefined };
type Query = {
  where(field: string, operator: '<=', value: Date): Query;
  orderBy(field: string): Query;
  startAfter(snapshot: Snapshot): Query;
  limit(value: number): Query;
  get(): Promise<{ docs: Snapshot[] }>;
};
export type TronClassRetentionStore = {
  collection(path: string): Query;
  runTransaction<T>(run: (tx: {
    get(ref: Ref): Promise<Snapshot>;
    delete(ref: Ref): unknown;
  }) => Promise<T>): Promise<T>;
};
export type TronClassRetentionResult = { scanned: number; deleted: number; skipped: boolean };

export const TRONCLASS_RETENTION_BATCH_SIZE = 50;
const COLLECTIONS = ['_tronClassBindings', '_tronClassLoginAttempts', '_tronClassSubmissionOperations'] as const;
type Collection = typeof COLLECTIONS[number];
const FAILURE = 'TronClass retention unavailable';

function instant(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function timestamp(value: unknown): number | null {
  try {
    const millis: unknown = value instanceof Date ? value.getTime()
      : value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function'
        ? value.toMillis() : null;
    return instant(millis) ? millis : null;
  } catch { return null; }
}

function canDelete(collection: Collection, row: Data | undefined, now: number): boolean {
  if (!row) return false;
  const purgeAt = timestamp(row.purgeAt);
  if (purgeAt === null || purgeAt > now) return false;
  if (collection === '_tronClassBindings') {
    // Closed/disconnected revisions are permanent barriers to late login writes.
    return row.schoolId === 'pu' && row.state === 'connected' &&
      instant(row.expiresAt) && row.expiresAt <= now &&
      instant(row.updatedAt) && row.updatedAt < row.expiresAt;
  }
  if (collection === '_tronClassLoginAttempts') {
    const maximum = row.scope === 'owner' ? TRONCLASS_OWNER_LOGIN_LIMIT
      : row.scope === 'target-account' ? TRONCLASS_TARGET_LOGIN_LIMIT
      : (row.scope === 'account' || row.scope === 'owner-account') ? TRONCLASS_ACCOUNT_LOGIN_LIMIT : 0;
    // A stale purgeAt must never reset a renewed school-account login budget.
    return maximum > 0 && Array.isArray(row.timestamps) &&
      row.timestamps.length <= maximum && row.timestamps.every(value =>
        tronClassLoginAttemptTimestamp(value) <= now - TRONCLASS_LOGIN_WINDOW_MS);
  }
  // v2 records, unknown results and in-flight submissions have no safe automatic
  // expiry. Retain them even if a malformed/older writer supplied a past date.
  return row.schoolId === 'pu' && row.version === 1 &&
    (row.state === 'draft' || row.state === 'submitted') &&
    instant(row.createdAt) && instant(row.updatedAt) && row.createdAt <= row.updatedAt &&
    row.updatedAt <= purgeAt;
}

/** Bounded server-side cleanup for Spark; never reads or deletes submission locks. */
export function createTronClassRetentionWorker({ db, now = Date.now }: {
  db: TronClassRetentionStore;
  now?: () => number;
}): () => Promise<TronClassRetentionResult> {
  let running = false;
  let firstCollection = 0;
  const cursors: Array<Snapshot | null> = COLLECTIONS.map(() => null);
  return async () => {
    if (running) return { scanned: 0, deleted: 0, skipped: true };
    running = true;
    try {
      const at = now();
      if (!instant(at)) throw new Error(FAILURE);
      let scanned = 0;
      let deleted = 0;
      const first = firstCollection;
      firstCollection = (firstCollection + 1) % COLLECTIONS.length;
      for (let position = 0; position < COLLECTIONS.length; position += 1) {
        const index = (first + position) % COLLECTIONS.length;
        const collection = COLLECTIONS[index];
        const budget = Math.floor((TRONCLASS_RETENTION_BATCH_SIZE - scanned) / (COLLECTIONS.length - position));
        let query = db.collection(collection).where('purgeAt', '<=', new Date(at)).orderBy('purgeAt');
        const cursor = cursors[index];
        if (cursor) query = query.startAfter(cursor);
        const candidates = await query.limit(budget).get();
        if (candidates.docs.length > budget) throw new Error(FAILURE);
        for (const candidate of candidates.docs) {
          const path = candidate.ref.path;
          if (!path.startsWith(`${collection}/`) || path.split('/').length !== 2) throw new Error(FAILURE);
          scanned += 1;
          // The query only proposes candidates. A fresh transaction decides
          // against the current expiry/state and retries on concurrent writes.
          const removed = await db.runTransaction(async tx => {
            const current = await tx.get(candidate.ref);
            if (!current.exists || !canDelete(collection, current.data(), at)) return false;
            tx.delete(candidate.ref);
            return true;
          });
          if (removed) deleted += 1;
        }
        // Progress past protected/malformed rows so they cannot permanently
        // starve later expired records. Wrap when a collection's pass finishes.
        cursors[index] = candidates.docs.length === budget ? candidates.docs.at(-1)! : null;
      }
      return { scanned, deleted, skipped: false };
    } catch {
      // Never expose document IDs, owner keys, cookies or provider errors.
      throw new Error(FAILURE);
    } finally { running = false; }
  };
}

let defaultWorker: ReturnType<typeof createTronClassRetentionWorker> | null = null;
export async function runDefaultTronClassRetentionBatch(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TronClassRetentionResult> {
  if (env.TRONCLASS_RETENTION_ENABLED !== 'true' || env.NEXT_RUNTIME !== 'nodejs') {
    return { scanned: 0, deleted: 0, skipped: true };
  }
  try {
    const { getFirebaseAdmin } = await import('./firebaseAdmin');
    const admin = await getFirebaseAdmin(env);
    if (!admin) throw new Error(FAILURE);
    defaultWorker ??= createTronClassRetentionWorker({ db: admin.db as unknown as TronClassRetentionStore });
    return await defaultWorker();
  } catch { throw new Error(FAILURE); }
}
