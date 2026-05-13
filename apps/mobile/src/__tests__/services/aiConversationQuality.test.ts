/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import { autonomousQuery, type AgentQueryResult, type ConversationTurn } from '../../services/aiLocalAgent';

const CTX = {
  userId: 'quality-user-1',
  schoolId: 'pu',
  role: 'student' as const,
  isOnline: true,
};

function summaries(result: AgentQueryResult): string {
  return [
    ...result.results.map((r) => r.result.summary ?? ''),
    ...result.executedActions.map((a) => a.result.summary ?? ''),
    ...result.failedActions.map((a) => `${a.reason}: ${a.missingInfo}`),
  ].join('\n');
}

describe('AI 對話品質回歸', () => {
  beforeEach(() => {
    setDataSource(mockSource as any);
  });

  it('病假不能被誤送成事假', async () => {
    const result = await autonomousQuery('幫我請病假', CTX);

    expect(result.intents[0]).toMatchObject({
      tool: 'request_leave',
      args: { leaveType: 'sick', reason: '身體不適' },
    });
    expect(summaries(result)).toContain('假別：病假');
  });

  it('座位選單接續預約保留可用日期與時間，不出現 undefined', async () => {
    const first = await autonomousQuery('我想預約自習座位', CTX);
    expect(first.choiceMenu?.producedByTool).toBe('reserve_library_seat');

    const second = await autonomousQuery('第一個就好', { ...CTX, lastChoiceMenu: first.choiceMenu });
    const text = summaries(second);

    expect(second.executedActions.some((a) => a.tool === 'reserve_library_seat' && a.result.success)).toBe(true);
    expect(text).toContain('09:00-12:00');
    expect(text).not.toContain('undefined');
  });

  it('借書選單可接續處理「隨便借一本相關的」', async () => {
    const first = await autonomousQuery('幫我借《人工智慧》這本書', CTX);
    expect(first.choiceMenu?.producedByTool).toBe('borrow_book');

    const second = await autonomousQuery('隨便借一本相關的', { ...CTX, lastChoiceMenu: first.choiceMenu });

    expect(second.executedActions.some((a) => a.tool === 'borrow_book' && a.result.success)).toBe(true);
    expect(second.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('詢問包裹是否被領取只查詢，不確認領取', async () => {
    const result = await autonomousQuery('有人領我的包裹嗎', CTX);

    expect(result.results.some((r) => r.tool === 'query_dorm_info')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'confirm_package_pickup')).toBe(false);
  });

  it('報修缺房號時先追問，下一輪房號可補齊送出', async () => {
    const first = await autonomousQuery('宿舍冷氣壞掉了幫我報修', CTX);
    expect(first.failedActions.some((a) => a.tool === 'create_repair_request' && a.missingInfo.includes('room'))).toBe(true);

    const history: ConversationTurn[] = [
      { role: 'user', content: '宿舍冷氣壞掉了幫我報修' },
      { role: 'assistant', content: summaries(first) },
    ];
    const second = await autonomousQuery('在 B302', CTX, undefined, history);

    expect(second.executedActions.some((a) => a.tool === 'create_repair_request' && a.result.success)).toBe(true);
    expect(summaries(second)).toContain('B302');
  });

  it('通知同學要發訊息，不要誤判成每日簡報', async () => {
    const result = await autonomousQuery('通知小敏明天的會議改到 10 點', CTX);

    expect(result.intents[0]).toMatchObject({
      tool: 'send_message',
      args: { peerId: '小敏', content: '明天的會議改到 10 點' },
    });
    expect(result.executedActions.some((a) => a.tool === 'send_message' && a.result.success)).toBe(true);
    expect(result.intents.some((i) => i.tool === 'daily_briefing')).toBe(false);
  });

  it('幫我訂午餐：推薦／待選（isWrite:false）須保留選單，才可接「第一個」送單', async () => {
    const first = await autonomousQuery('幫我訂午餐', CTX);
    expect(first.choiceMenu?.producedByTool).toBe('create_order');
    expect((first.choiceMenu?.options?.length ?? 0)).toBeGreaterThan(0);

    const browseOnly = first.executedActions.some(
      (a) => a.tool === 'create_order' && a.result.success && a.result.isWrite === false,
    );
    expect(browseOnly).toBe(true);

    const second = await autonomousQuery('第一個', { ...CTX, lastChoiceMenu: first.choiceMenu });
    expect(second.executedActions.some((a) => a.tool === 'create_order' && a.result.isWrite === true)).toBe(
      true,
    );
  });

  it('使用者說已經簽到時不重複簽到', async () => {
    const result = await autonomousQuery('我已經簽到了', CTX);

    expect(result.results.some((r) => r.tool === 'query_attendance')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'check_in_attendance')).toBe(false);
  });

  it('能力詢問回到助理說明，不誤判成簡報', async () => {
    const result = await autonomousQuery('你會什麼', CTX);

    expect(result.results.some((r) => r.tool === 'assistant_help')).toBe(true);
    expect(summaries(result)).toContain('校園 App');
    expect(result.intents.some((i) => i.tool === 'daily_briefing')).toBe(false);
  });
});
