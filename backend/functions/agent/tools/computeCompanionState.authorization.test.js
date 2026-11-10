'use strict';

const mockDocuments = new Map();
const mockReads = [];
function mockRef(path) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    where: () => mockRef(path),
    orderBy: () => mockRef(path),
    get: async () => {
      mockReads.push(path);
      const data = mockDocuments.get(path);
      if (data instanceof Error) throw data;
      return { exists: data !== undefined, data: () => data, docs: [] };
    },
  };
}
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: (name) => mockRef(name) }),
}));

const computeCompanionState = require('./computeCompanionState');
const context = { uid: 'alice', schoolId: 'pu' };
const paths = [
  'users/alice/companionSignals',
  'users/alice',
  'users/alice/gardenCache/current',
];

beforeEach(() => {
  mockDocuments.clear();
  mockReads.length = 0;
});

describe.each(paths)('%s', (path) => {
  test.each(['permission-denied', 'unauthenticated', 7, 16])('propagates authorization error %p and stops further reads', async (code) => {
    const error = Object.assign(new Error('private-document-id'), { code });
    mockDocuments.set(path, error);

    await expect(computeCompanionState.execute(context, {})).rejects.toBe(error);
    expect(mockReads).toEqual(paths.slice(0, paths.indexOf(path) + 1));
  });

  test('a temporary read failure retains the existing fallback', async () => {
    mockDocuments.set(path, Object.assign(new Error('temporarily unavailable'), { code: 'unavailable' }));

    await expect(computeCompanionState.execute(context, {})).resolves.toMatchObject({ success: true });
    expect(mockReads).toEqual(paths);
  });
});

test('missing optional data retains the existing fallback', async () => {
  await expect(computeCompanionState.execute(context, {})).resolves.toMatchObject({ success: true });
  expect(mockReads).toEqual(paths);
});
