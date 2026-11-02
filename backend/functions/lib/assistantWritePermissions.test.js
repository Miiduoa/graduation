'use strict';

const {
  createDefaultAssistantWritePermissions,
  isAssistantWriteToolAllowed,
  loadAssistantWritePermissions,
  normalizeAssistantWritePermissions,
  resolveAssistantWritePermissions,
  ASSISTANT_WRITE_PERMISSION_KEYS,
} = require('./assistantWritePermissions');

describe('assistantWritePermissions helpers', () => {
  test('unset document resolves to all closed', () => {
    const closed = createDefaultAssistantWritePermissions();
    for (const key of ASSISTANT_WRITE_PERMISSION_KEYS) {
      expect(closed[key]).toBe(false);
      expect(isAssistantWriteToolAllowed(closed, key)).toBe(false);
    }
  });

  test('explicit false and malformed values stay closed; true opens one tool', () => {
    const perms = normalizeAssistantWritePermissions({
      reserveSeat: true,
      borrowBook: false,
      renewBook: 'true',
    });
    expect(isAssistantWriteToolAllowed(perms, 'reserveSeat')).toBe(true);
    expect(isAssistantWriteToolAllowed(perms, 'borrowBook')).toBe(false);
    expect(isAssistantWriteToolAllowed(perms, 'renewBook')).toBe(false);
  });

  test('resolveAssistantWritePermissions tolerates throwy input via normalize', () => {
    expect(resolveAssistantWritePermissions(undefined).createOrder).toBe(false);
  });

  test('loadAssistantWritePermissions returns closed when uid missing', async () => {
    const db = {
      collection: () => {
        throw new Error('should not read');
      },
    };
    const perms = await loadAssistantWritePermissions(db, null);
    expect(perms.createOrder).toBe(false);
  });

  test('loadAssistantWritePermissions fails closed when firestore throws', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => {
                throw new Error('unavailable');
              },
            }),
          }),
        }),
      }),
    };
    const perms = await loadAssistantWritePermissions(db, 'alice');
    expect(isAssistantWriteToolAllowed(perms, 'createOrder')).toBe(false);
  });

  test('loadAssistantWritePermissions reads enabled flags from settings doc', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({ createOrder: true, cancelOrder: false }),
              }),
            }),
          }),
        }),
      }),
    };
    const perms = await loadAssistantWritePermissions(db, 'alice');
    expect(isAssistantWriteToolAllowed(perms, 'createOrder')).toBe(true);
    expect(isAssistantWriteToolAllowed(perms, 'cancelOrder')).toBe(false);
    expect(isAssistantWriteToolAllowed(perms, 'borrowBook')).toBe(false);
  });
});
