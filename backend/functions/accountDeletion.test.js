const { createDeleteUserAccountHandler, RETAINED_CATEGORIES } = require('./accountDeletion');

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
        docs.set(path, options?.merge ? { ...docs.get(path), ...data } : data);
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
        return results(value);
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
      };
      const result = await callback(transaction);
      check('commit', writes[0]?.[1].path || 'empty');
      for (const [kind, reference, data] of writes) {
        if (kind === 'delete') docs.delete(reference.path);
        else docs.set(reference.path, { ...docs.get(reference.path), ...data });
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
