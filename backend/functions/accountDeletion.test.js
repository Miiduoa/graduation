const { FieldValue } = require('firebase-admin/firestore');
const { createHash } = require('node:crypto');
const { createDeleteUserAccountHandler, RETAINED_CATEGORIES } = require('./accountDeletion');
const { closeTronClassOwner } = require('./tronClassAccountLifecycle');

const bindingPath = (owner) => `_tronClassBindings/${createHash('sha256').update(owner).digest('hex')}`;

function isDeleteSentinel(value) {
  return Boolean(value && typeof value.isEqual === 'function' && value.isEqual(FieldValue.delete()));
}

function applyWrite(current, data, replace) {
  const next = replace ? {} : { ...(current || {}) };
  for (const [key, value] of Object.entries(data)) {
    if (isDeleteSentinel(value)) delete next[key];
    else next[key] = value;
  }
  return next;
}

const NOW = Date.parse('2030-01-01T12:00:00Z');
const request = (data = {}, uid = 'alice', authTime = NOW / 1000) => ({
  auth: { uid, token: { auth_time: authTime } },
  data: { expectedUserId: uid, confirmation: 'DELETE_MY_ACCOUNT', ...data },
});

// This store models path cursors, orphaned child collections, recursive deletes,
// and atomic membership updates. SDK query compatibility is checked by emulator.
function store(seed = []) {
  const docs = new Map(seed);
  const operations = [];
  let failure;
  let afterQuery;
  function check(operation, path) {
    operations.push([operation, path]);
    if (failure?.[0] === operation && failure[1] === path) {
      failure = undefined;
      throw new Error(`unavailable ${operation} ${path}`);
    }
  }
  function snapshot(reference, values = docs) {
    return {
      id: reference.id,
      ref: reference,
      exists: values.has(reference.path),
      data: () => values.get(reference.path),
    };
  }
  function ref(path) {
    const reference = {
      path,
      id: path.split('/').at(-1),
      get parent() {
        return query(path.split('/').slice(0, -1).join('/'));
      },
      collection: (name) => query(`${path}/${name}`),
      get: async () => {
        check('get', path);
        return snapshot(reference);
      },
      set: async (data, options) => {
        check('set', path);
        docs.set(path, applyWrite(docs.get(path), data, !options?.merge));
      },
      delete: async () => {
        check('delete', path);
        docs.delete(path);
      },
      listCollections: async () => {
        check('listCollections', path);
        const paths = [...docs.keys()].filter((key) => key.startsWith(`${path}/`));
        const names = new Set(paths.map((key) => key.slice(path.length + 1).split('/')[0]));
        return [...names].map((name) => query(`${path}/${name}`));
      },
    };
    return reference;
  }
  function query(path, options = {}) {
    const value = {
      path,
      id: path.split('/').at(-1),
      options,
      get parent() {
        return path.includes('/') ? ref(path.split('/').slice(0, -1).join('/')) : null;
      },
      doc: (id) => ref(`${path}/${id}`),
      where: (field, operator, expected) =>
        query(path, {
          ...options,
          filters: [...(options.filters || []), [field, operator, expected]],
        }),
      orderBy: () => query(path, options),
      limit: (limit) => query(path, { ...options, limit }),
      startAfter: (cursor) => query(path, { ...options, cursor: cursor.ref.path }),
      get: async () => {
        check('query', path);
        const result = results(value);
        if (afterQuery) afterQuery(path, result);
        return result;
      },
      listDocuments: async () => {
        check('listDocuments', path);
        return [
          ...new Set(
            [...docs.keys()]
              .filter((key) => key.startsWith(`${path}/`))
              .map((key) => `${path}/${key.slice(path.length + 1).split('/')[0]}`),
          ),
        ].map(ref);
      },
    };
    return value;
  }
  function results(q, values = docs) {
    const rows = [...values]
      .filter(([path, data]) => {
        const inCollection = q.options.group
          ? path.split('/').at(-2) === q.path
          : path.startsWith(`${q.path}/`) && !path.slice(q.path.length + 1).includes('/');
        return (
          inCollection &&
          (!q.options.cursor || path > q.options.cursor) &&
          (q.options.filters || []).every(
            ([field, op, value]) => op === '==' && data[field] === value,
          )
        );
      })
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, q.options.limit || Infinity)
      .map(([path]) => snapshot(ref(path), values));
    return { docs: rows, empty: rows.length === 0, size: rows.length };
  }
  const db = {
    collection: query,
    collectionGroup: (name) => query(name, { group: true }),
    recursiveDelete: async (reference) => {
      check('recursiveDelete', reference.path);
      for (const path of docs.keys()) {
        if (path === reference.path || path.startsWith(`${reference.path}/`)) docs.delete(path);
      }
    },
    runTransaction: async (callback) => {
      const base = new Map(docs),
        writes = [];
      const transaction = {
        getAll: async (...refs) => refs.map((reference) => snapshot(reference, base)),
        get: async (q) => results(q, base),
        delete: (reference) => writes.push(['delete', reference]),
        update: (reference, data) => writes.push(['update', reference, data]),
        set: (reference, data, options) => writes.push(['set', reference, data, options]),
      };
      const result = await callback(transaction);
      check('commit', writes[0]?.[1].path || 'empty');
      for (const [kind, reference, data, options] of writes) {
        if (kind === 'delete') docs.delete(reference.path);
        else if (kind === 'set') docs.set(reference.path, applyWrite(docs.get(reference.path), data, !options?.merge));
        else docs.set(reference.path, applyWrite(docs.get(reference.path), data, false));
      }
      return result;
    },
  };
  const auth = {
    deleteUser: jest.fn(async (uid) => {
      check('deleteAuth', uid);
    }),
  };
  return {
    docs,
    operations,
    db,
    auth,
    fail: (operation, path) => {
      failure = [operation, path];
    },
    afterQuery: (visit) => { afterQuery = visit; },
    handler: createDeleteUserAccountHandler({ db, auth, now: () => NOW }),
  };
}

test.each([NaN, Infinity, undefined, '1893499200', NOW / 1000 + 1, NOW / 1000 - 601, 0])(
  'rejects invalid or stale recent login %s before changing data',
  async (authTime) => {
    const state = store();
    const input = request();
    input.auth.token.auth_time = authTime;
    await expect(state.handler(input)).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'recent-login' },
    });
    expect(state.operations).toEqual([]);
  },
);

test('requires the initiating account and explicit confirmation before any read or write', async () => {
  const state = store();
  await expect(state.handler(request({ expectedUserId: 'bob' }))).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  await expect(state.handler(request({ confirmation: false }))).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(state.handler({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(state.operations).toEqual([]);
});

test('drains more than 200 personal records, sessions and nested orphaned data without touching another account', async () => {
  const seed = [
    [
      'users/alice',
      {
        name: 'Private name',
        alternateEmail: 'private@example.com',
        authUid: 'old-id',
        balance: 0,
      },
    ],
    ['users/alice/private/deep/children/orphan', { secret: 'private' }],
    ['users/alice/postLoginRuns/run', { studentId: 'private' }],
    ['users/bob/private/one', { secret: 'keep' }],
    ['_puSessions/bob', { ownerUid: 'bob' }],
    ['_studentCardPresentations/alice', { maskedId: '•••• 1234' }],
    ['_studentCardPresentations/bob', { maskedId: '•••• 9876' }],
    ['_puTronClassLmsCache/alice', { ownerUid: 'alice', snapshot: { homework: [] } }],
    ['notifications/bob', { userId: 'bob' }],
  ];
  for (let i = 0; i < 405; i++) {
    seed.push([`notifications/${i}`, { userId: 'alice' }]);
    seed.push([`_puSessions/${i}`, { ownerUid: 'alice' }]);
    seed.push([`_puTronClassSessions/${i}`, { ownerUid: 'alice' }]);
  }
  const state = store(seed);
  expect(await state.handler(request())).toEqual({
    success: true,
    userId: 'alice',
    retainedCategories: RETAINED_CATEGORIES,
  });
  expect([...state.docs.keys()].sort()).toEqual([
    '_puSessions/bob',
    '_studentCardPresentations/bob',
    bindingPath('firebase:alice'),
    'notifications/bob',
    'users/alice',
    'users/bob/private/one',
  ]);
  expect(state.docs.get('users/alice')).toEqual({
    status: 'deleted',
    accountDeletionInProgress: true,
    notificationDeliveryDisabled: true,
    deletedAt: expect.anything(),
  });
  expect(state.operations.at(-1)).toEqual(['deleteAuth', 'alice']);
});

test('closes the independent LMS barrier, erases paginated private operations and retains only opaque blocking slots', async () => {
  const ownerKey = 'firebase:alice';
  const seed = [
    ['users/alice', { name: 'Private name' }],
    [bindingPath(ownerKey), { ownerKey, revision: 'a'.repeat(32), state: 'connected', sealedCookies: 'secret-cookies', purgeAt: new Date(NOW + 1000) }],
    [bindingPath('firebase:bob'), { ownerKey: 'firebase:bob', state: 'connected', sealedCookies: 'bob-secret' }],
    ['_tronClassLoginAttempts/alice', { ownerKey, scope: 'owner', timestamps: [NOW] }],
    ['_tronClassLoginAttempts/shared', { scope: 'account', timestamps: [NOW], purgeAt: new Date(NOW + 900000) }],
    ['_tronClassLoginAttempts/bob', { ownerKey: 'firebase:bob', scope: 'owner', timestamps: [NOW] }],
    ['_tronClassSubmissionOperations/bob', { ownerKey: 'firebase:bob', receipt: { content: 'keep' } }],
    ['_tronClassSubmissionLocks/unsent', { ownerKey, state: 'not-sent', studentId: 1 }],
    ['_tronClassSubmissionLocks/bob', { ownerKey: 'firebase:bob', state: 'unknown', studentId: 2 }],
  ];
  for (const kind of ['submitting', 'unknown', 'submitted']) {
    seed.push([`_tronClassSubmissionLocks/${kind}`, { ownerKey, state: kind, studentId: 1, courseId: 2, operationId: 'private-operation' }]);
  }
  for (let index = 0; index < 205; index++) {
    seed.push([`_tronClassSubmissionOperations/${index}`, { ownerKey, state: 'unknown', files: [{ name: 'private.pdf' }], receipt: { content: 'private-work' } }]);
  }
  const state = store(seed);
  await state.handler(request());
  const barrier = state.docs.get(bindingPath(ownerKey));
  expect(barrier).toEqual({ schoolId: 'pu', state: 'closed', ownerHash: createHash('sha256').update(ownerKey).digest('hex'),
    revision: expect.stringMatching(/^[a-f0-9]{32}$/), updatedAt: NOW });
  expect([...state.docs].filter(([path]) => path.startsWith('_tronClassSubmissionOperations/')))
    .toEqual([['_tronClassSubmissionOperations/bob', { ownerKey: 'firebase:bob', receipt: { content: 'keep' } }]]);
  expect(state.docs.has('_tronClassLoginAttempts/alice')).toBe(false);
  expect(state.docs.get('_tronClassLoginAttempts/shared').timestamps).toEqual([NOW]);
  expect(state.docs.has('_tronClassLoginAttempts/bob')).toBe(true);
  expect(state.docs.has('_tronClassSubmissionLocks/unsent')).toBe(false);
  for (const kind of ['submitting', 'unknown', 'submitted']) {
    expect(state.docs.get(`_tronClassSubmissionLocks/${kind}`)).toEqual({ version: 1, state: 'owner-deleted', updatedAt: NOW });
  }
  expect(state.docs.get('_tronClassSubmissionLocks/bob').ownerKey).toBe('firebase:bob');
  expect(state.docs.get(bindingPath('firebase:bob')).sealedCookies).toBe('bob-secret');
  await state.handler(request());
  expect(state.docs.get(bindingPath(ownerKey))).toEqual(barrier);
});

test('does not release a shared slot acquired by another owner after the cleanup query', async () => {
  const ownerKey = 'platform:pa_alice';
  const path = '_tronClassSubmissionLocks/shared';
  const state = store([[path, { ownerKey, state: 'not-sent' }]]);
  state.afterQuery((collection) => {
    if (collection === '_tronClassSubmissionLocks') {
      state.docs.set(path, { ownerKey: 'platform:pa_bob', state: 'submitting', operationId: 'bobs-request' });
    }
  });
  await closeTronClassOwner({ db: state.db, ownerKey, now: () => NOW });
  expect(state.docs.get(path)).toEqual({ ownerKey: 'platform:pa_bob', state: 'submitting', operationId: 'bobs-request' });
  expect(state.docs.get(bindingPath(ownerKey)).state).toBe('closed');
});

test('keeps a credential-free closure barrier after a cleanup failure and finishes on retry', async () => {
  const state = store([
    ['users/alice', { name: 'Private name' }],
    ['_tronClassSubmissionOperations/one', { ownerKey: 'firebase:alice', receipt: { content: 'private-work' } }],
  ]);
  state.fail('query', '_tronClassSubmissionOperations');
  await expect(state.handler(request())).rejects.toThrow('unavailable');
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
  expect(state.docs.get(bindingPath('firebase:alice')).state).toBe('closed');
  await state.handler(request());
  expect(state.docs.has('_tronClassSubmissionOperations/one')).toBe(false);
  expect(state.auth.deleteUser).toHaveBeenCalledTimes(1);
});

test('scans full-path membership pages, maintains counters and ignores noncanonical same-ID documents', async () => {
  const seed = [
    ['schools/pu/members/alice', { status: 'active' }],
    ['schools/pu/directory/alice', { email: 'private' }],
    ['schools/pu/serviceRoles/alice', { orders: true }],
    ['groups/z-last', { memberCount: 2 }],
    ['groups/z-last/members/alice', { status: 'active', role: 'member' }],
    ['groups/z-last/members/bob', { status: 'active', uid: 'alice' }],
    ['schools/pu/cafeterias/c', { activeOperatorCount: 2 }],
    ['schools/pu/cafeterias/c/operators/alice', { status: 'active', role: 'staff' }],
    ['schools/pu/cafeterias/c/operators/bob', { status: 'active', role: 'owner' }],
    ['archives/a/members/alice', { status: 'active' }],
    ['archives/a/directory/alice', { shared: true }],
  ];
  for (let i = 0; i < 220; i++)
    seed.push([`groups/a-${String(i).padStart(3, '0')}/members/bob`, { status: 'active' }]);
  const state = store(seed);
  await state.handler(request());
  expect(state.docs.get('groups/z-last').memberCount).toBe(1);
  expect(state.docs.get('schools/pu/cafeterias/c').activeOperatorCount).toBe(1);
  expect(state.docs.has('groups/z-last/members/bob')).toBe(true);
  expect(state.docs.has('archives/a/members/alice')).toBe(true);
  expect(state.docs.has('archives/a/directory/alice')).toBe(true);
  expect(state.docs.has('schools/pu/serviceRoles/alice')).toBe(false);
  expect(state.docs.has('schools/pu/cafeterias/c/operators/alice')).toBe(false);
  expect([...state.docs.keys()].filter((key) => key.endsWith('/members/bob'))).toHaveLength(221);
});

test('deletes creator profiles across schools while preserving other users and noncanonical paths', async () => {
  const profile = { displayName: 'Alice', bio: 'Public biography' };
  const otherProfile = { displayName: 'Bob', uid: 'alice' };
  const preserved = [
    ['schools/pu/creatorProfiles/bob', otherProfile],
    ['archives/shared/creatorProfiles/alice', profile],
    ['schools/pu/archives/shared/creatorProfiles/alice', profile],
    ['schools/pu/otherProfiles/alice', profile],
  ];
  const state = store([
    ['schools/pu/creatorProfiles/alice', profile],
    ['schools/other/creatorProfiles/alice', profile],
    ...preserved,
  ]);

  expect((await state.handler(request())).success).toBe(true);
  expect(state.docs.has('schools/pu/creatorProfiles/alice')).toBe(false);
  expect(state.docs.has('schools/other/creatorProfiles/alice')).toBe(false);
  for (const [path, data] of preserved) expect(state.docs.get(path)).toEqual(data);
  expect(state.auth.deleteUser).toHaveBeenCalledWith('alice');
});

test('deletes creator highlights across schools while preserving other users and noncanonical paths', async () => {
  const highlight = { postId: 'post-1' };
  const other = { postId: 'post-2', uid: 'alice' };
  const preserved = [
    ['schools/pu/creatorHighlights/bob', other],
    ['archives/shared/creatorHighlights/alice', highlight],
    ['schools/pu/archives/shared/creatorHighlights/alice', highlight],
    ['schools/pu/otherHighlights/alice', highlight],
  ];
  const state = store([
    ['schools/pu/creatorHighlights/alice', highlight],
    ['schools/other/creatorHighlights/alice', highlight],
    ...preserved,
  ]);

  expect((await state.handler(request())).success).toBe(true);
  expect(state.docs.has('schools/pu/creatorHighlights/alice')).toBe(false);
  expect(state.docs.has('schools/other/creatorHighlights/alice')).toBe(false);
  for (const [path, data] of preserved) expect(state.docs.get(path)).toEqual(data);
  expect(state.auth.deleteUser).toHaveBeenCalledWith('alice');
});

test('creator highlight deletion failures keep Auth available for retry', async () => {
  const path = 'schools/pu/creatorHighlights/alice';
  const state = store([[path, { postId: 'post-1' }]]);
  state.fail('delete', path);

  await expect(state.handler(request())).rejects.toThrow('unavailable');
  expect(state.docs.has(path)).toBe(true);
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
  expect((await state.handler(request())).success).toBe(true);
  expect(state.docs.has(path)).toBe(false);
  expect(state.auth.deleteUser).toHaveBeenCalledTimes(1);
});

test('creator profile deletion failures keep Auth available for retry', async () => {
  const path = 'schools/pu/creatorProfiles/alice';
  const state = store([[path, { bio: 'Public biography' }]]);
  state.fail('delete', path);

  await expect(state.handler(request())).rejects.toThrow('unavailable');
  expect(state.docs.has(path)).toBe(true);
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
  expect((await state.handler(request())).success).toBe(true);
  expect(state.docs.has(path)).toBe(false);
  expect(state.auth.deleteUser).toHaveBeenCalledTimes(1);
});

test.each([
  ['groups/g/members/alice', 'group-ownership'],
  ['schools/pu/cafeterias/c/operators/alice', 'merchant-ownership'],
])('refuses active ownership %s before starting irreversible cleanup', async (path, reason) => {
  const state = store([
    [path, { status: 'active', role: 'owner' }],
    ['users/alice/settings/private', { keep: true }],
  ]);
  await expect(state.handler(request())).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason },
  });
  expect(state.docs.has('users/alice')).toBe(false);
  expect(state.docs.has('users/alice/settings/private')).toBe(true);
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
});

test('legacy merchant ownership without a status is still active', async () => {
  const state = store([['schools/pu/cafeterias/c/operators/alice', { role: 'owner' }]]);
  await expect(state.handler(request())).rejects.toMatchObject({
    details: { reason: 'merchant-ownership' },
  });
  expect(state.docs.has('users/alice')).toBe(false);
});

test('deleting the previous page cursor does not truncate membership cleanup', async () => {
  const seed = [];
  for (let i = 0; i < 205; i++) {
    const path = `groups/g-${String(i).padStart(3, '0')}`;
    seed.push([path, { memberCount: 1 }]);
    seed.push([`${path}/members/alice`, { status: 'active', role: 'member' }]);
  }
  const state = store(seed);
  await state.handler(request());
  expect([...state.docs.keys()].filter((path) => path.endsWith('/members/alice'))).toEqual([]);
  expect([...state.docs.values()].filter((data) => data.memberCount === 0)).toHaveLength(205);
});

test.each([
  ['users/alice', { balance: 1 }],
  ['wallets/alice', { pending: 20, available: 0 }],
  ['users/alice/schools/pu/wallet/balance', { available: 2 }],
  ['users/alice/schools/pu/wallet/balance', { available: '0' }],
  ['users/alice/schools/pu/transactions/t', { status: 'pending', amount: 1 }],
  ['transactions/t', { userId: 'alice', status: 'pending', amount: 1 }],
  ['schools/pu/orders/o', { userId: 'alice', status: 'pending', paymentStatus: 'pending' }],
  ['refundRequests/r', { userId: 'alice', status: 'pending' }],
  ['schools/pu/refunds/r', { userId: 'alice', status: 'needs_review' }],
  ['schools/pu/refunds/r', { studentUid: 'alice', status: 'needs_review' }],
])('does not delete unsettled financial data at %s', async (path, data) => {
  const state = store([
    [path, data],
    ['users/alice/settings/private', { keep: true }],
  ]);
  await expect(state.handler(request())).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason: 'financial-records' },
  });
  expect(state.docs.get(path)).toEqual(data);
  expect(state.docs.has('users/alice/settings/private')).toBe(true);
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
});

test('permits a cancelled unpaid onsite order while preserving its financial mirror', async () => {
  const path = 'users/alice/schools/pu/orders/cancelled';
  const order = {
    userId: 'alice',
    status: 'cancelled',
    paymentMethod: 'onsite',
    paymentStatus: 'pending',
    total: 75,
  };
  const state = store([[path, order]]);
  expect((await state.handler(request())).success).toBe(true);
  expect(state.docs.get(path)).toEqual(order);
});

test.each([
  { status: 'completed', paymentMethod: 'onsite' },
  { status: 'cancelled', paymentMethod: 'credit_card' },
  { status: 'cancelled' },
])('does not extend the unpaid onsite exception to %j', async (patch) => {
  const state = store([
    ['schools/pu/orders/order', { userId: 'alice', paymentStatus: 'pending', ...patch }],
  ]);
  await expect(state.handler(request())).rejects.toMatchObject({
    details: { reason: 'financial-records' },
  });
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
});

test('an unresolved refund still blocks a cancelled unpaid onsite order', async () => {
  const state = store([
    [
      'schools/pu/orders/order',
      { userId: 'alice', status: 'cancelled', paymentMethod: 'onsite', paymentStatus: 'pending' },
    ],
    ['refundRequests/refund', { userId: 'alice', status: 'pending' }],
  ]);
  await expect(state.handler(request())).rejects.toMatchObject({
    details: { reason: 'financial-records' },
  });
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
});

test('preserves completed financial history, coursework and shared content with explicit retention categories', async () => {
  const state = store([
    ['users/alice/schools/pu', { name: 'Private student name' }],
    ['users/alice/schools/pu/wallet/balance', { available: 0, pending: 0 }],
    ['users/alice/schools/pu/transactions/t', { status: 'completed', amount: 500 }],
    [
      'users/alice/schools/pu/orders/o',
      { userId: 'alice', status: 'completed', paymentStatus: 'paid' },
    ],
    ['users/alice/schools/pu/favorites/f', { location: 'private' }],
    ['groups/g/submissions/alice', { userId: 'alice', grade: 90 }],
    ['groups/g/posts/p', { authorId: 'alice', text: 'shared' }],
  ]);
  const response = await state.handler(request());
  expect(response.retainedCategories).toContain('orders-transactions-and-audit-records');
  expect(response.retainedCategories).toContain('coursework-and-reviews');
  expect(state.docs.get('users/alice/schools/pu')).toEqual({ accountClosed: true });
  expect(state.docs.get('users/alice/schools/pu/transactions/t').amount).toBe(500);
  expect(state.docs.has('users/alice/schools/pu/orders/o')).toBe(true);
  expect(state.docs.has('groups/g/submissions/alice')).toBe(true);
  expect(state.docs.has('users/alice/schools/pu/favorites/f')).toBe(false);
});

test('releases controlled event seats atomically and preserves legacy registrations', async () => {
  const event = 'schools/pu/clubEvents/e';
  const state = store([
    [event, { registrationPolicy: { version: 1 }, appRegistrationCount: 2 }],
    [`${event}/registrations/alice`, { userId: 'alice', status: 'registered' }],
    [`${event}/registrations/bob`, { userId: 'bob', status: 'registered' }],
    ['events/legacy/registrations/alice', { userId: 'alice' }],
  ]);
  await state.handler(request());
  expect(state.docs.get(event).appRegistrationCount).toBe(1);
  expect(state.docs.has(`${event}/registrations/alice`)).toBe(false);
  expect(state.docs.has(`${event}/registrations/bob`)).toBe(true);
  expect(state.docs.has('events/legacy/registrations/alice')).toBe(true);
});

test('unverified controlled event counter blocks closure without silently deleting the seat', async () => {
  const event = 'schools/pu/clubEvents/e';
  const state = store([
    [event, { appRegistrationCount: 1 }],
    [`${event}/registrations/alice`, { userId: 'alice', status: 'registered' }],
  ]);
  await expect(state.handler(request())).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason: 'event-registration' },
  });
  expect(state.docs.has(`${event}/registrations/alice`)).toBe(true);
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
});

test.each([
  ['query', 'directory'],
  ['recursiveDelete', 'notifications/n'],
  ['listCollections', 'users/alice'],
])(
  'a %s failure remains visible and a partial retry never decrements group counts twice',
  async (operation, path) => {
    const state = store([
      ['groups/g', { memberCount: 2 }],
      ['groups/g/members/alice', { status: 'active', role: 'member' }],
      ['groups/g/members/bob', { status: 'active' }],
      ['notifications/n', { userId: 'alice' }],
      ['users/alice', { email: 'private@example.com' }],
    ]);
    state.fail(operation, path);
    await expect(state.handler(request())).rejects.toThrow('unavailable');
    expect(state.auth.deleteUser).not.toHaveBeenCalled();
    expect(state.docs.get('users/alice').accountDeletionInProgress).toBe(true);
    expect(state.docs.get('groups/g').memberCount).toBe(1);
    expect((await state.handler(request())).success).toBe(true);
    expect(state.docs.get('groups/g').memberCount).toBe(1);
    expect(state.auth.deleteUser).toHaveBeenCalledTimes(1);
  },
);

test('school membership stamps are cleared in the same commit that marks deletion in progress', async () => {
  const state = store([
    ['users/alice', { email: 'private@example.com' }],
    [
      'schools/pu/members/alice',
      { status: 'active', profileBoundSchoolId: 'pu', profileBoundGeneration: 'gen-1' },
    ],
  ]);
  state.fail('recursiveDelete', 'schools/pu/members/alice');
  await expect(state.handler(request())).rejects.toThrow('unavailable');
  expect(state.auth.deleteUser).not.toHaveBeenCalled();
  expect(state.docs.get('users/alice').accountDeletionInProgress).toBe(true);
  expect(state.docs.get('schools/pu/members/alice')).toEqual({ status: 'inactive' });
});

test('Auth deletion errors stay failures and only missing Auth is idempotent success', async () => {
  const state = store([['users/alice', { email: 'private@example.com' }]]);
  state.auth.deleteUser.mockRejectedValueOnce(
    Object.assign(new Error('Auth unavailable'), { code: 'auth/internal-error' }),
  );
  await expect(state.handler(request())).rejects.toThrow('Auth unavailable');
  expect(state.docs.get('users/alice').email).toBeUndefined();
  state.auth.deleteUser.mockRejectedValueOnce(
    Object.assign(new Error('already removed'), { code: 'auth/user-not-found' }),
  );
  expect((await state.handler(request())).success).toBe(true);
});
