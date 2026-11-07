jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { DORM_REPAIR_COPY, DORM_REPAIR_DISALLOWED_COPY } from '@campus/shared/src/dormitory';
import {
  buildAssistantCapabilityPrompt,
  getAssistantIdentityAnswer,
  getAssistantProfileTrainingSeeds,
} from '../../data/aiAssistantProfile';
import { inferFromRules } from '../../services/localAIEngine';
import {
  distillLearnedSkillFromToolSuccess,
  exportTrainingInsights,
  generateLocalAnswer,
  getDefaultLearningState,
  getDefaultMemory,
  getDefaultTrainingDB,
  isInternalToolSelectionPrompt,
  mergeLearnedSkill,
  redactSensitiveUserTextForAI,
} from '../../data/puAIAgentData';
import { chatWithCampusAssistant } from '../../services/ai';

describe('AI assistant capability profile', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'offline';
    process.env.EXPO_PUBLIC_AI_TEST_FAST = '1';
    delete process.env.APP_ENV;
    delete process.env.EXPO_PUBLIC_API_ENV;
  });

  it('injects agent behavior without pretending model parameters changed', () => {
    const prompt = buildAssistantCapabilityPrompt({
      role: 'student',
      provider: 'offline',
      hasSignedInUser: true,
      hasSchoolId: true,
      isOnline: false,
    });

    expect(prompt).toContain('不能把模型權重或參數量變成雲端大模型等級');
    expect(prompt).toContain('確認卡');
    expect(prompt).toContain('草稿');
    expect(prompt).toContain('不偽造完成');
    expect(prompt).toContain('createOrder');
    expect(prompt).toContain('訂餐流程');
    expect(prompt).toContain('無工具鏈');
    expect(prompt).toContain('代理義務');
  });

  it('seeds local training examples for parameter honesty and confirmed execution', () => {
    const seeds = getAssistantProfileTrainingSeeds();
    expect(seeds.goodExamples.length).toBeGreaterThanOrEqual(12);
    expect(seeds.goodExamples.some((example) => example.q.includes('參數'))).toBe(true);
    expect(seeds.goodExamples.some((example) => example.a.includes('確認卡'))).toBe(true);

    const db = getDefaultTrainingDB();
    const insights = exportTrainingInsights(db);
    expect(db.goodExamples.length).toBeGreaterThanOrEqual(8);
    expect(insights).toContain('讓你的參數跟 ChatGPT 一樣多');
    expect(insights).toContain('不能改變 App 端模型權重');
    const repairSeed = seeds.goodExamples.find((example) => example.q.includes('報修'));
    expect(repairSeed?.a).toContain('報修備忘');
    expect(repairSeed?.a).not.toMatch(DORM_REPAIR_DISALLOWED_COPY);
  });

  it('local dorm repair answers never claim a submitted ticket', () => {
    const inferred = inferFromRules('洗衣機壞了', 'dormitory');
    expect(inferred.some((rule) => rule.conclusion === DORM_REPAIR_COPY.assistantCanHelp
      || rule.conclusion.includes('報修備忘'))).toBe(true);
    for (const rule of inferred) {
      expect(rule.conclusion).not.toMatch(DORM_REPAIR_DISALLOWED_COPY);
      expect(rule.conclusion).not.toContain('可以在 APP 上報修');
    }
    const local = generateLocalAnswer(
      '宿舍冷氣壞了幫我報修',
      ['dormitory'],
      {
        courses: [],
        assignments: [],
        menus: [],
        events: [],
        announcements: [],
        pois: [],
        memory: getDefaultMemory('u1'),
      },
      [],
      getDefaultLearningState(),
    );
    expect(local?.answer).toContain('報修備忘');
    expect(local?.answer).not.toMatch(DORM_REPAIR_DISALLOWED_COPY);
    expect(local?.answer).not.toContain('在 APP 提交');
    expect(local?.answer).not.toContain('要幫你提交報修');
  });

  it('answers parameter requests honestly in offline chat', async () => {
    const response = await chatWithCampusAssistant(
      [{ role: 'user', content: '繼續訓練你，讓你的參數跟 ChatGPT 一樣多' }],
      { schoolId: 'tw-pu', userId: 'u1', userName: '測試同學' },
    );

    expect(response.content).toContain('不能把 App 端模型參數量');
    expect(response.content).toContain('不會假裝');
    expect(response.content).toContain('DataSource');
  });

  it('puts wellbeing calls to action before general advice in offline chat', async () => {
    const response = await chatWithCampusAssistant(
      [{ role: 'user', content: '我頭痛想掛號' }],
      { schoolId: 'tw-pu', userId: 'u1', userName: '測試同學' },
    );
    const paragraphs = response.content.split('\n\n');

    expect(paragraphs[0]).toContain('身體不太舒服');
    expect(paragraphs[1]).toContain('下一步');
    expect(response.content).toContain('我不能替代醫師診斷');
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'navigate',
          params: expect.objectContaining({ screen: '校園', nested: 'Health' }),
        }),
      ]),
    );
  });

  it('routes offline mood distress to campus health action', async () => {
    const response = await chatWithCampusAssistant(
      [{ role: 'user', content: '我最近壓力很大快撐不住' }],
      { schoolId: 'tw-pu', userId: 'u1', userName: '測試同學' },
    );
    const paragraphs = response.content.split('\n\n');

    expect(paragraphs[0]).toContain('壓力');
    expect(paragraphs[1]).toContain('下一步');
    expect(response.content).toContain('1925');
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'navigate',
          params: expect.objectContaining({ screen: '校園', nested: 'Health' }),
        }),
      ]),
    );
  });

  it('exposes the same identity policy for non-offline providers', () => {
    const answer = getAssistantIdentityAnswer('gemini');
    expect(answer).toContain('不能把 App 端模型參數量');
    expect(answer).toContain('雲端或本地 LLM');
    expect(answer).toContain('工具權限');
  });

  it('distills a skill after successful tool pattern (and skips internal tool prompts)', () => {
    expect(isInternalToolSelectionPrompt('你是校園 AI 助理的「工具選擇器」。\n## 可用工具')).toBe(
      true,
    );
    const skill = distillLearnedSkillFromToolSuccess(
      '幫我點蛋餅',
      'create_order',
      { itemName: '蛋餅', quantity: '1' },
      '已為你下單！',
    );
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('distilled');
    expect(skill!.procedure).toContain('create_order');
    const db = mergeLearnedSkill(getDefaultTrainingDB(), skill!);
    const insights = exportTrainingInsights(db, '幫我點早餐蛋餅');
    expect(insights).toContain('成功任務蒸餾');
    expect(insights).toContain('校園訂餐');
  });

  it('redacts sensitive user text before skill distillation', () => {
    const text = '我的身分證 A123456789，電話 0912-345-678，密碼=abc123，信箱 test@example.com';
    const redacted = redactSensitiveUserTextForAI(text);

    expect(redacted).not.toContain('A123456789');
    expect(redacted).not.toContain('0912-345-678');
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('test@example.com');

    const skill = distillLearnedSkillFromToolSuccess(
      text,
      'send_message',
      { content: '電話 0912-345-678', peerId: 'peer-1' },
      '已送出',
    );
    expect(skill?.procedure).not.toContain('0912-345-678');
    expect(skill?.procedure).not.toContain('abc123');
    expect(skill?.procedure).toContain('[電話已遮蔽]');
  });

  it('does not call client-side Gemini in release builds', async () => {
    process.env.APP_ENV = 'production';
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'gemini';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'client-key-should-not-be-used';

    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    try {
      const response = await chatWithCampusAssistant(
        [{ role: 'user', content: '幫我查最新公告' }],
        { schoolId: 'tw-pu', userId: 'u1', userName: '測試同學' },
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.error).toContain('後端代理');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });
});
