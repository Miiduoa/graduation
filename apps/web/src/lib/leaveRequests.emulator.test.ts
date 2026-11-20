// @vitest-environment node
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, documentId, getDocsFromServer, limit, query, where, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from './firebase';
import { getMyLeaveRequest, listMyLeaveRequests } from './leaveRequests';

const auth = vi.hoisted(() => ({ currentUser: { uid: 'alice' } as { uid: string } | null }));
vi.mock('./firebase', () => ({
  getDb: vi.fn(),
  getAuth: () => auth,
  isFirebaseConfigured: () => true,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
}));

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost)
  ? describe : describe.skip;

describeEmulator('leave lookup against the repository Firestore rules', () => {
  let environment: RulesTestEnvironment;
  let alice: Firestore;
  const record = {
    uid: 'alice', schoolId: 'pu', source: 'campus-one', courses: [],
    kind: 'sick', period: 'all', status: 'completed', detail: '',
    startDate: '2020-01-01', endDate: '2020-01-01', createdAt: new Date('2020-01-01'),
  };

  beforeAll(async () => {
    const [host, port] = emulatorHost.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-campus-leave-lookup',
      firestore: {
        host, port: Number(port),
        rules: readFileSync(new URL('../../../../backend/firestore/firestore.rules', import.meta.url), 'utf8'),
      },
    });
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = db.batch();
      batch.set(db.doc('leaveRequests/leave-2020-archive'), record);
      batch.set(db.doc('leaveRequests/leave-2020-other-owner'), { ...record, uid: 'bob' });
      batch.set(db.doc('leaveRequests/leave-2020-other-school'), { ...record, schoolId: 'ntu' });
      batch.set(db.doc('leaveRequests/leave-2020-legacy-source'), { ...record, source: 'legacy' });
      batch.set(db.doc('leaveRequests/leave-2020-closed-account'), { ...record, uid: 'closed' });
      batch.set(db.doc('users/closed'), { status: 'deleted' });
      for (let index = 0; index < 105; index++) {
        batch.set(db.doc(`leaveRequests/leave-2026-recent-${index}`), { ...record, createdAt: new Date('2026-01-01') });
      }
      await batch.commit();
    });
    alice = environment.authenticatedContext('alice').firestore() as unknown as Firestore;
  }, 30000);

  beforeEach(() => {
    auth.currentUser = { uid: 'alice' };
    vi.mocked(getDb).mockReset().mockReturnValue(alice);
  });

  afterAll(async () => { await environment?.cleanup(); });

  it('reads the owner record beyond the 100-record history window', async () => {
    const recent = await listMyLeaveRequests('alice', 'pu');
    expect(recent).toHaveLength(100);
    expect(recent.some((item) => item.id === 'leave-2020-archive')).toBe(false);
    await expect(getMyLeaveRequest('alice', 'pu', 'leave-2020-archive')).resolves.toMatchObject({
      id: 'leave-2020-archive', uid: 'alice', schoolId: 'pu', source: 'campus-one',
    });
  });

  it.each(['leave-2020-other-school', 'leave-2020-legacy-source'])(
    'returns an empty result for a document outside the requested scope %s', async (requestId) => {
      await expect(getMyLeaveRequest('alice', 'pu', requestId)).resolves.toBeNull();
    },
  );

  it.each(['leave-2020-missing', 'leave-2020-other-owner'])(
    'preserves the same inaccessible result for private or missing ID %s', async (requestId) => {
      await expect(getMyLeaveRequest('alice', 'pu', requestId)).rejects.toMatchObject({ code: 'permission-denied' });
    },
  );

  it('rejects an unauthenticated server query', async () => {
    const guest = environment.unauthenticatedContext().firestore() as unknown as Firestore;
    await expect(getDocsFromServer(query(
      collection(guest, 'leaveRequests'), where('uid', '==', 'alice'),
    ))).rejects.toMatchObject({ code: 'permission-denied' });
    auth.currentUser = null;
    vi.mocked(getDb).mockReturnValue(guest);
    await expect(getMyLeaveRequest('alice', 'pu', 'leave-2020-archive')).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  });

  it('rejects an attempt to query another owner without the current-user constraint', async () => {
    await expect(getDocsFromServer(query(
      collection(alice, 'leaveRequests'),
      where('schoolId', '==', 'pu'),
      where('source', '==', 'campus-one'),
      where(documentId(), '==', 'leave-2020-other-owner'),
      limit(1),
    ))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('continues to enforce the existing closed-account rule', async () => {
    auth.currentUser = { uid: 'closed' };
    const closed = environment.authenticatedContext('closed').firestore() as unknown as Firestore;
    vi.mocked(getDb).mockReturnValue(closed);
    await expect(getDocsFromServer(query(
      collection(closed, 'leaveRequests'), where('uid', '==', 'closed'),
    ))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getMyLeaveRequest('closed', 'pu', 'leave-2020-closed-account')).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
