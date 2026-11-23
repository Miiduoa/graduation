// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createTronClassBindingService, TRONCLASS_BINDING_TTL_MS, type TronClassBindingStore } from './tronClassBinding';
import { createTronClassRetentionWorker, TRONCLASS_RETENTION_BATCH_SIZE, type TronClassRetentionStore } from './tronClassRetention';

vi.mock('./tronClassRetentionScheduler', () => ({ isTronClassRetentionSchedulerStarted: () => true }));

vi.mock('server-only', () => ({}));
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? '';
const localEmulator = /^(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(emulatorHost);
if (emulatorHost && !localEmulator) throw new Error('Explicit local Firestore emulator required');
const PROJECT = 'demo-tronclass-retention';
const NOW = Date.parse('2030-06-01T00:00:00.000Z');
const OWNER = 'firebase:retention-emulator-owner';
const BINDINGS = '_tronClassBindings';
const QUOTAS = '_tronClassLoginAttempts';
const OPERATIONS = '_tronClassSubmissionOperations';
const LOCKS = '_tronClassSubmissionLocks';
const bindingPath = `${BINDINGS}/${createHash('sha256').update(OWNER).digest('hex')}`;
const expired = new Date(NOW - 1);
const quota = () => ({ scope: 'account', timestamps: [NOW - 3600_000], purgeAt: expired });
const binding = () => ({ schoolId: 'pu', state: 'connected', expiresAt: NOW - 1, updatedAt: NOW - 3600_000, purgeAt: expired });
const operation = () => ({ version: 1, schoolId: 'pu', state: 'draft', createdAt: NOW - 86400_001, updatedAt: NOW - 86400_001, purgeAt: expired });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Pause only after a real query; all transactions remain real Admin SDK calls. */
function pauseQuery(db: Firestore, target: string) {
  const entered = deferred();
  const resume = deferred();
  let once = true;
  const database = db as unknown as TronClassRetentionStore;
  const wrapped: TronClassRetentionStore = {
    runTransaction: callback => database.runTransaction(callback),
    collection(path) {
      const wrap = (query: ReturnType<TronClassRetentionStore['collection']>): ReturnType<TronClassRetentionStore['collection']> => ({
        where: (...args) => wrap(query.where(...args)),
        orderBy: (...args) => wrap(query.orderBy(...args)),
        startAfter: (...args) => wrap(query.startAfter(...args)),
        limit: (...args) => wrap(query.limit(...args)),
        async get() {
          const result = await query.get();
          if (path === target && once) {
            once = false;
            entered.resolve();
            await resume.promise;
          }
          return result;
        },
      });
      return wrap(database.collection(path));
    },
  };
  return { db: wrapped, entered: entered.promise, resume: resume.resolve };
}

describe.skipIf(!localEmulator)('bounded TronClass retention with real Firestore transactions', () => {
  let app: App;
  let otherApp: App;
  let db: Firestore;
  let otherDb: Firestore;
  const worker = (database: TronClassRetentionStore = db as unknown as TronClassRetentionStore) =>
    createTronClassRetentionWorker({ db: database, now: () => NOW });
  const read = async (path: string) => (await db.doc(path).get()).data();
  const seed = async (rows: Array<[string, Record<string, unknown>]>) => {
    const batch = db.batch();
    for (const [path, row] of rows) batch.set(db.doc(path), row);
    await batch.commit();
  };

  beforeAll(() => {
    vi.stubEnv('TRONCLASS_RETENTION_ENABLED', 'true');
    app = initializeApp({ projectId: PROJECT }, `${PROJECT}-first-client`);
    otherApp = initializeApp({ projectId: PROJECT }, `${PROJECT}-second-client`);
    db = getFirestore(app);
    otherDb = getFirestore(otherApp);
  });
  beforeEach(async () => {
    const response = await fetch(`http://${emulatorHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
      method: 'DELETE', signal: AbortSignal.timeout(10_000),
    });
    expect(response.ok).toBe(true);
  }, 20_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all([db.terminate(), otherDb.terminate()]);
    await Promise.all([deleteApp(app), deleteApp(otherApp)]);
  });

  it('deletes only expired connected bindings, quotas and v1 draft/submitted records; keeps barriers and locks', async () => {
    const removable: Array<[string, Record<string, unknown>]> = [
      [`${BINDINGS}/expired`, binding()], [`${QUOTAS}/owner`, { ...quota(), scope: 'owner', ownerKey: OWNER }],
      [`${QUOTAS}/account`, quota()],
      [`${QUOTAS}/target-account`, { ...quota(), scope: 'target-account',
        timestamps: Array<number>(20).fill(NOW - 3600_000) }],
      [`${QUOTAS}/owner-account`, { ...quota(), scope: 'owner-account', ownerKey: OWNER,
        timestamps: [{ timestamp: NOW - 3600_000, id: 'a'.repeat(32) }] }],
      [`${QUOTAS}/refunded`, { ...quota(), scope: 'owner-account', ownerKey: OWNER, timestamps: [] }],
      [`${OPERATIONS}/draft`, operation()],
      [`${OPERATIONS}/submitted`, { ...operation(), state: 'submitted' }],
    ];
    const retained: Array<[string, Record<string, unknown>]> = [
      [`${BINDINGS}/closed`, { ...binding(), state: 'closed' }],
      [`${BINDINGS}/disconnected`, { ...binding(), state: 'disconnected' }],
      [`${BINDINGS}/renewed`, { ...binding(), expiresAt: NOW + 3600_000 }],
      [`${QUOTAS}/recent`, { ...quota(), timestamps: [NOW] }],
      [`${QUOTAS}/recent-target`, { ...quota(), scope: 'target-account', timestamps: [NOW] }],
      [`${QUOTAS}/recent-reservation`, { ...quota(), scope: 'owner-account', ownerKey: OWNER,
        timestamps: [{ timestamp: NOW, id: 'b'.repeat(32) }] }],
      [`${QUOTAS}/unrecognized`, { ...quota(), scope: 'other' }],
      [`${OPERATIONS}/unknown`, { ...operation(), state: 'unknown' }],
      [`${OPERATIONS}/submitting`, { ...operation(), state: 'submitting' }],
      [`${OPERATIONS}/v2`, { ...operation(), version: 2, state: 'acknowledged' }],
      [`${OPERATIONS}/unresolved`, { ...operation(), version: 2, state: 'final-claimed', purgeAt: null }],
      [`${OPERATIONS}/future`, { ...operation(), purgeAt: new Date(NOW + 1) }],
      [`${LOCKS}/unknown`, { state: 'unknown', purgeAt: expired }],
      [`${LOCKS}/owner-deleted`, { state: 'owner-deleted', purgeAt: expired }],
    ];
    await seed([...removable, ...retained]);
    const before = await Promise.all(retained.map(([path]) => read(path)));
    expect((await worker()()).deleted).toBe(removable.length);
    for (const [path] of removable) expect(await read(path)).toBeUndefined();
    expect(await Promise.all(retained.map(([path]) => read(path)))).toEqual(before);
  }, 20_000);

  it('rechecks a renewed binding after the candidate query and preserves its new encrypted session', async () => {
    let clock = NOW - TRONCLASS_BINDING_TTL_MS - 1;
    const bindings = createTronClassBindingService({
      db: otherDb as unknown as TronClassBindingStore, now: () => clock,
      encryptionSecret: 'synthetic-retention-emulator-secret-not-a-real-credential',
      login: async () => ({ cookies: { session: 'synthetic-session' }, userId: 303, userName: '合成學生', role: 'student' }),
    });
    const input = { schoolId: 'pu' as const, account: '410123456', password: 'synthetic-password', expectedRevision: null };
    const old = await bindings.connect(OWNER, input);
    clock = NOW;
    const paused = pauseQuery(db, BINDINGS);
    const pending = worker(paused.db)();
    await paused.entered;
    const fresh = await bindings.connect(OWNER, { ...input, expectedRevision: old.revision });
    const before = await read(bindingPath);
    paused.resume();
    await pending;
    expect(fresh.revision).not.toBe(old.revision);
    expect(await read(bindingPath)).toEqual(before);
    expect((await bindings.requireBinding(OWNER)).revision).toBe(fresh.revision);
  }, 20_000);

  it('preserves an operation that becomes unknown and its lock after the candidate query', async () => {
    const path = `${OPERATIONS}/race`;
    await seed([[path, operation()], [`${LOCKS}/race`, { state: 'submitting', purgeAt: null }]]);
    const paused = pauseQuery(db, OPERATIONS);
    const pending = worker(paused.db)();
    await paused.entered;
    await otherDb.runTransaction(async tx => {
      const ref = otherDb.doc(path);
      const current = await tx.get(ref);
      tx.set(ref, { ...current.data(), state: 'unknown', updatedAt: NOW, purgeAt: null });
    });
    const before = await read(path);
    paused.resume();
    expect((await pending).deleted).toBe(0);
    expect(await read(path)).toEqual(before);
    expect(await read(`${LOCKS}/race`)).toEqual({ state: 'submitting', purgeAt: null });
  }, 20_000);

  it('does not remove a newly closed barrier or renewed login quota from an old candidate list', async () => {
    await seed([[`${BINDINGS}/closing`, binding()], [`${QUOTAS}/renewing`, quota()]]);
    const paused = pauseQuery(db, BINDINGS);
    const pending = worker(paused.db)();
    await paused.entered;
    await otherDb.doc(`${BINDINGS}/closing`).set({ state: 'closed', ownerHash: 'synthetic-owner-hash' });
    await otherDb.doc(`${QUOTAS}/renewing`).set({ ...quota(), timestamps: [NOW], purgeAt: new Date(NOW + 900_000) });
    paused.resume();
    expect((await pending).deleted).toBe(0);
    expect(await read(`${BINDINGS}/closing`)).toEqual({ state: 'closed', ownerHash: 'synthetic-owner-hash' });
    expect((await read(`${QUOTAS}/renewing`))?.timestamps).toEqual([NOW]);
  }, 20_000);

  it('uses independent collection budgets and continues past protected rows', async () => {
    const rows: Array<[string, Record<string, unknown>]> = [];
    for (let i = 0; i < 25; i += 1) {
      const id = String(i).padStart(3, '0');
      rows.push([`${BINDINGS}/${id}`, binding()], [`${QUOTAS}/${id}`, quota()], [`${OPERATIONS}/draft-${id}`, operation()]);
    }
    // Older protected rows occupy the first operation pages; a cursor must
    // eventually reach the safe drafts rather than rescan these forever.
    for (let i = 0; i < TRONCLASS_RETENTION_BATCH_SIZE; i += 1) rows.push([`${OPERATIONS}/protected-${i}`, {
      ...operation(), state: 'unknown', purgeAt: new Date(NOW - 2),
    }]);
    await seed(rows);
    const run = worker();
    const first = await run();
    expect(first).toEqual({ scanned: TRONCLASS_RETENTION_BATCH_SIZE + 50, deleted: 50, skipped: false });
    expect(await run()).toEqual({ scanned: 25, deleted: 25, skipped: false });
    expect((await db.collection(BINDINGS).get()).empty).toBe(true);
    expect((await db.collection(QUOTAS).get()).empty).toBe(true);
    const remaining = await db.collection(OPERATIONS).get();
    expect(remaining.size).toBe(TRONCLASS_RETENTION_BATCH_SIZE);
    expect(remaining.docs.every(doc => doc.data().state === 'unknown')).toBe(true);
  }, 30_000);

  it('two independent workers cannot both delete the same candidate', async () => {
    await seed([[`${OPERATIONS}/concurrent`, operation()]]);
    const other = worker(otherDb as unknown as TronClassRetentionStore);
    const results = await Promise.all([worker()(), other()]);
    expect(results.reduce((total, result) => total + result.deleted, 0)).toBe(1);
    expect(await read(`${OPERATIONS}/concurrent`)).toBeUndefined();
  }, 20_000);
});
