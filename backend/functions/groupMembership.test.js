const { createHash } = require('node:crypto');
const auditId = (operationId, groupId = 'one') =>
  `ownership-${createHash('sha256')
    .update(JSON.stringify([groupId, operationId]))
    .digest('hex')}`;
const { createGroupMembershipHandlers } = require('./groupMembership');
const { transactionStore } = require('./testSupport/transactionStore');

describe('transactional group membership', () => {
  let store;
  let handlers;
  const join = (uid = 'alice', data = {}) =>
    handlers.joinGroupByCode({
      auth: { uid },
      data: { schoolId: 'pu', joinCode: 'joincode', ...data },
    });
  const leave = (uid = 'alice') => handlers.leaveGroup({ auth: { uid }, data: { groupId: 'one' } });
  beforeEach(() => {
    store = transactionStore([
      ['schools/pu/members/alice', { status: 'active' }],
      [
        'groups/one',
        { schoolId: 'pu', name: '讀書會', type: 'study', joinCode: 'JOINCODE', memberCount: 1 },
      ],
    ]);
    handlers = createGroupMembershipHandlers({ db: store.db });
  });
  test('requires auth and valid identifiers before starting mutations', async () => {
    await expect(handlers.joinGroupByCode({ data: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(handlers.leaveGroup({ data: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(join('alice', { schoolId: '../pu' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(store.docs.size).toBe(2);
  });
  test.each([{ status: 'inactive' }, {}])(
    'requires explicitly active school membership %j',
    async (membership) => {
      store.docs.set('schools/pu/members/alice', membership);
      await expect(join()).rejects.toMatchObject({ code: 'permission-denied' });
      expect(store.docs.size).toBe(2);
    },
  );
  test('joins once and retries across fresh handler instances without changing the count', async () => {
    const first = await join();
    handlers = createGroupMembershipHandlers({ db: store.db });
    expect(await join()).toEqual({ ...first, reused: true });
    expect(store.docs.get('groups/one').memberCount).toBe(2);
    expect(store.docs.get('groups/one/members/alice')).toMatchObject({
      uid: 'alice',
      status: 'active',
      role: 'member',
    });
    expect(store.docs.get('users/alice/groups/one')).toMatchObject({
      groupId: 'one',
      schoolId: 'pu',
      status: 'active',
      role: 'member',
    });
  });
  test('does not downgrade an active owner and repairs a missing user mirror without incrementing', async () => {
    store.docs.set('groups/one/members/alice', {
      uid: 'alice',
      role: 'owner',
      status: 'active',
      joinedAt: 'original',
    });
    expect((await join()).reused).toBe(true);
    expect(store.docs.get('groups/one').memberCount).toBe(1);
    expect(store.docs.get('users/alice/groups/one')).toMatchObject({
      role: 'owner',
      joinedAt: 'original',
      status: 'active',
    });
    await expect(leave()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.get('groups/one/members/alice').status).toBe('active');
  });
  test('leaves once and retries without decrementing again or changing the original leftAt', async () => {
    await join();
    const first = await leave();
    const leftAt = store.docs.get('groups/one/members/alice').leftAt;
    expect(await leave()).toEqual({ ...first, reused: true });
    expect(store.docs.get('groups/one').memberCount).toBe(1);
    expect(store.docs.get('groups/one/members/alice').leftAt).toBe(leftAt);
    expect(store.docs.get('users/alice/groups/one').status).toBe('left');
  });
  test('repairs a missing user mirror when leaving and permits leaving after school revocation', async () => {
    await join();
    store.docs.delete('users/alice/groups/one');
    store.docs.set('schools/pu/members/alice', { status: 'inactive' });
    await leave();
    expect(store.docs.get('users/alice/groups/one')).toMatchObject({
      groupId: 'one',
      schoolId: 'pu',
      status: 'left',
    });
    expect(store.docs.get('groups/one').memberCount).toBe(1);
  });
  test('nonmembers cannot decrement the count, and mismatched school codes cannot join', async () => {
    await leave('outsider');
    expect(store.docs.get('groups/one').memberCount).toBe(1);
    expect(store.docs.has('users/outsider/groups/one')).toBe(false);
    await expect(join('alice', { schoolId: 'nthu' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
  test('ambiguous codes fail instead of joining an arbitrary group', async () => {
    store.docs.set('groups/two', { ...store.docs.get('groups/one') });
    await expect(join()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.has('groups/one/members/alice')).toBe(false);
  });
  test('a failed commit cannot leave partial membership, mirror, or count updates', async () => {
    store.failNextCommit();
    await expect(join()).rejects.toThrow('commit unavailable');
    expect(store.docs.size).toBe(2);
    expect(store.docs.get('groups/one').memberCount).toBe(1);
    await join();
    store.failNextCommit();
    await expect(leave()).rejects.toThrow('commit unavailable');
    expect(store.docs.get('groups/one').memberCount).toBe(2);
    expect(store.docs.get('groups/one/members/alice').status).toBe('active');
    expect(store.docs.get('users/alice/groups/one').status).toBe('active');
  });
  test('leaving an existing zero count never makes it negative', async () => {
    await join();
    store.docs.get('groups/one').memberCount = 0;
    await leave();
    expect(store.docs.get('groups/one').memberCount).toBe(0);
    expect(store.docs.get('groups/one/members/alice').status).toBe('left');
  });
  test('an undefined count fails atomically rather than inventing membership totals', async () => {
    delete store.docs.get('groups/one').memberCount;
    await expect(join()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.has('groups/one/members/alice')).toBe(false);
    expect(store.docs.has('users/alice/groups/one')).toBe(false);
  });
});

describe('transferGroupOwnership', () => {
  let store;
  let handlers;
  const seedTransfer = () => {
    store = transactionStore([
      ['schools/pu/members/alice', { status: 'active', role: 'member' }],
      ['schools/pu/members/bob', { status: 'active', role: 'member' }],
      ['users/alice', { role: 'student' }],
      ['users/bob', { role: 'student' }],
      [
        'groups/one',
        {
          schoolId: 'pu',
          name: '讀書會',
          type: 'study',
          joinCode: 'JOINCODE',
          memberCount: 2,
          createdBy: 'alice',
        },
      ],
      [
        'groups/one/members/alice',
        { uid: 'alice', role: 'owner', status: 'active', joinedAt: 't0' },
      ],
      ['groups/one/members/bob', { uid: 'bob', role: 'member', status: 'active', joinedAt: 't1' }],
      [
        'users/alice/groups/one',
        { groupId: 'one', schoolId: 'pu', role: 'owner', status: 'active', joinedAt: 't0' },
      ],
      [
        'users/bob/groups/one',
        { groupId: 'one', schoolId: 'pu', role: 'member', status: 'active', joinedAt: 't1' },
      ],
    ]);
    handlers = createGroupMembershipHandlers({ db: store.db });
  };
  const transfer = (uid = 'alice', data = {}) =>
    handlers.transferGroupOwnership({
      auth: { uid },
      data: {
        groupId: 'one',
        targetUid: 'bob',
        operationId: 'op-1',
        expectedCurrentOwnerUid: 'alice',
        ...data,
      },
    });

  beforeEach(seedTransfer);

  test('requires auth and matching expected current owner', async () => {
    await expect(handlers.transferGroupOwnership({ data: {} })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(transfer('bob')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs.get('groups/one/members/alice').role).toBe('owner');
  });

  test('transfers atomically to one owner and preserves createdBy', async () => {
    const first = await transfer();
    expect(first).toMatchObject({
      success: true,
      reused: false,
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
    });
    expect(store.docs.get('groups/one').createdBy).toBe('alice');
    expect(store.docs.get('groups/one/members/alice')).toMatchObject({
      role: 'member',
      status: 'active',
    });
    expect(store.docs.get('groups/one/members/bob')).toMatchObject({
      role: 'owner',
      status: 'active',
    });
    expect(store.docs.get('users/alice/groups/one').role).toBe('member');
    expect(store.docs.get('users/bob/groups/one').role).toBe('owner');
    expect(store.docs.get('groups/one/ownershipTransfers/op-1')).toMatchObject({
      status: 'completed',
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
      auditLogId: auditId('op-1'),
      scope: 'group-private',
    });
    expect(store.docs.get(`schools/pu/adminLogs/${auditId('op-1')}`)).toMatchObject({
      action: 'transfer_group_ownership',
      actorUid: 'alice',
      scope: 'school-private',
    });
  });

  test('two groups can reuse an operation ID without overwriting either audit', async () => {
    for (const [path, value] of [...store.docs.entries()]) {
      if (path === 'groups/one' || path.startsWith('groups/one/')) {
        store.docs.set(path.replace('groups/one', 'groups/two'), { ...value });
      } else if (path.endsWith('/groups/one')) {
        store.docs.set(path.replace('/groups/one', '/groups/two'), { ...value, groupId: 'two' });
      }
    }
    await transfer();
    const firstReceipt = store.docs.get('groups/one/ownershipTransfers/op-1');
    const firstAudit = { ...store.docs.get(`schools/pu/adminLogs/${firstReceipt.auditLogId}`) };
    await transfer('alice', { groupId: 'two' });
    const secondReceipt = store.docs.get('groups/two/ownershipTransfers/op-1');
    expect(secondReceipt.auditLogId).not.toBe(firstReceipt.auditLogId);
    expect(store.docs.get(`schools/pu/adminLogs/${firstReceipt.auditLogId}`)).toEqual(firstAudit);
    expect(store.docs.get(`schools/pu/adminLogs/${secondReceipt.auditLogId}`)).toMatchObject({
      action: 'transfer_group_ownership',
      actorUid: 'alice',
    });
  });

  test('pre-existing audit aborts ownership changes instead of overwriting evidence', async () => {
    const auditPath = `schools/pu/adminLogs/${auditId('op-1')}`;
    const existing = { action: 'preserved-evidence' };
    store.docs.set(auditPath, existing);
    await expect(transfer()).rejects.toThrow('already exists');
    expect(store.docs.get(auditPath)).toEqual(existing);
    expect(store.docs.get('groups/one/members/alice').role).toBe('owner');
    expect(store.docs.get('groups/one/members/bob').role).toBe('member');
    expect(store.docs.get('users/alice/groups/one').role).toBe('owner');
    expect(store.docs.has('groups/one/ownershipTransfers/op-1')).toBe(false);
  });

  test('idempotent retry with the same operationId does not re-grant the former owner', async () => {
    const first = await transfer();
    handlers = createGroupMembershipHandlers({ db: store.db });
    const replay = await transfer();
    expect(replay).toEqual({ ...first, reused: true });
    expect(store.docs.get('groups/one/members/alice').role).toBe('member');
    expect(store.docs.get('groups/one/members/bob').role).toBe('owner');
    expect(
      [...store.docs.keys()].filter((path) => path.startsWith('schools/pu/adminLogs/')),
    ).toEqual([`schools/pu/adminLogs/${auditId('op-1')}`]);
  });

  test('rejects cross-school, inactive, guest, deleted, and non-member targets', async () => {
    store.docs.set('schools/pu/members/bob', { status: 'inactive' });
    await expect(transfer()).rejects.toMatchObject({ code: 'permission-denied' });
    seedTransfer();
    store.docs.set('users/bob', { role: 'guest' });
    await expect(transfer()).rejects.toMatchObject({ code: 'permission-denied' });
    seedTransfer();
    store.docs.set('users/bob', { status: 'deleted' });
    await expect(transfer()).rejects.toMatchObject({ code: 'failed-precondition' });
    seedTransfer();
    store.docs.delete('groups/one/members/bob');
    await expect(transfer()).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('rejects inconsistent multi-owner schema instead of inventing authority', async () => {
    store.docs.set('groups/one/members/carol', {
      uid: 'carol',
      role: 'owner',
      status: 'active',
    });
    await expect(transfer()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.get('groups/one/members/alice').role).toBe('owner');
  });

  test('fails closed when a second active owner would be truncated by a role-only limit', async () => {
    // Regression: role==owner limit(8) then status filter missed late-sorted active z-other.
    for (let index = 0; index < 7; index += 1) {
      const uid = `a00-inactive-${index}`;
      store.docs.set(`groups/one/members/${uid}`, {
        uid,
        role: 'owner',
        status: 'left',
      });
    }
    store.docs.set('groups/one/members/z-other', {
      uid: 'z-other',
      role: 'owner',
      status: 'active',
    });
    await expect(transfer()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.get('groups/one/members/alice').role).toBe('owner');
    expect(store.docs.get('groups/one/members/bob').role).toBe('member');
    expect(store.docs.get('groups/one/members/z-other').role).toBe('owner');
    expect(store.docs.has('groups/one/ownershipTransfers/op-1')).toBe(false);
    expect(store.docs.has(`schools/pu/adminLogs/${auditId('op-1')}`)).toBe(false);
  });

  test('nine inactive historical owners do not hide the sole active owner', async () => {
    for (let index = 0; index < 9; index += 1) {
      const uid = `a00-historical-${index}`;
      store.docs.set(`groups/one/members/${uid}`, {
        uid,
        role: 'owner',
        status: 'left',
      });
    }
    await transfer();
    expect(store.docs.get('groups/one/members/alice').role).toBe('member');
    expect(store.docs.get('groups/one/members/bob').role).toBe('owner');
  });

  test('concurrent competing transfers: only the winning owner remains', async () => {
    store.docs.set('schools/pu/members/carol', { status: 'active' });
    store.docs.set('users/carol', { role: 'student' });
    store.docs.set('groups/one/members/carol', {
      uid: 'carol',
      role: 'member',
      status: 'active',
      joinedAt: 't2',
    });
    store.docs.get('groups/one').memberCount = 3;
    await transfer('alice', { targetUid: 'bob', operationId: 'op-bob' });
    await expect(
      transfer('alice', {
        targetUid: 'carol',
        operationId: 'op-carol',
        expectedCurrentOwnerUid: 'alice',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.get('groups/one/members/bob').role).toBe('owner');
    expect(store.docs.get('groups/one/members/alice').role).toBe('member');
    expect(store.docs.get('groups/one/members/carol').role).toBe('member');
  });

  test('former owner can leave after a successful transfer', async () => {
    await transfer();
    await handlers.leaveGroup({ auth: { uid: 'alice' }, data: { groupId: 'one' } });
    expect(store.docs.get('groups/one/members/alice').status).toBe('left');
    expect(store.docs.get('groups/one/members/bob').role).toBe('owner');
  });

  test('replay rejects closed or revoked actors without rewriting or adding audit events', async () => {
    const first = await transfer();
    const receipt = store.docs.get('groups/one/ownershipTransfers/op-1');
    store.docs.set('schools/pu/members/alice', { status: 'inactive' });
    await expect(transfer()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs.get('groups/one/ownershipTransfers/op-1')).toEqual(receipt);
    expect(
      [...store.docs.keys()].filter((path) => path.startsWith('schools/pu/adminLogs/')),
    ).toEqual([`schools/pu/adminLogs/${auditId('op-1')}`]);

    seedTransfer();
    await transfer();
    const receipt2 = store.docs.get('groups/one/ownershipTransfers/op-1');
    store.docs.set('users/alice', { status: 'deleted', accountDeletionInProgress: true });
    await expect(transfer()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.docs.get('groups/one/ownershipTransfers/op-1')).toEqual(receipt2);
    expect(store.docs.get('groups/one/members/bob').role).toBe('owner');
    expect(first.actorNewRole).toBe('member');
  });

  test('eligible former owner recovers immutable receipt after leave and later handoff', async () => {
    const original = await transfer();
    const receipt = { ...store.docs.get('groups/one/ownershipTransfers/op-1') };
    await handlers.leaveGroup({ auth: { uid: 'alice' }, data: { groupId: 'one' } });
    store.docs.set('schools/pu/members/carol', { status: 'active' });
    store.docs.set('users/carol', { role: 'student' });
    store.docs.set('groups/one/members/carol', {
      uid: 'carol',
      role: 'member',
      status: 'active',
      joinedAt: 't2',
    });
    store.docs.set('users/carol/groups/one', {
      groupId: 'one',
      schoolId: 'pu',
      role: 'member',
      status: 'active',
      joinedAt: 't2',
    });
    await transfer('bob', {
      targetUid: 'carol',
      operationId: 'op-2',
      expectedCurrentOwnerUid: 'bob',
    });
    const replay = await transfer();
    expect(replay).toEqual({ ...original, reused: true });
    expect(replay.actorNewRole).toBe(receipt.actorNewRole);
    expect(store.docs.get('groups/one/members/alice').status).toBe('left');
    expect(store.docs.get('groups/one/members/carol').role).toBe('owner');
    expect(store.docs.get('groups/one/ownershipTransfers/op-1')).toEqual(receipt);
    expect(
      [...store.docs.keys()].filter((path) => path.startsWith('schools/pu/adminLogs/')).sort(),
    ).toEqual(
      [`schools/pu/adminLogs/${auditId('op-1')}`, `schools/pu/adminLogs/${auditId('op-2')}`].sort(),
    );
  });

  test('other actors or mismatched payloads cannot replay a completed receipt', async () => {
    await transfer();
    store.docs.set('schools/pu/members/carol', { status: 'active' });
    store.docs.set('users/carol', { role: 'student' });
    await expect(
      transfer('bob', {
        targetUid: 'carol',
        operationId: 'op-1',
        expectedCurrentOwnerUid: 'bob',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
    await expect(
      transfer('alice', {
        targetUid: 'carol',
        operationId: 'op-1',
        expectedCurrentOwnerUid: 'alice',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('transferGroupOwnership registration', () => {
  test('functionRegistry classifies the exported callable name used by Fly', () => {
    const { classifyFunctions } = require('./functionRegistry');
    const handler = Object.assign(async () => ({}), {
      __endpoint: { platform: 'gcfv2', callableTrigger: {} },
    });
    const classified = classifyFunctions({ transferGroupOwnership: handler });
    expect(Object.keys(classified.callables)).toEqual(['transferGroupOwnership']);
  });

  test('index.js exports transferGroupOwnership beside join/leave for the HTTP adapter allowlist', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    expect(source).toMatch(/exports\.transferGroupOwnership\s*=\s*onCall\(/);
    expect(source).toMatch(/groupMembershipHandlers\.transferGroupOwnership/);
    expect(source).toMatch(/exports\.joinGroupByCode\s*=\s*onCall\(/);
    expect(source).toMatch(/exports\.leaveGroup\s*=\s*onCall\(/);
  });
});
