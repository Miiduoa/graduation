/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { expect } from '@jest/globals';
import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import { resetAdaptiveLearnedPatternsForTests } from '../../services/aiLocalAgent';
import {
  MULTI_TURN_SELF_DIALOG_SCENARIOS,
  runOneMultiTurnScenario,
} from '../../services/aiSelfDialogMultiTurn';

describe('AI 多輪對話離線驗收', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'offline';
    process.env.EXPO_PUBLIC_AI_TEST_FAST = '1';
    setDataSource(mockSource as any);
    resetAdaptiveLearnedPatternsForTests();
  });

  jest.setTimeout(120000);

  it('explains an unverified attendance lookup without claiming a personal check-in', async () => {
    const scenario = MULTI_TURN_SELF_DIALOG_SCENARIOS.find(sc => sc.id === 'mt-already-checked-in')!;
    const { results, failure } = await runOneMultiTurnScenario(scenario);
    const last = results.at(-1)!;
    const read = last.results.find(item => item.tool === 'query_attendance');
    expect(read?.result).toMatchObject({ success: false, error: 'school_scope_unverified' });
    expect(last.contextText).toContain('目前所選校園的學校資料尚未驗證');
    expect(last.contextText).not.toContain('已簽到成功');
    expect(failure).toBeNull();
  });


  it('內建場景逐則須通過工具與 context 驗收', async () => {
    for (const sc of MULTI_TURN_SELF_DIALOG_SCENARIOS) {
      const { failure } = await runOneMultiTurnScenario(sc);
      expect(failure).toBeNull();
    }
  });

  it('未驗證簽到情境回傳驗證提示並維持零寫入', async () => {
    const scenario = MULTI_TURN_SELF_DIALOG_SCENARIOS.find((sc) => sc.id === 'mt-already-checked-in')!;
    const { results, failure } = await runOneMultiTurnScenario(scenario);
    expect(failure).toBeNull();
    const last = results[results.length - 1]!;
    expect(last.results).toEqual([
      expect.objectContaining({
        tool: 'query_attendance',
        result: expect.objectContaining({
          success: false,
          isWrite: false,
          error: 'school_scope_unverified',
        }),
      }),
    ]);
    expect(last.results[0]?.result.data).toBeUndefined();
    expect(last.contextText).toContain('目前所選校園的學校資料尚未驗證');
    expect(last.contextText).not.toContain('已簽到成功');
    expect(last.executedActions).toEqual([]);
    expect(last.failedActions).toEqual([]);
    expect(last.pendingWriteActions).toEqual([]);
  });
});
