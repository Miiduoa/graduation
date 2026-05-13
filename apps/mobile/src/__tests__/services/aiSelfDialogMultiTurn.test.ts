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

  it('內建場景逐則須通過工具與 context 驗收', async () => {
    for (const sc of MULTI_TURN_SELF_DIALOG_SCENARIOS) {
      const { failure } = await runOneMultiTurnScenario(sc);
      expect(failure).toBeNull();
    }
  });
});
