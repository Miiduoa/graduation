/* eslint-disable @typescript-eslint/no-explicit-any */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import {
  autonomousQuery,
  resetAdaptiveLearnedPatternsForTests,
} from '../../services/aiLocalAgent';
import {
  clearLearningForUser,
  getSnapshot,
  initLearningForUser,
} from '../../services/aiContinualLearning';

const USER_ID = 'agent-process-training-user';
const CTX = {
  userId: USER_ID,
  schoolId: 'pu',
  role: 'student' as const,
  isOnline: true,
};

describe('AI agent process training', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetAdaptiveLearnedPatternsForTests();
    setDataSource(mockSource as any);
    await initLearningForUser(USER_ID);
  });

  afterEach(async () => {
    await clearLearningForUser(USER_ID);
    await AsyncStorage.clear();
  });

  it('records no-tool natural-language decisions as agent process training', async () => {
    const result = await autonomousQuery(
      '我只是想聊聊今天心情很亂，不用查資料也不用幫我做任何事',
      CTX,
      undefined,
      [],
    );

    expect(result.intents).toEqual([]);

    const snapshot = getSnapshot();
    const learnedFacts = snapshot?.memory.learnedFacts.map((fact) => fact.fact).join('\n') ?? '';
    expect(learnedFacts).toContain('代理流程訓練');
    expect(learnedFacts).toContain('意圖=none');
    expect(snapshot?.memory.conversationPatterns.length).toBeGreaterThan(0);
  });

  it('records executed write tools as part of the same agent process', async () => {
    const result = await autonomousQuery('幫我私訊阿銘跟他說明天早上十點碰面', CTX);

    expect(result.executedActions.some((action) => action.tool === 'send_message')).toBe(true);

    const snapshot = getSnapshot();
    const learnedFacts = snapshot?.memory.learnedFacts.map((fact) => fact.fact).join('\n') ?? '';
    expect(learnedFacts).toContain('代理流程訓練');
    expect(learnedFacts).toContain('寫入=send_message:ok');
    expect(snapshot?.memory.recentActions.some((action) => action.toolId === 'send_message')).toBe(
      true,
    );
  });

  it('records capability gaps instead of pretending unsupported external actions are done', async () => {
    const result = await autonomousQuery(
      '幫我打電話給房東催他今天修水管；如果你不能打，就先幫我擬一段可以照著講的稿',
      CTX,
      undefined,
      [],
    );

    expect(result.executedActions).toEqual([]);

    const snapshot = getSnapshot();
    const learnedFacts = snapshot?.memory.learnedFacts.map((fact) => fact.fact).join('\n') ?? '';
    expect(learnedFacts).toContain('代理流程訓練');
    expect(learnedFacts).toContain('能力缺口=phone_call');
    expect(learnedFacts).toContain('寫入=none');
    expect(learnedFacts).toContain('缺口=create_repair_request');
  });
});
