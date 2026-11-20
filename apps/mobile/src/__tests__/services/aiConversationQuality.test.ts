/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import {
  autonomousQuery,
  resetAdaptiveLearnedPatternsForTests,
  type AgentQueryResult,
  type ConversationTurn,
} from '../../services/aiLocalAgent';

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
    resetAdaptiveLearnedPatternsForTests();
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

  it('負數訂餐數量只追問，不執行下單', async () => {
    const result = await autonomousQuery('幫我點 -3 份雞腿排', CTX);

    expect(
      result.failedActions.some((a) => a.tool === 'create_order' && /quantity|數量/.test(a.missingInfo)),
    ).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('使用者說吃素但指定葷食時，改提供素食選項而非送單', async () => {
    const result = await autonomousQuery('幫我點雞腿排但我吃素', CTX);
    const text = summaries(result);

    expect(
      result.executedActions.some((a) => a.tool === 'create_order' && a.result.success && a.result.isWrite),
    ).toBe(false);
    expect(text).toContain('吃素');
    expect(text).toContain('素食');
    expect(text).not.toContain('雞腿排但我');
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

  it('查未讀通知即使語氣很急，也不能誤判成點餐', async () => {
    const result = await autonomousQuery('欸你很急先幫我看通知未讀有哪些', CTX);

    expect(result.results.some((r) => r.tool === 'query_notifications')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('還沒動筆的作業只查詢或提醒，不可直接繳交', async () => {
    const result = await autonomousQuery('幹嘛又要交作業了我還沒動筆', CTX);

    expect(result.results.some((r) => r.tool === 'query_assignments')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'submit_assignment')).toBe(false);
  });

  it('猶豫是否退選時不可直接執行退選', async () => {
    const result = await autonomousQuery('其實我也不確定要不要退選', CTX);

    expect(result.results.some((r) => r.tool === 'query_enrollments')).toBe(true);
    expect(result.results.some((r) => r.tool === 'analyze_credits')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'drop_course')).toBe(false);
  });

  it('詢問哪家手搖還開著只查菜單，不直接下單', async () => {
    const result = await autonomousQuery('想喝手搖可是不知道哪家開著', CTX);

    expect(result.results.some((r) => r.tool === 'query_menus')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('明確否定吃飯並要求看成績時，不查菜單也不點餐', async () => {
    const result = await autonomousQuery('我不是要吃飯我是想看成績好嗎', CTX);

    expect(result.results.some((r) => r.tool === 'query_grades')).toBe(true);
    expect(result.results.some((r) => r.tool === 'query_menus')).toBe(false);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('英文 book 圖書館座位要走座位預約，不是借書或點餐', async () => {
    const result = await autonomousQuery('幫我 book 一下圖書館位子啦拜託', CTX);

    expect(result.choiceMenu?.producedByTool).toBe('reserve_library_seat');
    expect(result.intents.some((i) => i.tool === 'borrow_book')).toBe(false);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('詢問列印店位置只給列印指引，不提交列印工作', async () => {
    const result = await autonomousQuery('列印店在學校哪裡啊', CTX);

    expect(result.results.some((r) => r.tool === 'comprehensive_analysis')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_print_job')).toBe(false);
  });

  it('詢問怎麼加選只查課程與已選紀錄，不直接選課', async () => {
    const result = await autonomousQuery('我想多修一門通識要怎麼加選', CTX);

    expect(result.results.some((r) => r.tool === 'query_courses')).toBe(true);
    expect(result.results.some((r) => r.tool === 'query_enrollments')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'enroll_course')).toBe(false);
  });

  it('查健康檢查預約只查健康紀錄，不直接掛號', async () => {
    const result = await autonomousQuery('幫我查預約健康檢查', CTX);

    expect(result.results.some((r) => r.tool === 'query_health_records')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_health_appointment')).toBe(false);
  });

  it('私訊提問若含「已讀不回」仍須送訊，不可當成通知全標已讀', async () => {
    const result = await autonomousQuery(
      '幫我私訊阿銘跟他說錢還你了不要再已讀不回',
      CTX,
    );

    expect(result.intents.some((i) => i.tool === 'send_message')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'mark_notifications_read')).toBe(false);
    expect(result.executedActions.some((a) => a.tool === 'send_message' && a.result.success)).toBe(true);
  });

  it('幫我把所有通知都標為已讀：仍須觸發標已讀', async () => {
    const result = await autonomousQuery('幫我把所有通知都標為已讀', CTX);

    expect(
      result.executedActions.some((a) => a.tool === 'mark_notifications_read' && a.result.success),
    ).toBe(true);
  });

  it('錯字「未毒」後改口未讀通知：須查通知，不可點餐', async () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: '幫我看一下通知' },
      { role: 'assistant', content: '（模擬）這裡是通知摘要…' },
    ];
    const result = await autonomousQuery('我是說「未毒」打錯啦未讀通知', CTX, undefined, history);

    expect(result.results.some((r) => r.tool === 'query_notifications')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('總務口吻：地點後補可完成報修單', async () => {
    const sctx = { ...CTX, role: 'staff' as const };
    const first = await autonomousQuery('走廊燈管一直閃爍幫開修繕通報', sctx);
    expect(
      first.failedActions.some(
        (a) => a.tool === 'create_repair_request' && /room|地點|房號/i.test(a.missingInfo),
      ),
    ).toBe(true);

    const history: ConversationTurn[] = [
      { role: 'user', content: '走廊燈管一直閃爍幫開修繕通報' },
      { role: 'assistant', content: summaries(first) },
    ];
    const second = await autonomousQuery('地點在行政大樓 305', sctx, undefined, history);

    expect(second.executedActions.some((a) => a.tool === 'create_repair_request' && a.result.success)).toBe(true);
    expect(summaries(second)).toMatch(/305|行政/);
  });

  it('業者口吻：外帶塞單狀態應查訂單而非自行瞎下單', async () => {
    const vctx = { ...CTX, role: 'vendor' as const };
    const result = await autonomousQuery('欸櫃台現在還堆多少筆外帶沒出餐啦快暴單', vctx);

    expect(result.results.some((r) => r.tool === 'query_orders')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order' && a.result.isWrite === true)).toBe(false);
  });

  it('訂餐選單未結束但改問成績：須查成績，不可沿用選單下單', async () => {
    const first = await autonomousQuery('幫我訂午餐', CTX);
    expect(first.choiceMenu?.producedByTool).toBe('create_order');

    const second = await autonomousQuery('我不是要吃飯我是想看成績啦 GPA 趕快', {
      ...CTX,
      lastChoiceMenu: first.choiceMenu,
    });

    expect(second.results.some((r) => r.tool === 'query_grades')).toBe(true);
    expect(second.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('訂餐選單仍在時改問校車：須查路線，不可點餐', async () => {
    const first = await autonomousQuery('幫我訂午餐', CTX);
    const second = await autonomousQuery('算了先不管吃的，校門口公車要怎麼搭啦', {
      ...CTX,
      lastChoiceMenu: first.choiceMenu,
    });

    expect(second.results.some((r) => r.tool === 'query_bus')).toBe(true);
    expect(second.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('中英碎片：library 借書還書期限要用館藏／借閱查詢', async () => {
    const result = await autonomousQuery('幫我瞄一下 library 那本 AI 導論啥時要還 due 快到', CTX);

    expect(result.results.some((r) => r.tool === 'query_loans' || r.tool === 'query_library')).toBe(
      true,
    );
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('列印檔案可解析中文份數並清掉口語前綴', async () => {
    const result = await autonomousQuery('幫我印一下期中報告.pdf 黑白兩份', CTX);
    const text = summaries(result);

    expect(result.executedActions.some((a) => a.tool === 'create_print_job' && a.result.success)).toBe(true);
    expect(text).toContain('檔案: 期中報告.pdf');
    expect(text).toContain('份數: 2');
  });

  it('系辦（department）：掃校級公告是否上新，不誤判成發公告', async () => {
    const dctx = { ...CTX, role: 'department' as const };
    const result = await autonomousQuery(
      '系辦這週校級公告有哪些新的啦，轉貼給同學前要掃過一遍',
      dctx,
    );

    expect(result.results.some((r) => r.tool === 'query_announcements')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_announcement')).toBe(false);
  });

  it('系主任（department_head）：口語轉達仍走私訊，不整頁通知全已讀', async () => {
    const hctx = { ...CTX, role: 'department_head' as const };
    const result = await autonomousQuery(
      'ㄟ幫我跟系學會長講：週大會拖到禮拜四晚上七點，記得轉發',
      hctx,
    );

    expect(result.intents.some((i) => i.tool === 'send_message')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'send_message' && a.result.success)).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'mark_notifications_read')).toBe(false);
  });

  it('管理員（admin）：deeplink 口吻問圖書館預約狀態須查館藏／座位，不點餐', async () => {
    const actx = { ...CTX, role: 'admin' as const };
    const result = await autonomousQuery(
      '有人貼 campus://library/seats 這串我不懂欸我到底有沒有預約到自習位子啦',
      actx,
    );

    expect(
      result.results.some((r) => r.tool === 'query_library' || r.tool === 'reserve_library_seat'),
    ).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('攤商（vendor）：台式口語急查出餐壓力應看訂單，不亂補單', async () => {
    const vctx = { ...CTX, role: 'vendor' as const };
    const result = await autonomousQuery(
      '今仔日外帶摞佇遐足煩，順序到底哪幾筆還沒出餐啦',
      vctx,
    );

    expect(result.results.some((r) => r.tool === 'query_orders')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order' && a.result.isWrite === true)).toBe(
      false,
    );
  });

  it('通知轟炸口語：須處理通知（查或全標已讀），不可誤去點餐', async () => {
    const result = await autonomousQuery(
      '靠北喔學校 App 通知一直跳，line 也在叫，Email 也在塞，先未讀列出來不然我會癱',
      CTX,
    );

    expect(
      result.results.some((r) => r.tool === 'query_notifications') ||
        result.executedActions.some((a) => a.tool === 'mark_notifications_read'),
    ).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('報修缺房號失敗後改口要看成績：須查成績，不可繼續硬送報修', async () => {
    const first = await autonomousQuery('宿舍浴室排水超慢幫我報修', CTX);
    expect(
      first.failedActions.some((a) => a.tool === 'create_repair_request'),
    ).toBe(true);

    const history: ConversationTurn[] = [
      { role: 'user', content: '宿舍浴室排水超慢幫我報修' },
      { role: 'assistant', content: summaries(first) },
    ];
    const second = await autonomousQuery('算了我沒空等你們派员啦，先講我微積分期末幾分', CTX, undefined, history);

    expect(second.results.some((r) => r.tool === 'query_grades')).toBe(true);
    expect(second.executedActions.some((a) => a.tool === 'create_repair_request' && a.result.success)).toBe(
      false,
    );
  });

  it('台味口語勒／好兇：急查未讀通知，不可當每日簡報', async () => {
    const result = await autonomousQuery('好兇喔通知跳不停勒，未讀到底有啥好康還是廢文啦', CTX);

    expect(result.results.some((r) => r.tool === 'query_notifications')).toBe(true);
    expect(result.intents.some((i) => i.tool === 'daily_briefing')).toBe(false);
  });

  it('校方角色（school）：掃視本週全校公告須查詢，不可直接發公告', async () => {
    const sctx = { ...CTX, role: 'school' as const };
    const result = await autonomousQuery(
      '校務這邊要先掃一遍本週全校公告有沒有遺漏，分發給各處室前先確認重點',
      sctx,
    );

    expect(result.results.some((r) => r.tool === 'query_announcements')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_announcement')).toBe(false);
  });

  it('家長口吻：關心孩子今日是否仍有課，須查課程而非點餐', async () => {
    const result = await autonomousQuery(
      '老師您好我是家長想確認我家小孩今天學校還有課嗎會不會白跑一趟',
      CTX,
    );

    expect(result.results.some((r) => r.tool === 'query_courses')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('OCR 黏貼碎片：課號與時間斷行仍可辨識為查課程／地點', async () => {
    const result = await autonomousQuery(
      '（教務截圖直接貼上）\nCS301\n星期\n三\n14:00-16:00\n教室:R204??\n\n幫我看這堂固定在哪上課',
      CTX,
    );

    expect(
      result.results.some((r) => r.tool === 'query_courses' || r.tool === 'comprehensive_analysis'),
    ).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('大量 emoji 包裝：仍辨識為查作業待辦而非點餐', async () => {
    const result = await autonomousQuery(
      '🥺📚⏰💀 deadline 地獄啦…幫我把還沒交的作業通通列出來好不好',
      CTX,
    );

    expect(result.results.some((r) => r.tool === 'query_assignments')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('訂餐選單已出後說先不要：不可沿用選單送出寫入訂單', async () => {
    const first = await autonomousQuery('幫我訂午餐', CTX);
    expect(first.choiceMenu?.producedByTool).toBe('create_order');

    const second = await autonomousQuery('先不要好了', { ...CTX, lastChoiceMenu: first.choiceMenu });
    expect(second.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('選單後「先不用」含零寬字仍視為放棄跟進，不執行訂餐寫入', async () => {
    const first = await autonomousQuery('幫我訂午餐', CTX);
    const second = await autonomousQuery('先不用\u200c啦', { ...CTX, lastChoiceMenu: first.choiceMenu });
    expect(second.executedActions.some((a) => a.tool === 'create_order')).toBe(false);
  });

  it('上一輪誤說退選後改口加選：須走向加選而非執行退選', async () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: '我要退選資料結構啦干' },
      { role: 'assistant', content: '（模擬）確認要退選資料結構嗎？' },
    ];
    const result = await autonomousQuery('打錯啦我是要加選資料結構不是退選', CTX, undefined, history);

    expect(result.intents.some((i) => i.tool === 'enroll_course')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'drop_course')).toBe(false);
  });

  it('請假語境後追問「哪個教室」：須查課程／教室資訊，不另送請假', async () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: '我明天想請病假頭好痛' },
      {
        role: 'assistant',
        content:
          '假別：病假\n您明天有以下課程：\n1. 資料結構 (10:00-12:00)\n2. 離散數學 (14:00-16:00)\n\n你要請哪一堂？',
      },
    ];
    const result = await autonomousQuery('欸等等資料結構到底在哪個教室我先記一下', CTX, undefined, history);

    expect(result.results.some((r) => r.tool === 'query_courses')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'request_leave')).toBe(false);
  });

  it('Firebase／離線同步口語：仍須查未讀通知', async () => {
    const result = await autonomousQuery(
      'Firestore 一直說 client is offline 同步不到啦，先幫我把未讀通知列出來行不行',
      CTX,
    );

    expect(result.results.some((r) => r.tool === 'query_notifications')).toBe(true);
  });

  it('同步卡住口語但主旨是成績：須查成績而非僅抱怨連線', async () => {
    const result = await autonomousQuery(
      'App 顯示資料同步失敗判定 offline，但我只想先確認我上學期線代幾分',
      CTX,
    );

    expect(result.results.some((r) => r.tool === 'query_grades')).toBe(true);
  });
});
