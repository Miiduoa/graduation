'use strict';

const mockDocuments = new Map();

function mockRef(path) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    get: async () => {
      const data = mockDocuments.get(path);
      if (data instanceof Error) throw data;
      return { exists: data !== undefined, data: () => data };
    },
  };
}

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: (name) => mockRef(name) }),
}));

jest.mock('../../lib/onlineOrdering', () => ({
  isOnlineOrderingEnabled: () => true,
  ONLINE_ORDERING_OFF_MESSAGE: 'online ordering off',
}));

const proposeOrder = require('./proposeOrder');

describe('proposeOrder assistant write permission', () => {
  beforeEach(() => {
    mockDocuments.clear();
    mockDocuments.set('schools/pu/cafeterias/cafe', { name: '校園餐廳', orderingEnabled: true });
    mockDocuments.set('schools/pu/cafeterias/cafe/menuItems/rice', {
      name: '雞腿飯',
      price: 90,
      available: true,
      stock: 10,
    });
  });

  test('closed createOrder permission returns denial and no draft', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', { createOrder: false });
    const result = await proposeOrder.execute(
      { uid: 'alice', schoolId: 'pu' },
      { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', quantity: 1 }] },
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('assistant_write_permission_denied');
    expect(result.errorMessage).toMatch(/餐廳下單/);
    expect(result.draft).toBeUndefined();
  });

  test('enabled createOrder permission still builds a draft', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', { createOrder: true });
    const result = await proposeOrder.execute(
      { uid: 'alice', schoolId: 'pu' },
      { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', quantity: 1 }] },
    );
    expect(result.success).toBe(true);
    expect(result.draft?.cafeteriaId).toBe('cafe');
    expect(result.draft?.items?.[0]?.menuItemId).toBe('rice');
  });

  test.each(['permission-denied', 'unauthenticated', 7, 16])('propagates a cafeteria authorization error %p', async (code) => {
    mockDocuments.set('users/alice/settings/assistantPermissions', { createOrder: true });
    const error = Object.assign(new Error('private-document-id'), { code });
    mockDocuments.set('schools/pu/cafeterias/cafe', error);

    await expect(proposeOrder.execute(
      { uid: 'alice', schoolId: 'pu' },
      { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', quantity: 1 }] },
    )).rejects.toBe(error);
  });

  test('a temporary cafeteria failure still returns the existing failure result', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', { createOrder: true });
    mockDocuments.set('schools/pu/cafeterias/cafe', Object.assign(new Error('temporarily unavailable'), { code: 'unavailable' }));

    const result = await proposeOrder.execute(
      { uid: 'alice', schoolId: 'pu' },
      { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', quantity: 1 }] },
    );
    expect(result).toMatchObject({ success: false, errorCode: 'propose_failed' });
    expect(result.draft).toBeUndefined();
  });
});
