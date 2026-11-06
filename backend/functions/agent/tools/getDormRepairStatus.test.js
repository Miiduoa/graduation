'use strict';

const mockRecords = new Map();
const mockReads = [];

function mockRef(path) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    get: async () => {
      mockReads.push(path);
      const data = mockRecords.get(path);
      return { id: path.split('/').pop(), exists: data !== undefined, data: () => data };
    },
  };
}

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: (name) => mockRef(name) }),
}));

const { execute } = require('./getDormRepairStatus');
const { isAuthorizationDeniedResult } = require('../authorizationFailure');
const context = { uid: 'alice', schoolId: 'pu' };
const repairId = 'repair-fixture';
const path = `schools/pu/repairRequests/${repairId}`;

beforeEach(() => {
  mockRecords.clear();
  mockReads.length = 0;
});

test('another account record returns an explicit denial without disclosing its contents', async () => {
  mockRecords.set(path, {
    userId: 'bob', description: 'private-repair-description', room: 'private-room',
  });

  const result = await execute(context, { repairId });

  expect(isAuthorizationDeniedResult(result)).toBe(true);
  expect(result).toMatchObject({ found: false, forbidden: true, success: false, errorCode: 'permission-denied' });
  expect(JSON.stringify(result)).not.toMatch(/private-repair-description|private-room|bob/);
  expect(mockReads).toEqual([path]);
});

test('a missing repair is not an authorization denial', async () => {
  const result = await execute(context, { repairId });

  expect(result).toEqual({ found: false, repairId });
  expect(isAuthorizationDeniedResult(result)).toBe(false);
});

test('the owner can read their record even when its description discusses denied access', async () => {
  const description = 'The repair screen says permission-denied; please inspect it.';
  mockRecords.set(path, { userId: 'alice', description, status: 'pending', room: '301' });

  const result = await execute(context, { repairId });

  expect(result).toMatchObject({ found: true, repairId, description, room: '301' });
  expect(isAuthorizationDeniedResult(result)).toBe(false);
});
