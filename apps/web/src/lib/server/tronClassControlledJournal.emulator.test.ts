// @vitest-environment node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createTronClassBindingService, type TronClassBindingStore } from './tronClassBinding';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import type { TronClassAttachmentClaim, TronClassAttachmentTransfer } from './tronClassAttachmentCandidate';
import {
  tronClassFinalCandidateDigest, type TronClassFinalCandidateAttempt, type TronClassFinalCandidateClaim,
} from './tronClassFinalSubmissionCandidate';
import {
  TRONCLASS_SUBMISSION_COLLECTION, TRONCLASS_SUBMISSION_LOCK_COLLECTION,
  type TronClassSubmissionBindings, type TronClassSubmissionFirestore,
} from './tronClassSubmission';
vi.mock('server-only', () => ({}));

vi.mock('./tronClassRetentionScheduler', () => ({ isTronClassRetentionSchedulerReady: () => true, waitForTronClassRetentionFirstSweep: async () => undefined }));
vi.mock('./tronClassPlatformClosureScheduler', () => ({ isTronClassPlatformClosureSchedulerReady: () => true, waitForTronClassPlatformClosureFirstBatch: async () => undefined }));

const { closeTronClassOwner } = createRequire(import.meta.url)(
  '../../../../../backend/functions/tronClassAccountLifecycle.js',
) as { closeTronClassOwner(input: { db: Firestore; ownerKey: string; now: () => number }): Promise<void> };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? '';
const localEmulator = /^(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(emulatorHost);
if (emulatorHost && !localEmulator) throw new Error('Explicit local Firestore emulator required');
const PROJECT = 'demo-tronclass-journal';
const OWNER = 'firebase:emulator-journal-owner';
const OTHER = 'platform:pa_emulator_journal_other';
const STUDENT = 303;
const NOW = Date.parse('2030-06-01T00:00:00.000Z');
const OPERATION = 'emulator_operation_001';
const FILE = 'emulator_attachment_001';
const COMMENT = 'synthetic emulator submission';
const SECRET = 'synthetic-emulator-encryption-secret-not-a-real-credential';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bindingPath = (owner = OWNER) => `_tronClassBindings/${hash(owner)}`;
const operationPath = (owner = OWNER, id = OPERATION) =>
  `${TRONCLASS_SUBMISSION_COLLECTION}/${hash(JSON.stringify([owner, id]))}`;
const lockPath = (student = STUDENT) =>
  `${TRONCLASS_SUBMISSION_LOCK_COLLECTION}/${hash(JSON.stringify(['pu', student, 101, 202]))}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Pause the request after a real binding read, before its real transaction. */
function pausePrecheck(bindings: TronClassSubmissionBindings) {
  const entered = deferred();
  const resume = deferred();
  const paused: TronClassSubmissionBindings = {
    async requireBinding(ownerKey) {
      const result = await bindings.requireBinding(ownerKey);
      entered.resolve();
      await resume.promise;
      return result;
    },
    assertCurrent: bindings.assertCurrent,
  };
  return { bindings: paused, entered: entered.promise, resume: resume.resolve };
}

// Both clients use the real Admin SDK and emulator. Only the school login is a
// synthetic source: these tests do not attest a live session or school receipt.
describe.skipIf(!localEmulator)('controlled TronClass journal with real Firestore transactions', () => {
  let app: App;
  let otherApp: App;
  let db: Firestore;
  let otherDb: Firestore;
  let now: number;
  let revision: string;
  let bindings: ReturnType<typeof createTronClassBindingService>;
  let otherBindings: ReturnType<typeof createTronClassBindingService>;
  let journal: ReturnType<typeof createTronClassControlledJournal>;

  const bindingService = (database: Firestore, studentId = STUDENT) => createTronClassBindingService({
    db: database as unknown as TronClassBindingStore,
    now: () => now,
    encryptionSecret: SECRET,
    login: async () => ({ cookies: { session: 'synthetic-school-session' },
      userId: studentId, userName: '合成學生', role: 'student' }),
  });
  const createJournal = (database = db, service: TronClassSubmissionBindings = bindings) =>
    createTronClassControlledJournal({
      db: database as unknown as TronClassSubmissionFirestore, bindings: service, now: () => now,
    });
  const connectInput = (expectedRevision: string | null = null) => ({
    schoolId: 'pu' as const, account: '410123456', password: 'synthetic-password', expectedRevision,
  });
  const claim = (): TronClassAttachmentClaim => ({
    ownerKey: OWNER, schoolId: 'pu', studentId: STUDENT, courseId: 101, homeworkId: 202,
    revision, operationId: OPERATION, fileId: FILE, name: '合成附件.txt', contentType: 'text/plain',
    size: 12, sha256: 'b'.repeat(64),
  });
  const transfer = (): TronClassAttachmentTransfer => ({
    ownerKey: OWNER, studentId: STUDENT, courseId: 101, homeworkId: 202,
    revision, operationId: OPERATION, fileId: FILE, name: '合成附件.txt', contentType: 'text/plain',
    size: 12, sha256: 'b'.repeat(64), uploadId: 40, state: 'transferred', confirmation: 'awaiting-confirmation',
  });
  const attempt = (overrides: Partial<TronClassFinalCandidateClaim> = {}): TronClassFinalCandidateClaim => {
    const value: TronClassFinalCandidateClaim = {
      ownerKey: OWNER, studentId: STUDENT, courseId: 101, homeworkId: 202, revision,
      operationId: OPERATION, comment: COMMENT, uploads: [], priorHistoryComplete: true,
      priorSubmissionIds: [], payloadDigest: '', ...overrides,
    };
    value.payloadDigest = tronClassFinalCandidateDigest(value);
    return value;
  };
  const acknowledgment = (): NonNullable<TronClassFinalCandidateAttempt['acknowledgment']> => ({
    state: 'acknowledged', submissionId: 90, studentId: STUDENT, courseId: 101, activityId: 202,
  });
  const cancelInput = () => ({ courseId: 101, homeworkId: 202, revision, operationId: OPERATION });
  const document = async (path: string) => (await db.doc(path).get()).data();

  beforeAll(() => {
    vi.stubEnv('TRONCLASS_RETENTION_ENABLED', 'true');
    vi.stubEnv('TRONCLASS_PLATFORM_CLOSURE_WORKER_ENABLED', 'true');
    vi.stubEnv('TRONCLASS_PLATFORM_CLOSURE_DATABASE_URL', 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic');
    app = initializeApp({ projectId: PROJECT }, `${PROJECT}-first-client`);
    otherApp = initializeApp({ projectId: PROJECT }, `${PROJECT}-second-client`);
    db = getFirestore(app);
    otherDb = getFirestore(otherApp);
  });

  beforeEach(async () => {
    const response = await fetch(
      `http://${emulatorHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
      { method: 'DELETE', signal: AbortSignal.timeout(10_000) },
    );
    expect(response.ok).toBe(true);
    now = NOW;
    bindings = bindingService(db);
    otherBindings = bindingService(otherDb);
    const connected = await bindings.connect(OWNER, connectInput());
    expect(connected.connected).toBe(true);
    expect(connected.revision).toMatch(/^[a-f0-9]{32}$/);
    revision = connected.revision!;
    journal = createJournal();
  }, 20_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all([db.terminate(), otherDb.terminate()]);
    await Promise.all([deleteApp(app), deleteApp(otherApp)]);
  });

  it.each(['absent', 'preparing'] as const)(
    'atomically resolves concurrent cancellation and final claim for an %s operation across clients', async state => {
      if (state === 'preparing') {
        await journal.claimAttachment(claim());
        await journal.storeTransferredFile(transfer());
      }
      const value = state === 'preparing' ? attempt({ uploads: [{ id: 40, name: '合成附件.txt', size: 12 }] }) : attempt();
      const other = createJournal(otherDb, otherBindings);
      const [cancellation, finalClaimed] = await Promise.all([
        journal.cancelPreparation(OWNER, cancelInput()), other.claimFinal(value),
      ]);
      const operation = await document(operationPath());
      const lock = await document(lockPath());
      if (cancellation.status === 'cancelled') {
        expect(finalClaimed).toBe(false);
        expect(operation).toMatchObject({ state: 'cancelled', attempt: null, acknowledgment: null, purgeAt: null });
        expect(lock).toBeUndefined();
      } else {
        expect(cancellation.status).toBe('unknown');
        expect(finalClaimed).toBe(true);
        expect(operation).toMatchObject({ state: 'final-claimed', attempt: value, purgeAt: null });
        expect(lock).toMatchObject({ state: 'submitting', operationId: OPERATION, payloadDigest: value.payloadDigest, purgeAt: null });
      }
      const before = await db.doc(operationPath()).get();
      expect(await createJournal().cancelPreparation(OWNER, cancelInput())).toEqual(cancellation);
      const after = await db.doc(operationPath()).get();
      expect(after.data()).toEqual(before.data());
      expect(after.updateTime).toEqual(before.updateTime);
      expect(await other.claimFinal(value)).toBe(false);
    }, 20_000,
  );

  it('committed cancellation blocks a delayed final claim after its binding precheck', async () => {
    await journal.claimAttachment(claim());
    await journal.storeTransferredFile(transfer());
    const paused = pausePrecheck(otherBindings);
    const value = attempt({ uploads: [{ id: 40, name: '合成附件.txt', size: 12 }] });
    const pending = createJournal(otherDb, paused.bindings).claimFinal(value);
    await paused.entered;
    try {
      expect((await journal.cancelPreparation(OWNER, cancelInput())).status).toBe('cancelled');
    } finally { paused.resume(); }
    expect(await pending).toBe(false);
    expect(await document(operationPath())).toMatchObject({ state: 'cancelled', attempt: null, acknowledgment: null, purgeAt: null });
    expect(await document(lockPath())).toBeUndefined();
    expect(await createJournal().claimAttachment(claim())).toBe(false);
  }, 20_000);

  it('a final claim committed first remains unknown to delayed cancellation and keeps its lock untouched', async () => {
    const paused = pausePrecheck(otherBindings);
    const pending = createJournal(otherDb, paused.bindings).cancelPreparation(OWNER, cancelInput());
    await paused.entered;
    let before: Awaited<ReturnType<Firestore['getAll']>>;
    try {
      expect(await journal.claimFinal(attempt())).toBe(true);
      before = await db.getAll(db.doc(operationPath()), db.doc(lockPath()));
    } finally { paused.resume(); }
    expect((await pending).status).toBe('unknown');
    const after = await db.getAll(db.doc(operationPath()), db.doc(lockPath()));
    for (const [index, snapshot] of after.entries()) {
      expect(snapshot.data()).toEqual(before![index].data());
      expect(snapshot.updateTime).toEqual(before![index].updateTime);
    }
    await journal.rememberAcknowledgment(attempt(), acknowledgment());
    const acknowledged = await db.getAll(db.doc(operationPath()), db.doc(lockPath()));
    expect((await createJournal(otherDb, otherBindings).cancelPreparation(OWNER, cancelInput())).status).toBe('unknown');
    const final = await db.getAll(db.doc(operationPath()), db.doc(lockPath()));
    for (const [index, snapshot] of final.entries()) {
      expect(snapshot.data()).toEqual(acknowledged[index].data());
      expect(snapshot.updateTime).toEqual(acknowledged[index].updateTime);
    }
  }, 20_000);

  it('a cancelled preparation survives a same-student reconnect and rejects an already-running transfer completion', async () => {
    await journal.claimAttachment(claim());
    const paused = pausePrecheck(otherBindings);
    const pending = createJournal(otherDb, paused.bindings).storeTransferredFile(transfer());
    const outcome = pending.then(() => null, (error: unknown) => error);
    await paused.entered;
    try {
      expect((await journal.cancelPreparation(OWNER, cancelInput())).status).toBe('cancelled');
    } finally { paused.resume(); }
    expect(await outcome).toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    const before = await db.doc(operationPath()).get();
    expect(before.data()).toMatchObject({ state: 'cancelled', revision, files: [{ state: 'claimed', uploadId: null }], purgeAt: null });
    const connected = await otherBindings.connect(OWNER, connectInput(revision));
    const replay = await createJournal(otherDb, otherBindings).cancelPreparation(OWNER, {
      ...cancelInput(), revision: connected.revision!,
    });
    expect(replay.status).toBe('cancelled');
    const after = await db.doc(operationPath()).get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime).toEqual(before.updateTime);
    expect(await document(lockPath())).toBeUndefined();
  }, 20_000);

  it('commits each file and final operation once across independent clients and reconstructed journals', async () => {
    const other = createJournal(otherDb, otherBindings);
    const fileClaims = await Promise.all([journal.claimAttachment(claim()), other.claimAttachment(claim())]);
    expect(fileClaims.sort()).toEqual([false, true]);
    expect(await document(operationPath())).toMatchObject({
      version: 2, state: 'preparing', purgeAt: null, files: [{ fileId: FILE, state: 'claimed', uploadId: null }],
    });
    await other.storeTransferredFile(transfer());
    const uploaded = await createJournal().readUploadedFiles(OWNER, {
      courseId: 101, homeworkId: 202, revision, operationId: OPERATION, fileIds: [FILE],
    });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ fileId: FILE, uploadId: 40, state: 'transferred' });
    const value = attempt({ uploads: [{ id: 40, name: '合成附件.txt', size: 12 }] });
    expect((await Promise.all([journal.claimFinal(value), other.claimFinal(value)])).sort()).toEqual([false, true]);
    expect(await document(operationPath())).toMatchObject({ state: 'final-claimed', attempt: value, purgeAt: null });
    expect(await document(lockPath())).toMatchObject({ state: 'submitting', operationId: OPERATION, purgeAt: null });
    await createJournal(otherDb, otherBindings).rememberAcknowledgment(value, acknowledgment());
    expect(await createJournal().readAttempt(OWNER, OPERATION)).toEqual({ ...value, acknowledgment: acknowledgment() });
    expect(await createJournal().claimFinal(value)).toBe(false);
    expect((await document(operationPath()))?.purgeAt).toBeNull();
    expect((await document(lockPath()))?.purgeAt).toBeNull();
    const persisted = JSON.stringify([await document(operationPath()), await document(lockPath())]);
    expect(persisted).not.toContain('synthetic-school-session');
    expect(persisted).not.toContain('synthetic-password');
  }, 20_000);

  it('atomically assigns one school-task lock when two nuni owners of the same student race', async () => {
    const connected = await otherBindings.connect(OTHER, connectInput());
    const values = [attempt(), attempt({ ownerKey: OTHER, revision: connected.revision!, operationId: 'emulator_operation_002' })];
    const results = await Promise.all([
      journal.claimFinal(values[0]), createJournal(otherDb, otherBindings).claimFinal(values[1]),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = values[results.indexOf(true)];
    const loser = values[results.indexOf(false)];
    expect(await document(lockPath())).toMatchObject({ ownerKey: winner.ownerKey, operationId: winner.operationId });
    expect(await document(operationPath(winner.ownerKey, winner.operationId))).toMatchObject({ state: 'final-claimed' });
    expect(await document(operationPath(loser.ownerKey, loser.operationId))).toBeUndefined();
    expect((await db.collection(TRONCLASS_SUBMISSION_COLLECTION).get()).size).toBe(1);
    expect(await journal.readAttempt(loser.ownerKey, winner.operationId)).toBeNull();
  }, 20_000);

  it('reads the acknowledged attempt after the same student reconnects without updating its old revision or locks', async () => {
    const value = attempt();
    await journal.claimFinal(value);
    await journal.rememberAcknowledgment(value, acknowledgment());
    const before = await db.getAll(db.doc(operationPath()), db.doc(lockPath()));
    const connected = await otherBindings.connect(OWNER, connectInput(revision));
    expect(connected.revision).not.toBe(revision);
    const reader = createJournal(otherDb, otherBindings);
    expect(await reader.readAttempt(OWNER, OPERATION)).toEqual({ ...value, acknowledgment: acknowledgment() });
    await expect(reader.claimFinal(attempt({ revision: connected.revision! })))
      .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    await expect(reader.rememberAcknowledgment(value, acknowledgment()))
      .rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    const after = await db.getAll(db.doc(operationPath()), db.doc(lockPath()));
    for (const [index, snapshot] of after.entries()) {
      expect(snapshot.data()).toEqual(before[index].data());
      expect(snapshot.updateTime).toEqual(before[index].updateTime);
    }
  });

  it('does not reveal an attempt to another owner or after the owner connects a different school student', async () => {
    await journal.claimFinal(attempt());
    await journal.rememberAcknowledgment(attempt(), acknowledgment());
    const before = await db.doc(operationPath()).get();
    const connected = await otherBindings.connect(OTHER, connectInput());
    expect(await createJournal(otherDb, otherBindings).readAttempt(OTHER, OPERATION)).toBeNull();
    expect(await journal.claimFinal(attempt({ ownerKey: OTHER, revision: connected.revision! }))).toBe(false);
    const differentStudent = bindingService(otherDb, STUDENT + 1);
    await differentStudent.connect(OWNER, connectInput(revision));
    await expect(createJournal(otherDb, differentStudent).readAttempt(OWNER, OPERATION))
      .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT', message: 'TRONCLASS_OPERATION_CONFLICT' });
    const after = await db.doc(operationPath()).get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime).toEqual(before.updateTime);
    expect(await document(operationPath(OTHER))).toBeUndefined();
  });

  it.each(['transfer', 'acknowledgment'] as const)(
    'account closure prevents an in-flight %s from recreating deleted private records', async phase => {
      await journal.claimAttachment(claim());
      const value = attempt({ uploads: [{ id: 40, name: '合成附件.txt', size: 12 }] });
      if (phase === 'acknowledgment') {
        await journal.storeTransferredFile(transfer());
        await journal.claimFinal(value);
      }
      const paused = pausePrecheck(otherBindings);
      const delayed = createJournal(otherDb, paused.bindings);
      const pending = phase === 'transfer'
        ? delayed.storeTransferredFile(transfer())
        : delayed.rememberAcknowledgment(value, acknowledgment());
      const outcome = pending.then(() => null, (error: unknown) => error);
      await paused.entered;
      try {
        await closeTronClassOwner({ db, ownerKey: OWNER, now: () => now });
        expect(await document(operationPath())).toBeUndefined();
        expect(await document(bindingPath())).toMatchObject({ state: 'closed', ownerHash: hash(OWNER) });
      } finally {
        paused.resume();
      }
      expect(await outcome).toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
      expect(await document(operationPath())).toBeUndefined();
      const closed = await document(bindingPath());
      for (const field of ['ownerKey', 'sealedCookies', 'account', 'userId', 'expiresAt', 'purgeAt']) {
        expect(closed).not.toHaveProperty(field);
      }
      if (phase === 'acknowledgment') {
        expect(await document(lockPath())).toEqual({ version: 1, state: 'owner-deleted', updatedAt: now });
        const connected = await otherBindings.connect(OTHER, connectInput());
        expect(await createJournal(otherDb, otherBindings).claimFinal(attempt({
          ownerKey: OTHER, revision: connected.revision!, operationId: 'emulator_after_close_001',
        }))).toBe(false);
        expect(await document(operationPath(OTHER, 'emulator_after_close_001'))).toBeUndefined();
      } else {
        expect(await document(lockPath())).toBeUndefined();
      }
    }, 20_000,
  );

  it('keeps a final request with no acknowledgment outside TTL and blocks retry after a later valid reconnect', async () => {
    const value = attempt();
    await journal.claimFinal(value);
    // The emulator does not execute TTL sweeps. Verify the persisted TTL fields
    // and retry behavior rather than claiming that a TTL scheduler was tested.
    now += 90 * 24 * 60 * 60 * 1000;
    const connected = await otherBindings.connect(OWNER, connectInput(revision));
    const reader = createJournal(otherDb, otherBindings);
    expect(await reader.readAttempt(OWNER, OPERATION)).toEqual({ ...value, acknowledgment: null });
    expect(await reader.claimFinal(attempt({ revision: connected.revision!, operationId: 'emulator_after_timeout_001' }))).toBe(false);
    for (const path of [operationPath(), lockPath()]) {
      const persisted = await document(path);
      expect(persisted?.purgeAt).toBeNull();
      expect(persisted).not.toHaveProperty('expiresAt');
    }
    expect(await document(operationPath(OWNER, 'emulator_after_timeout_001'))).toBeUndefined();
  });

  it('preserves an existing unknown legacy lock and never grants it to the new journal', async () => {
    const unknown = { version: 1, state: 'unknown', ownerKey: OTHER, updatedAt: NOW - 90 * 86400_000, purgeAt: null };
    await db.doc(lockPath()).set(unknown);
    expect(await journal.claimFinal(attempt())).toBe(false);
    expect(await journal.claimAttachment(claim())).toBe(false);
    expect(await document(lockPath())).toEqual(unknown);
    expect(await document(operationPath())).toBeUndefined();
  });
});
