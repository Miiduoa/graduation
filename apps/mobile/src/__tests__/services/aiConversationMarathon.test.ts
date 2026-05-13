/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 離線馬拉松：模糊／對抗／多語／錯字／Unicode 雜訊／簡繁混用，
 * 補齊 aiAgentWideCoverage 之外的口語變體（不重複「乾淨」基準句）。
 */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import type { AssistantChoiceMenu } from '../../services/aiToolRegistry';
import { autonomousQuery, resetAdaptiveLearnedPatternsForTests, type AgentQueryResult } from '../../services/aiLocalAgent';
import {
  evaluateSelfDialogResponse,
  type AISelfDialogScenario,
} from '../../services/aiSelfDialog';

const PU = { userId: 'marathon-user', schoolId: 'pu', role: 'student' as const, isOnline: true };

function observedTools(result: AgentQueryResult): Set<string> {
  return new Set([
    ...result.intents.map((i) => i.tool),
    ...result.results.map((r) => r.tool),
    ...result.executedActions.map((a) => a.tool),
    ...result.failedActions.map((a) => a.tool),
  ]);
}

async function expectHit(message: string, anyOf: string[], ctx: typeof PU = PU): Promise<void> {
  const r = await autonomousQuery(message, ctx);
  const seen = observedTools(r);
  expect(anyOf.some((t) => seen.has(t))).toBe(true);
}

async function expectNoTool(message: string, forbidden: string, ctx: typeof PU = PU): Promise<void> {
  const r = await autonomousQuery(message, ctx);
  expect(observedTools(r).has(forbidden)).toBe(false);
}

describe('AI 對話馬拉松（對抗／多語／Unicode）', () => {
  beforeEach(() => {
    resetAdaptiveLearnedPatternsForTests();
    setDataSource(mockSource as any);
  });

  jest.setTimeout(400000);

  it('馬拉松 A：TC 延伸讀取工具（錯字、口語、英文碎片）', async () => {
    await expectHit('期中考啥時侯啦我真的會謝 quiz schedule', ['query_exams', 'query_assignments']);
    await expectHit('這課配分佔比到底怎麼蒜…會不會被當啊', ['query_score_items', 'query_grades']);
    await expectHit('tronclass 討論區有沒有新串啊救命', ['query_discussions']);
    await expectHit('老師上船的講義ppt在哪下載啊找不到', ['query_materials']);
    await expectHit('微積分課誰在修啦同學名單給我瞄一眼', ['query_course_members', 'query_courses']);
    await expectHit('作業繳交狀態跟詳請帮我看一下行不行', ['query_homework_detail', 'query_assignments']);
    await expectHit('課堂公告是不是又發新的了我漏看了', ['query_course_announcements']);
  });

  it('馬拉松 B：零寬度 + 全形英數 + mixed zh-CN（須經 analyzeIntents 正規化）', async () => {
    await expectHit('​期​末​考​什​麼​時​候​啊​🆘', ['query_exams', 'query_assignments']);
    await expectHit('ＴｒｏｎＣｌａｓｓ公告有新的嗎', ['query_course_announcements']);
    await expectHit('论坛有没有新帖子啊我慌了', ['query_discussions']);
    await expectHit('讲义课件在哪下载急死了', ['query_materials']);
    await expectHit('帮我查挂号预约记录谢谢', ['query_health_records']);
  });

  it('馬拉松 C：健康「查紀錄 vs 真的掛號」拆開', async () => {
    await expectHit('幫我查預約健康檢查的紀錄好不好', ['query_health_records']);
    await expectNoTool('幫我查預約健康檢查的紀錄好不好', 'create_health_appointment');
    await expectHit('明天牙痛幫我预约挂号好不好啦', ['create_health_appointment']);
    await expectNoTool('明天牙痛幫我预约挂号好不好啦', 'query_health_records');
  });

  it('馬拉松 D：行事曆／訂餐口語邊角（sync、改期、錯字）', async () => {
    await expectHit('幫我把面試加到行事曆明天下午兩點好不好', ['create_calendar_event']);
    await expectHit('改一下行程面試換到晚上七點啦干', ['update_calendar_event', 'query_calendar']);
    await expectHit('刪掉行程面試那個我不去了', ['delete_calendar_event', 'query_calendar']);
    await expectHit('幫我din訂晚餐啦随便啦快', ['create_order', 'query_menus', 'recommend_lunch']);
    await expectHit('把這週行程sync到我的brain裡啦（行事曆）', ['query_calendar', 'daily_briefing']);
  });

  it('馬拉松 E：選單 emoji-only／極短跟進（延續選單上下文）', async () => {
    const menu: AssistantChoiceMenu = {
      title: '請選擇餐點',
      producedByTool: 'create_order',
      options: [
        { id: 'a@@1', label: '素食便當｜A', subtitle: '宜園' },
        { id: 'b@@2', label: '雞腿飯｜B', subtitle: '靜園' },
      ],
    };
    const r1 = await autonomousQuery('👍', { ...PU, lastChoiceMenu: menu }, undefined, []);
    expect(observedTools(r1).has('create_order')).toBe(true);

    const r2 = await autonomousQuery('好啊', { ...PU, lastChoiceMenu: menu }, undefined, []);
    expect(observedTools(r2).has('create_order')).toBe(true);
  });

  it('馬拉松 F：privilege smoke（admin／teacher／vendor）', async () => {
    await expectHit('發布公告「停課」颱風來了全校緊急那種啦', ['create_announcement'], {
      ...PU,
      userId: 'marathon-admin',
      role: 'admin',
    });
    await expectHit('這堂統計課開始點名啦拜託', ['start_attendance'], {
      ...PU,
      userId: 'marathon-teacher',
      role: 'teacher',
    });
    await expectHit('今天有啥活動我就廢不想動腦', ['query_events'], {
      ...PU,
      userId: 'marathon-vendor',
      role: 'vendor',
    });
  });

  it('evaluateSelfDialogResponse：工具命中檢查（薄封裝）', async () => {
    const scenario: AISelfDialogScenario = {
      id: 'eval-demo',
      description: 'demo',
      messages: [{ role: 'user', content: '期中考啥時候啊' }],
      expectAnyTools: ['query_exams'],
    };
    const result = await autonomousQuery('期中考啥時候啊', PU);
    expect(evaluateSelfDialogResponse(scenario, result)).toBe(null);

    const bad: AISelfDialogScenario = {
      id: 'eval-fail',
      description: 'fail',
      messages: [{ role: 'user', content: '嗨' }],
      expectAnyTools: ['query_exams'],
    };
    expect(evaluateSelfDialogResponse(bad, await autonomousQuery('嗨', PU))).not.toBe(null);
  });
});
