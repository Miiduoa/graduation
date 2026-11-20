'use strict';

const mockGet = jest.fn();
const mockRef = {
  collection: () => mockRef,
  doc: () => mockRef,
  get: mockGet,
};
jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => mockRef }));

const getCafeteriaMenu = require('./getCafeteriaMenu');
const context = { uid: 'alice', schoolId: 'pu' };
const input = { cafeteriaId: 'cafe' };
const cafeteria = { exists: true, data: () => ({ name: '校園餐廳' }) };

beforeEach(() => mockGet.mockReset());

describe.each(['cafeteria', 'menu'])('%s authorization errors', (stage) => {
  test.each(['permission-denied', 'unauthenticated', 7, 16])('propagates %p to the dispatcher', async (code) => {
    const error = Object.assign(new Error('private-document-id'), { code });
    if (stage === 'menu') mockGet.mockResolvedValueOnce(cafeteria);
    mockGet.mockRejectedValueOnce(error);

    await expect(getCafeteriaMenu.execute(context, input)).rejects.toBe(error);
    expect(mockGet).toHaveBeenCalledTimes(stage === 'menu' ? 2 : 1);
  });
});

test('a temporary read failure still returns the existing failure result', async () => {
  mockGet.mockRejectedValueOnce(Object.assign(new Error('temporarily unavailable'), { code: 'unavailable' }));
  await expect(getCafeteriaMenu.execute(context, input)).resolves.toMatchObject({
    success: false, errorCode: 'read_failed',
  });
});

test('an authorized empty menu remains a successful empty result', async () => {
  mockGet.mockResolvedValueOnce(cafeteria).mockResolvedValueOnce({ docs: [] });
  await expect(getCafeteriaMenu.execute(context, input)).resolves.toMatchObject({
    success: true, count: 0, items: [],
  });
});
