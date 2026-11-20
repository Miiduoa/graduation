'use strict';

const {
  buildBreakthroughPlan,
  classifyGapType,
  rankSuggestedTools,
} = require('./breakthroughPlanner');

describe('breakthroughPlanner', () => {
  test('classifies auth and integration gaps', () => {
    expect(classifyGapType('登入後還是 unauthorized')).toBe('permission_or_auth');
    expect(classifyGapType('缺少 TronClass API connector')).toBe('tool_or_integration');
  });

  test('suggests assignment fallback tools for empty homework results', () => {
    const plan = buildBreakthroughPlan({
      query: '我有哪些作業快截止',
      gap: 'getAssignments 回傳空結果',
      attemptedTools: ['getAssignments'],
      desiredCapability: '改查課程文件與公告中的作業線索',
    });

    expect(plan.fingerprint).toHaveLength(16);
    expect(plan.canSelfResolveNow).toBe(true);
    expect(plan.suggestedTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'searchCampusDocs', alreadyAttempted: false }),
      ]),
    );
    expect(plan.learningSteps.join('\n')).toContain('learned skill');
  });

  test('ranks library tools for book questions', () => {
    const tools = rankSuggestedTools('圖書館借書快逾期但查不到紀錄', []);
    expect(tools[0].name).toBe('getLibraryLoans');
  });
});
