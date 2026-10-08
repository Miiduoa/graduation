jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));
jest.mock('./lib/assistantFetchers', () => ({
  ...jest.requireActual('./lib/assistantFetchers'),
  fetchAssistantPendingAssignments: jest.fn(),
}));
const { getFirestore } = require('firebase-admin/firestore');
const { fetchAssistantPendingAssignments } = require('./lib/assistantFetchers');
const writes = [];
function reference(path) {
  const ref = {
    id: path.split('/').pop(),
    collection: (name) => reference(`${path}/${name}`),
    doc: (id = 'snapshot') => reference(`${path}/${id}`),
    orderBy: () => ref,
    limit: () => ref,
    get: async () =>
      path.includes('/members/')
        ? { exists: true, data: () => ({ status: 'active' }) }
        : { empty: true, docs: [] },
    set: async (value) => writes.push({ path, value }),
  };
  return ref;
}
getFirestore.mockReturnValue({ collection: reference });
const { getStudentRiskSnapshots } = require('./index');

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  fetchAssistantPendingAssignments.mockResolvedValue([]);
});

test('new course summaries use the authenticated account and explicitly selected school', async () => {
  await getStudentRiskSnapshots.run({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } });
  expect(fetchAssistantPendingAssignments).toHaveBeenCalledWith('alice', 'pu');
  expect(writes[0].path).toBe('users/alice/schools/pu/riskSnapshots/snapshot');
});

test('a missing school cannot be treated as an empty assignment list', async () => {
  await expect(
    getStudentRiskSnapshots.run({ auth: { uid: 'alice' }, data: {} }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fetchAssistantPendingAssignments).not.toHaveBeenCalled();
  expect(writes).toHaveLength(0);
});

test('an unavailable assignment source never generates a reassuring empty summary', async () => {
  fetchAssistantPendingAssignments.mockRejectedValue(new Error('source unavailable'));
  await expect(
    getStudentRiskSnapshots.run({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } }),
  ).rejects.toThrow('source unavailable');
  expect(writes).toHaveLength(0);
});
