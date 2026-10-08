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
