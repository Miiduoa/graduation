'use strict';

const mockAdd = jest.fn(() => Promise.resolve({ id: 'gap-doc-1' }));
const mockCollection = jest.fn(() => ({
  doc: jest.fn(() => ({
    collection: jest.fn(() => ({ add: mockAdd })),
  })),
}));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: jest.fn(() => 'ts') },
}));

const reflectOnGap = require('./reflectOnGap');

describe('reflectOnGap tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes to agent_gaps/{schoolId}/gaps', async () => {
    const out = await reflectOnGap.execute(
      { uid: 'u1', schoolId: 's1', intent: 'general' },
      { gap: '無法回答選課限制', query: '可以加選嗎' },
    );
    expect(mockCollection).toHaveBeenCalledWith('agent_gaps');
    expect(out.ok).toBe(true);
    expect(out.gapId).toBe('gap-doc-1');
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        gap: '無法回答選課限制',
        query: '可以加選嗎',
        uid: 'u1',
        intent: 'general',
      }),
    );
  });

  test('uses unknown school when ctx.schoolId missing', async () => {
    const out = await reflectOnGap.execute({ uid: 'u1' }, { gap: 'x' });
    expect(out.schoolId).toBe('unknown');
  });

  test('accepts reason only as gap text', async () => {
    await reflectOnGap.execute({ uid: 'u1', schoolId: 's1' }, { reason: '無圖書 API', query: '借書' });
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        gap: '無圖書 API',
        query: '借書',
      }),
    );
  });
});
