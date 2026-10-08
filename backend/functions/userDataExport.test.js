const { createExportUserDataHandler } = require('./userDataExport');

function source(seed = {}) {
  const reads = [];
  let failPath = null;
  function reference(path) {
    return {
      path,
      id: path.split('/').pop(),
      parent: { parent: { id: path.split('/').at(-3) } },
      collection: (name) => query(`${path}/${name}`),
      get: async () => {
        reads.push(path);
        if (failPath === path) throw new Error('source unavailable');
        return snapshot(path);
      },
    };
  }
  function snapshot(path) {
    return {
      id: path.split('/').pop(),
      ref: reference(path),
      exists: path in seed,
      data: () => seed[path],
    };
  }
  function query(path, filters = [], maximum = Infinity, group = false) {
    return {
      doc: (id) => reference(`${path}/${id}`),
      where: (field, operator, value) =>
        query(path, [...filters, { field, operator, value }], maximum, group),
      orderBy: () => query(path, filters, maximum, group),
      limit: (count) => query(path, filters, count, group),
      get: async () => {
        reads.push(path);
        if (failPath === path) throw new Error('source unavailable');
        return {
          docs: Object.keys(seed)
            .filter((key) => {
              const parent = key.split('/').slice(0, -1).join('/');
              return (
                (group ? key.split('/').at(-2) === path : parent === path) &&
                filters.every(({ field, operator, value }) =>
                  operator === 'array-contains'
                    ? seed[key][field]?.includes(value)
                    : seed[key][field] === value,
                )
              );
            })
            .slice(0, maximum)
            .map(snapshot),
        };
      },
    };
  }
  return {
    db: { collection: query, collectionGroup: (name) => query(name, [], Infinity, true) },
    reads,
    fail: (path) => {
      failPath = path;
    },
  };
}
const request = (categories, extra = {}) => ({
  auth: { uid: 'alice' },
  data: { expectedUserId: 'alice', schoolId: 'pu', categories, ...extra },
});
const handler = (store) =>
  createExportUserDataHandler({
    db: store.db,
    resolveUserSchoolId: async (_, school) => school,
    now: () => new Date('2026-10-08T00:00:00Z'),
  });

test('profile selection never reads or returns school records, wallet or other categories', async () => {
  const store = source({
    'users/alice': { displayName: 'Alice', id: 'forged' },
    'users/alice/schools/pu/grades/one': { score: 80 },
  });
  const result = await handler(store)(request(['profile']));
  expect(result.profile).toEqual({ displayName: 'Alice', id: 'alice' });
  expect(result.schoolScoped).toBeUndefined();
  expect(store.reads).toEqual(['users/alice']);
  expect(result.coverage).toMatchObject({ categories: ['profile'], truncated: false });
});
test.each([null, [], ['unknown'], ['profile', 1]])(
  'rejects invalid categories %j before reading data',
  async (categories) => {
    const store = source();
    await expect(handler(store)(request(categories))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(store.reads).toEqual([]);
  },
);
test('a changed token owner cannot export the newly signed in account', async () => {
  const store = source();
  await expect(
    handler(store)(request(['profile'], { expectedUserId: 'bob' })),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(handler(store)({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(store.reads).toEqual([]);
});
test('only explicitly selected school records are returned with overflow evidence', async () => {
  const seed = Object.fromEntries(
    Array.from({ length: 201 }, (_, i) => [
      `users/alice/schools/pu/grades/${i}`,
      { score: i % 100 },
    ]),
  );
  const result = await handler(source(seed))(request(['schoolRecords']));
  expect(result.schoolScoped.grades).toHaveLength(200);
  expect(result.coverage.truncatedSections).toEqual(['schoolScoped.grades']);
  expect(result.coverage.sections['schoolScoped.grades']).toEqual({
    count: 200,
    limit: 200,
    truncated: true,
  });
  expect(result.profile).toBeUndefined();
});
test('an exactly full category is not falsely marked truncated', async () => {
  const seed = Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [`users/alice/favorites/${i}`, {}]),
  );
  const result = await handler(source(seed))(request(['favorites']));
  expect(result.favorites).toHaveLength(200);
  expect(result.coverage.truncated).toBe(false);
});
test('retains legacy and scoped favorites without replacing one source with the other', async () => {
  const store = source({
    'users/alice/favorites/old': {},
    'users/alice/schools/pu/favorites/new': {},
    'users/bob/favorites/private': {},
  });
  const result = await handler(store)(request(['favorites']));
  expect(result.favorites).toEqual([{ id: 'old' }]);
  expect(result.schoolFavorites).toEqual([{ id: 'new' }]);
});
test('deduplicates the two submission ownership fields and excludes other accounts', async () => {
  const store = source({
    'schools/pu/assignments/a/submissions/one': { studentId: 'alice', userId: 'alice' },
    'schools/pu/assignments/a/submissions/two': { studentId: 'bob', userId: 'bob' },
    'schools/pu/assignments/a/submissions/three': { studentId: 'alice' },
  });
  expect((await handler(store)(request(['assignments']))).submissions.map((row) => row.id)).toEqual(
    ['one', 'three'],
  );
});
test('never reports a failed source as a successful empty export', async () => {
  const store = source();
  store.fail('users/alice/favorites');
  await expect(handler(store)(request(['favorites']))).rejects.toThrow('source unavailable');
});
test('message export restricts conversations to membership and school, marking nested overflow', async () => {
  const seed = {
    'conversations/mine': { memberIds: ['alice', 'bob'], schoolId: 'pu' },
    'conversations/foreign': { memberIds: ['alice'], schoolId: 'other' },
    'conversations/private': { memberIds: ['bob'], schoolId: 'pu' },
    ...Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [
        `conversations/mine/messages/${i}`,
        { text: 'message' },
      ]),
    ),
  };
  const store = source(seed);
  const result = await handler(store)(request(['messages']));
  expect(result.conversations.map((row) => row.id)).toEqual(['mine']);
  expect(result.conversations[0].messages).toHaveLength(200);
  expect(result.coverage.truncatedSections).toEqual(['conversations.mine.messages']);
  expect(store.reads).not.toContain('conversations/private/messages');
  expect(store.reads).not.toContain('conversations/foreign/messages');
});
test.each(['schoolRecords', 'lostfound'])('requires a school for %s', async (category) => {
  await expect(handler(source())(request([category], { schoolId: null }))).rejects.toMatchObject({
    code: 'failed-precondition',
  });
});
test('rejects paths supplied as school identifiers', async () => {
  await expect(
    handler(source())(request(['profile'], { schoolId: 'pu/members/bob' })),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
});

test('deployment declares group indexes required by export and account closure queries', () => {
  const { fieldOverrides } = require('../firestore/firestore.indexes.json');
  for (const [collectionGroup, fieldPath] of [
    ['posts', 'authorId'],
    ['submissions', 'studentId'],
    ['submissions', 'userId'],
    ['registrations', 'userId'],
    ['orders', 'userId'],
    ['refundRequests', 'userId'],
    ['refunds', 'userId'],
  ]) {
    expect(fieldOverrides).toContainEqual(
      expect.objectContaining({
        collectionGroup,
        fieldPath,
        indexes: expect.arrayContaining([{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }]),
      }),
    );
  }
});
