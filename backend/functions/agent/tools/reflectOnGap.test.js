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
    expect(out.breakthrough.canSelfResolveNow).toBe(true);
    expect(out.breakthrough.suggestedTools.some((tool) => tool.name === 'searchCampusDocs')).toBe(true);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        gap: '無法回答選課限制',
        query: '可以加選嗎',
        status: expect.any(String),
        fingerprint: expect.any(String),
        breakthrough: expect.objectContaining({
          learningSteps: expect.any(Array),
        }),
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
        breakthrough: expect.objectContaining({
          gapType: 'tool_or_integration',
          suggestedTools: expect.arrayContaining([
            expect.objectContaining({ name: 'getLibraryLoans' }),
          ]),
        }),
      }),
    );
  });

  test('records attempted tools and proposes untried fallback', async () => {
    const out = await reflectOnGap.execute(
      { uid: 'u1', schoolId: 's1', intent: 'assignment_status' },
      {
        gap: '查不到作業',
        query: '我有哪些作業快截止',
        attemptedTools: ['getAssignments'],
        failedBecause: 'getAssignments returned empty array',
        desiredCapability: '自動改查課程文件與公告中的作業線索',
      },
    );
    expect(out.breakthrough.suggestedTools.some((tool) => tool.name === 'searchCampusDocs')).toBe(true);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedTools: ['getAssignments'],
        desiredCapability: '自動改查課程文件與公告中的作業線索',
        status: 'self_resolve_candidate',
      }),
    );
  });
});
