// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGroupInviteHandlers } from './groupInviteHandlers';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = /^(?:127\.0\.0\.1|localhost):([0-9]{1,5})$/.test(emulatorHost)
  ? describe
  : describe.skip;

describeEmulator('group invite handlers against the Firestore emulator', () => {
  let app: import('firebase-admin/app').App;
  let db: import('firebase-admin/firestore').Firestore;
  let handlers: ReturnType<typeof createGroupInviteHandlers>;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost.replace('localhost', '127.0.0.1');
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    app = initializeApp({ projectId: 'demo-campus-group-invite' }, 'group-invite-emulator');
    db = getFirestore(app);
    handlers = createGroupInviteHandlers({ db: db as never });
  });

  afterAll(async () => {
    const { deleteApp } = await import('firebase-admin/app');
    await deleteApp(app);
  });

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('groups'));
    await db.recursiveDelete(db.collection('schools'));
    await db.recursiveDelete(db.collection('users'));
    await db.doc('schools/pu/members/alice').set({ status: 'active' });
    await db.doc('schools/pu/members/bob').set({ status: 'active' });
    await db.doc('groups/one').set({
      schoolId: 'pu',
      name: '讀書會',
      type: 'study',
      joinCode: 'JOINCODE',
      memberCount: 1,
    });
    await db.doc('groups/one/members/owner').set({
      uid: 'owner',
      role: 'owner',
      status: 'active',
    });
    handlers = createGroupInviteHandlers({ db: db as never });
  });

  it('joins by code once, then reuses without changing the count', async () => {
    const first = await handlers.joinGroupByCode({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu', joinCode: 'joincode' },
    });
    expect(first).toMatchObject({ success: true, groupId: 'one', reused: false });
    const second = await handlers.joinGroupByCode({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu', joinCode: 'JOINCODE' },
    });
    expect(second).toMatchObject({ reused: true, groupId: 'one' });
    expect((await db.doc('groups/one').get()).data()?.memberCount).toBe(2);
    expect((await db.doc('groups/one/members/alice').get()).data()).toMatchObject({
      uid: 'alice',
      status: 'active',
      role: 'member',
    });
    expect((await db.doc('users/alice/groups/one').get()).data()).toMatchObject({
      groupId: 'one',
      status: 'active',
    });
  });

  it('rejects an unknown invitation code', async () => {
    await expect(
      handlers.joinGroupByCode({
        auth: { uid: 'alice' },
        data: { schoolId: 'pu', joinCode: 'NOPE0000' },
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect((await db.doc('groups/one/members/alice').get()).exists).toBe(false);
  });

  it('does not let the last owner leave', async () => {
    await db.doc('groups/one/members/owner').set({
      uid: 'owner',
      role: 'owner',
      status: 'active',
    });
    await expect(
      handlers.leaveGroup({ auth: { uid: 'owner' }, data: { groupId: 'one' } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.doc('groups/one/members/owner').get()).data()?.status).toBe('active');
  });

  it('lets the last non-owner member leave', async () => {
    await handlers.joinGroupByCode({
      auth: { uid: 'bob' },
      data: { schoolId: 'pu', joinCode: 'JOINCODE' },
    });
    await db.doc('groups/one').update({ memberCount: 1 });
    await db.doc('groups/one/members/owner').delete();
    const left = await handlers.leaveGroup({ auth: { uid: 'bob' }, data: { groupId: 'one' } });
    expect(left).toMatchObject({ success: true, status: 'left', reused: false });
    expect((await db.doc('groups/one').get()).data()?.memberCount).toBe(0);
    expect((await db.doc('users/bob/groups/one').get()).data()?.status).toBe('left');
  });

  it('creates group documents together in a transaction', async () => {
    const created = await handlers.createGroup({
      auth: { uid: 'alice' },
      data: { name: '新讀書會', type: 'study', schoolId: 'pu' },
    });
    expect(created.success).toBe(true);
    const group = await db.doc(`groups/${created.groupId}`).get();
    const member = await db.doc(`groups/${created.groupId}/members/alice`).get();
    const mirror = await db.doc(`users/alice/groups/${created.groupId}`).get();
    expect(group.data()).toMatchObject({
      name: '新讀書會',
      joinCode: created.joinCode,
      memberCount: 1,
      createdBy: 'alice',
    });
    expect(member.data()).toMatchObject({ role: 'owner', status: 'active' });
    expect(mirror.data()).toMatchObject({
      role: 'owner',
      status: 'active',
      groupId: created.groupId,
    });
  });
});
