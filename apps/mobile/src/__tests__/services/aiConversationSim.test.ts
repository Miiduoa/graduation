/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI 對話模擬器 — 口語、模糊、跨功能壓測（Node / Jest，不需開模擬器）。
 *
 * 跑法：
 *   cd apps/mobile && npx jest src/__tests__/services/aiConversationSim.test.ts --runInBand
 *
 *   AI_SIM_VERBOSE=1  → 印 intents
 */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { expect } from '@jest/globals';
import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import type { AssistantChoiceMenu } from '../../services/aiToolRegistry';
import { autonomousQuery, resetAdaptiveLearnedPatternsForTests } from '../../services/aiLocalAgent';
import { getToolDeclarations } from '../../services/aiAgentTools';
import type { CampusActorRole } from '../../data/types';

beforeEach(() => {
  resetAdaptiveLearnedPatternsForTests();
});

/** getToolDeclarations：student/vendor/department/department_head/school 僅共通工具；teacher、admin、staff 另含教學區塊（start_attendance、create_assignment、grade_submission、create_announcement）。 */
function toolNamesForRole(role: CampusActorRole): Set<string> {
  return new Set(getToolDeclarations(role).map((d) => d.name));
}

function pickTools(role: CampusActorRole, names: readonly string[]): string[] {
  const ok = toolNamesForRole(role);
  const bad = names.filter((n) => !ok.has(n));
  if (bad.length > 0) {
    throw new Error(`pickTools(${role}) 含未宣告工具: ${bad.join(', ')}`);
  }
  return [...names];
}

const VERBOSE = process.env.AI_SIM_VERBOSE === '1';
const TEST_USER_ID = 'sim-user-1';
const TEST_SCHOOL_ID = 'pu';

type Turn = {
  user: string;
  /** 軟檢查：只 console.warn */
  expect?: string[] | RegExp;
  /** 硬檢查：至少一個 intent / read / write 必須是下列之一 */
  anyOfTools?: string[];
  /** 若 true：不允許完全沒有意圖（問候類除外時不要設） */
  mustReact?: boolean;
};

function collectToolsCalled(r: any): Set<string> {
  const s = new Set<string>();
  for (const i of r.intents ?? []) s.add(i.tool);
  for (const e of r.executedActions ?? []) s.add(e.tool);
  for (const x of r.results ?? []) s.add(x.tool);
  return s;
}

function sectionHeader(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log('▶ ' + title);
  console.log('═'.repeat(60));
}

function fmtResult(r: any): string {
  const lines: string[] = [];
  const exec = r.executedActions ?? [];
  const failed = r.failedActions ?? [];
  const intents = r.intents ?? [];
  const ctx = String(r.contextText ?? '').trim();

  const readIntents = intents.filter((i: any) => !i.isWrite);
  for (const ri of readIntents) {
    lines.push(`📖 ${ri.tool}: ${ri.reason}`);
  }

  for (const e of exec) {
    const ok = e.result?.success ? '✅' : '💡';
    const summary = String(e.result?.summary ?? '').split('\n').slice(0, 6).join('\n');
    lines.push(`${ok} ${e.tool}: ${summary}`);
    if (e.result?.choiceMenu?.options?.length) {
      lines.push('   選單:');
      e.result.choiceMenu.options.slice(0, 3).forEach((o: any, i: number) => {
        lines.push(`   ${i + 1}. ${o.label}${o.subtitle ? ' / ' + o.subtitle : ''}`);
      });
    }
  }
  for (const f of failed) {
    lines.push(`❌ ${f.tool}: ${f.reason} (${f.missingInfo})`);
  }
  if (r.choiceMenu?.options?.length && exec.length === 0) {
    lines.push('   ChoiceMenu:');
    r.choiceMenu.options.slice(0, 3).forEach((o: any, i: number) => {
      lines.push(`   ${i + 1}. ${o.label}`);
    });
  }
  if (lines.length === 0) {
    if (ctx) return `[CTX] ${ctx.split('\n').slice(0, 3).join(' | ')}`;
    return '[NO TOOL CALL]';
  }
  return lines.join('\n');
}

function pickLatestChoiceMenu(result: any): AssistantChoiceMenu | undefined {
  for (const e of result.executedActions ?? []) {
    if (e.result?.choiceMenu?.options?.length) return e.result.choiceMenu;
  }
  if (result.choiceMenu?.options?.length) return result.choiceMenu;
  return undefined;
}

/** 測試用：模擬上一輪助理提供的訂餐選單 */
function diningOrderMenuFixture(): AssistantChoiceMenu {
  return {
    title: '請選擇餐點',
    producedByTool: 'create_order',
    options: [
      { id: 'x@@1', label: '滷肉飯｜A', subtitle: '靜園' },
      { id: 'y@@1', label: '雞腿飯｜B', subtitle: '宜園' },
      { id: 'z@@1', label: '素飯｜C', subtitle: '凱園' },
    ],
  };
}

function eventRegisterMenuFixture(): AssistantChoiceMenu {
  return {
    title: '請選擇活動',
    producedByTool: 'register_event',
    options: [
      { id: 'evt-a', label: 'AI 工作坊', sendAsUser: '幫我報名第1個' },
      { id: 'evt-b', label: '校慶園遊', sendAsUser: '幫我報名第2個' },
    ],
  };
}

async function assertToolsWithChoiceMenu(
  message: string,
  menu: AssistantChoiceMenu,
  anyOfTools: string[],
): Promise<void> {
  const r = await autonomousQuery(
    message,
    {
      userId: TEST_USER_ID,
      schoolId: TEST_SCHOOL_ID,
      role: 'student',
      lastChoiceMenu: menu,
      isOnline: true,
    },
    undefined,
    [],
  );
  const tools = collectToolsCalled(r);
  expect(anyOfTools.some((t) => tools.has(t))).toBe(true);
}

type RunConversationOpts = { role?: CampusActorRole };

async function runConversation(name: string, turns: Turn[], opts?: RunConversationOpts) {
  const actorRole = opts?.role ?? 'student';
  sectionHeader(opts?.role != null ? `${name}（角色：${actorRole}）` : name);
  let lastChoiceMenu: AssistantChoiceMenu | undefined;
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const results: Array<{ user: string; result: any }> = [];

  for (let i = 0; i < turns.length; i++) {
    const { user, expect: expected, anyOfTools, mustReact } = turns[i];
    console.log(`\n  👤 Turn ${i + 1}: "${user}"`);
    if (lastChoiceMenu) {
      console.log(`     (carry choiceMenu w/ ${lastChoiceMenu.options.length} opts)`);
    }
    const result = await autonomousQuery(
      user,
      {
        userId: TEST_USER_ID,
        schoolId: TEST_SCHOOL_ID,
        role: actorRole,
        lastChoiceMenu,
        isOnline: true,
      },
      undefined,
      conversationHistory,
    );

    const text = fmtResult(result);
    console.log('  🤖 ' + text.split('\n').join('\n     '));

    if (VERBOSE) {
      console.log(
        '     [intents]',
        (result.intents ?? []).map((x: any) => `${x.tool}(${JSON.stringify(x.args)})`).join('; '),
      );
    }

    const tools = collectToolsCalled(result);
    if (anyOfTools?.length) {
      const hit = anyOfTools.some((t) => tools.has(t));
      expect(hit).toBe(true);
    }
    if (mustReact) {
      expect(tools.size).toBeGreaterThan(0);
    }

    if (expected) {
      const combined =
        (result.executedActions ?? []).map((e: any) => String(e.result?.summary ?? '')).join('\n') +
        '\n' +
        (result.failedActions ?? []).map((f: any) => f.reason + f.missingInfo).join('\n');
      if (Array.isArray(expected)) {
        for (const term of expected) {
          if (!combined.includes(term)) {
            console.log(`     ⚠️  期望包含 "${term}" 但沒看到`);
          }
        }
      } else if (expected instanceof RegExp) {
        if (!expected.test(combined)) {
          console.log(`     ⚠️  期望符合 ${expected} 但沒看到`);
        }
      }
    }

    conversationHistory.push({ role: 'user', content: user });
    const asstReply =
      (result.executedActions ?? [])
        .map((e: any) => String(e.result?.summary ?? ''))
        .filter(Boolean)
        .join('\n') ||
      (result.failedActions ?? []).map((f: any) => `${f.reason}: ${f.missingInfo}`).join('\n') ||
      (result.results ?? [])
        .map((x: any) => String(x.result?.summary ?? ''))
        .filter(Boolean)
        .join('\n') ||
      '(未呼叫工具)';
    conversationHistory.push({ role: 'assistant', content: asstReply });

    const next = pickLatestChoiceMenu(result);
    if (next) lastChoiceMenu = next;
    results.push({ user, result });
  }

  return results;
}

describe('AI 口語／模糊／跨功能 對話壓測', () => {
  beforeAll(() => {
    setDataSource(mockSource as any);
  });

  jest.setTimeout(400000);

  it('baseline：原 7 場回歸', async () => {
    await runConversation('Scenario 1 — 訂餐', [
      { user: '幫我訂午餐', anyOfTools: ['create_order'] },
      { user: '隨便幫我點', anyOfTools: ['create_order'] },
      { user: '我想吃點清淡的', anyOfTools: ['create_order'] },
      { user: '幫我點第一個', anyOfTools: ['create_order'] },
      { user: '不是炸的，要素的', anyOfTools: ['create_order'] },
      { user: '幫我點滷肉飯', anyOfTools: ['create_order'] },
      { user: '查看我的訂單', anyOfTools: ['query_orders'] },
      { user: '取消最後一筆訂單', anyOfTools: ['cancel_order'] },
    ]);

    await runConversation('Scenario 2 — 請假/簽到', [
      { user: '我明天頭痛要請假', anyOfTools: ['request_leave'] },
      { user: '幫我請病假', anyOfTools: ['request_leave'] },
      { user: '我要幫今天的微積分課簽到', anyOfTools: ['check_in_attendance', 'query_courses'] },
      { user: '我已經簽到了', anyOfTools: ['check_in_attendance', 'query_attendance'] },
    ]);

    await runConversation('Scenario 3 — 圖書館', [
      { user: '我想預約自習座位', anyOfTools: ['reserve_library_seat', 'query_library'] },
      { user: '第一個就好', anyOfTools: ['reserve_library_seat'] },
      { user: '幫我借《人工智慧》這本書', anyOfTools: ['borrow_book'] },
      { user: '隨便借一本相關的', anyOfTools: ['borrow_book'] },
    ]);

    await runConversation('Scenario 4 — 宿舍', [
      { user: '宿舍冷氣壞掉了幫我報修', anyOfTools: ['create_repair_request'] },
      { user: '在 B302' },
      { user: '我要預約洗衣機', anyOfTools: ['reserve_washing_machine'] },
      { user: '有人領我的包裹嗎', anyOfTools: ['query_dorm_info'] },
    ]);

    await runConversation('Scenario 5 — 模糊', [
      { user: '我好餓', anyOfTools: ['recommend_lunch'] },
      { user: '今天吃什麼好', anyOfTools: ['query_menus'] },
      { user: '便宜一點的', anyOfTools: ['create_order'] },
      { user: '對對對就那個', anyOfTools: ['create_order'] },
    ]);

    await runConversation('Scenario 6 — 複合', [
      { user: '我明天忙嗎', anyOfTools: ['daily_briefing'] },
      { user: '趕快幫我把未讀通知看一下啦', anyOfTools: ['query_notifications'] },
      { user: '幫我把所有通知都標為已讀', anyOfTools: ['mark_notifications_read'] },
      { user: '通知小敏明天的會議改到 10 點', anyOfTools: ['send_message'] },
      { user: '今天我有什麼活動', anyOfTools: ['query_events'] },
    ]);

    await runConversation('Scenario 7 — 邊界', [
      { user: '嗨' },
      { user: '你會啥', anyOfTools: ['assistant_help'] },
      { user: 'asdfghjkl' },
      { user: '😊' },
      { user: '我要點 ZZZ 一份', anyOfTools: ['create_order'] },
      { user: '是雞腿飯啦', anyOfTools: ['create_order'] },
    ]);
  });

  it('口語訂餐與情緒化說法', async () => {
    await runConversation('口語訂餐', [
      { user: '幹我好餓喔有沒有東西吃', anyOfTools: ['recommend_lunch'] },
      { user: '肚餓扁了啦快救我', anyOfTools: ['recommend_lunch'] },
      { user: '欸幫我搞個晚餐好不好懒得想', anyOfTools: ['create_order', 'recommend_lunch'] },
      { user: '不要辣不要油這種啦你懂', anyOfTools: ['create_order'] },
      { user: '隨便啦你決定快一點', anyOfTools: ['create_order'] },
      { user: '那…最後一個好了', anyOfTools: ['create_order'] },
    ]);
  });

  it('課業／成績／作業 模糊問法', async () => {
    await runConversation('課業', [
      { user: '欸我今天到底有什麼課啊超混亂', anyOfTools: ['query_courses'] },
      { user: '下禮拜會不會很忙', anyOfTools: ['daily_briefing', 'query_courses', 'comprehensive_analysis'] },
      { user: '我作業是不是快爆了', anyOfTools: ['query_assignments'] },
      { user: '成績爛不爛啊', anyOfTools: ['query_grades', 'predict_gpa'] },
      { user: '還差多少學分才能畢業', anyOfTools: ['analyze_credits'] },
    ]);
  });

  it('交通／公告／行事曆', async () => {
    await runConversation('校園資訊', [
      { user: '校車怎麼搭啊我完全沒概念', anyOfTools: ['query_bus'] },
      { user: '學校最近有發什麼公告', anyOfTools: ['query_announcements'] },
      { user: '我這週行程表長怎樣', anyOfTools: ['query_calendar', 'daily_briefing'] },
      { user: '今天下午有空嗎…大概', anyOfTools: ['query_calendar', 'query_courses', 'daily_briefing'] },
    ]);
  });

  it('訊息／通知 口語', async () => {
    await runConversation('訊息通知', [
      { user: '幫我看一下有沒有通知', anyOfTools: ['query_notifications'] },
      { user: '私訊誰找過我', anyOfTools: ['query_conversations'] },
      { user: '我聊天列表亂掉了啦', anyOfTools: ['query_conversations'] },
    ]);
  });

  it('健康／失物／列印／綜合', async () => {
    await runConversation('健康失物列印', [
      { user: '身體不太舒服想掛個號', anyOfTools: ['query_health_records', 'create_health_appointment'] },
      { user: '幫我預約健康檢查', anyOfTools: ['create_health_appointment', 'query_health_records'] },
      { user: '我錢包不見了哭啊', anyOfTools: ['create_lost_found'] },
      { user: '撿到一隻 AirPods', anyOfTools: ['create_lost_found'] },
      { user: '幫我印一下期中報告.pdf 黑白兩份', anyOfTools: ['create_print_job'] },
      { user: '我現在整個人狀態超糟你大概查一下', anyOfTools: ['comprehensive_analysis', 'daily_briefing', 'query_courses'] },
    ]);
  });

  it('活動／報名口語', async () => {
    await runConversation('活動', [
      { user: '最近有沒有什麼好玩的活動啊', anyOfTools: ['query_events'] },
      { user: '第一個我想去', anyOfTools: ['register_event'] },
      { user: '算了我還是不去了', anyOfTools: ['unregister_event', 'query_events', 'register_event'] },
    ]);
  });

  it('超模糊廢話仍要接球（至少回工具或分析）', async () => {
    await runConversation('模糊', [
      { user: '欸欸欸我忘記今天要幹嘛了', anyOfTools: ['daily_briefing', 'query_courses', 'query_calendar'] },
      { user: '你就…隨便幫我處理一下可以嗎', anyOfTools: ['daily_briefing', 'comprehensive_analysis', 'query_notifications'] },
      { user: '我是誰我在哪我在幹嘛', anyOfTools: ['query_student_info', 'daily_briefing', 'comprehensive_analysis'] },
      { user: '今天會不會被當', anyOfTools: ['predict_gpa', 'query_grades'] },
    ]);
  });

  it('口語大雜燴（情緒＋多意圖＋半截句）', async () => {
    await runConversation('大雜燴', [
      {
        user: '煩死了啦肚子又餓又有通知未讀到底要先幹嘛',
        anyOfTools: ['query_notifications', 'recommend_lunch', 'daily_briefing', 'comprehensive_analysis', 'query_menus'],
      },
      { user: '算了先隨便來點能吃的啦不要想', anyOfTools: ['create_order', 'recommend_lunch', 'query_menus'] },
      { user: '欸我剛剛是不是已經簽到啦還是沒', anyOfTools: ['query_attendance', 'check_in_attendance'] },
      { user: '那個行政大樓旁邊公車站到底在哪我路痴', anyOfTools: ['query_bus'] },
      { user: '我覺得我完蛋了課業壓力好大', anyOfTools: ['query_assignments', 'comprehensive_analysis', 'daily_briefing'] },
    ]);
  });

  it('中英夾雜、英文片語與拼音碎唸', async () => {
    await runConversation('中英夾雜', [
      { user: '欸 today 我到底有什麼課啦干', anyOfTools: ['query_courses'] },
      { user: '幫我看一下有沒有 unread notification 好嗎', anyOfTools: ['query_notifications'] },
      { user: '校門口附近有 bus 嗎還是都要走过去', anyOfTools: ['query_bus'] },
      { user: '幫我 book 一下圖書館位子啦拜託', anyOfTools: ['reserve_library_seat', 'query_library'] },
      { user: 'this week 的 schedule 幫我瞄一眼', anyOfTools: ['query_calendar', 'daily_briefing'] },
      { user: 'I lost my wallet 在圖書館附近…', anyOfTools: ['create_lost_found'] },
      { user: 'gg 了期末 draft 到底要交沒', anyOfTools: ['query_assignments'] },
    ]);
  });

  it('錯字口誤與懶打鍵盤', async () => {
    await runConversation('錯字', [
      { user: '完蛋我要簽倒啦遲到爆', anyOfTools: ['check_in_attendance', 'query_attendance'] },
      { user: '請假單還沒過欸想查一下', anyOfTools: ['query_attendance'] },
      { user: 'hhh我忘記今天要幹嘛了救命', anyOfTools: ['daily_briefing', 'query_courses', 'query_calendar', 'comprehensive_analysis'] },
      { user: '成績在哪看啊🥺期末已經來了', anyOfTools: ['query_grades'] },
    ]);
  });

  it('反向澄清、拖台詞與碎唸起句', async () => {
    await runConversation('反向碎唸', [
      { user: '我不是要吃飯我是想看成績好嗎', anyOfTools: ['query_grades', 'query_menus', 'comprehensive_analysis'] },
      { user: '就是…呃…公告啦學校有沒有發新的', anyOfTools: ['query_announcements'] },
      { user: '算了睡不著先掛個號好了', anyOfTools: ['create_health_appointment', 'query_health_records'] },
    ]);
  });

  it('社交口語（密我／已讀）', async () => {
    await runConversation('社交嘴砲', [
      { user: '靠邀誰剛剛一直密我啦很煩欸', anyOfTools: ['query_conversations'] },
      { user: '已讀不回是不是欠揍啦開玩笑的', anyOfTools: ['query_conversations', 'query_notifications'] },
    ]);
  });

  it('選單短跟進矩陣（口語確認、序號、活動取消）', async () => {
    const dine = diningOrderMenuFixture();
    await assertToolsWithChoiceMenu('第二個', dine, ['create_order']);
    await assertToolsWithChoiceMenu('第2個', dine, ['create_order']);
    await assertToolsWithChoiceMenu('最後一個', dine, ['create_order']);
    await assertToolsWithChoiceMenu('好', dine, ['create_order']);
    await assertToolsWithChoiceMenu('ok', dine, ['create_order']);
    await assertToolsWithChoiceMenu('要這個', dine, ['create_order']);
    await assertToolsWithChoiceMenu('欸那就第一個吧', dine, ['create_order']);
    const ev = eventRegisterMenuFixture();
    await assertToolsWithChoiceMenu('第二個', ev, ['register_event']);
    await assertToolsWithChoiceMenu('算了我還是不去了', ev, ['unregister_event', 'query_events']);
  });

  it('密集口語場景 ① 飲食／時段課表／宿舍／列印', async () => {
    await runConversation('場景①', [
      { user: '宵夜到底要吃啥啊選擇困難', anyOfTools: ['query_menus', 'recommend_lunch'] },
      { user: '想喝手搖可是不知道哪家開著', anyOfTools: ['query_menus'] },
      { user: '待會有課嗎我還想睡', anyOfTools: ['query_courses'] },
      { user: '等一下要上啥啦', anyOfTools: ['query_courses'] },
      { user: '包裹到了沒啊前天說出貨', anyOfTools: ['query_dorm_info'] },
      { user: '洗衣機現在有空嗎', anyOfTools: ['query_dorm_info'] },
      { user: '列印店在學校哪裡啊', anyOfTools: ['comprehensive_analysis'] },
    ]);
  });

  it('密集口語場景 ② 成績學分／活動／公告天氣／總覽', async () => {
    await runConversation('場景②', [
      { user: '超怕二一啦你幫我看下成績趨勢', anyOfTools: ['predict_gpa', 'query_grades'] },
      { user: '學分到底還差多少我真的會癱', anyOfTools: ['analyze_credits'] },
      { user: '校慶有啥活動不無聊的那種', anyOfTools: ['query_events'] },
      { user: '我現在心很累需要一鍵總覽', anyOfTools: ['comprehensive_analysis', 'daily_briefing'] },
      { user: '雨大到會不會停課啊干', anyOfTools: ['query_announcements', 'query_calendar', 'comprehensive_analysis'] },
    ]);
  });

  it('密集口語場景 ③ 抱怨式提問與懶人句', async () => {
    await runConversation('場景③', [
      { user: '幹嘛又要交作業了我還沒動筆', anyOfTools: ['query_assignments'] },
      { user: '到底哪堂課最會點名啦靠', anyOfTools: ['query_courses', 'query_attendance'] },
      { user: 'wifi 爛到爆宿舍能不能修', anyOfTools: ['create_repair_request', 'query_dorm_info'] },
      { user: '借的書過期了會罰多少', anyOfTools: ['query_loans', 'query_library'] },
      { user: 'deadline 是明天還是後天我忘了', anyOfTools: ['query_assignments', 'query_calendar'] },
    ]);
  });

  it('密集口語場景 ④ 更像真人的猶豫與改口', async () => {
    await runConversation('場景④', [
      { user: '其實我也不確定要不要退選', anyOfTools: ['drop_course', 'query_enrollments', 'query_courses', 'comprehensive_analysis'] },
      { user: '算了還是先看我口袋還有多少錢', anyOfTools: ['query_orders', 'comprehensive_analysis'] },
      { user: '要不然你直接給我今日懶人包', anyOfTools: ['daily_briefing', 'comprehensive_analysis'] },
    ]);
  });

  it('訂餐選單後只回「第一個」：必須帶 lastChoiceMenu（重現真機 bug）', async () => {
    const menu: AssistantChoiceMenu = {
      title: '請選擇餐點',
      producedByTool: 'create_order',
      options: [
        { id: 'm1@@v1', label: 'Morning House | 蛋餅', subtitle: '靜園餐廳', sendAsUser: '幫我點第1個' },
        { id: 'm2@@v2', label: '永和豆漿 | 蛋餅', subtitle: '宜園餐廳', sendAsUser: '幫我點第2個' },
      ],
    };
    await assertToolsWithChoiceMenu('第一個', menu, ['create_order']);
  });

  it('密集口語場景 ⑤ 長句夾雜多意圖', async () => {
    await runConversation('場景⑤', [
      {
        user: '我人卡在圖書館晚點還有課可是肚子狂叫該先幹嘛',
        anyOfTools: ['query_courses', 'recommend_lunch', 'query_library', 'query_menus', 'comprehensive_analysis'],
      },
      { user: '不管了先說颱風有沒有放假好了', anyOfTools: ['query_announcements', 'comprehensive_analysis'] },
      { user: '欸你很急先幫我看通知未讀有哪些', anyOfTools: ['query_notifications'] },
    ]);
  });

  it('密集口語場景 ⑥ 選課／教室／文具式說法', async () => {
    await runConversation('場景⑥', [
      { user: '我想多修一門通識要怎麼加選', anyOfTools: ['enroll_course', 'query_courses', 'query_enrollments'] },
      { user: '教室在牛頓大樓到底是幾樓啊', anyOfTools: ['query_courses', 'query_calendar', 'comprehensive_analysis'] },
      { user: '影印多少張以內免費這種規定在哪看', anyOfTools: ['comprehensive_analysis', 'query_announcements'] },
    ]);
  });

  it('圖書館選單短跟進（隨便／第一個）', async () => {
    const bookMenu: AssistantChoiceMenu = {
      title: '借書',
      producedByTool: 'borrow_book',
      options: [
        { id: 'bk1', label: '人工智慧導論', subtitle: '可借' },
        { id: 'bk2', label: '深度學習', subtitle: '可借' },
      ],
    };
    await assertToolsWithChoiceMenu('隨便', bookMenu, ['borrow_book']);
    await assertToolsWithChoiceMenu('第一個', bookMenu, ['borrow_book']);
  });

  it('全工具補齊①：圖書館續借／還書／取消座位', async () => {
    await runConversation('圖書館進階', [
      { user: '幫我續借人工智慧那本', anyOfTools: ['renew_book', 'query_loans'] },
      { user: '還書要把程式設計那本歸還', anyOfTools: ['return_book', 'query_loans'] },
      { user: '算了圖書館自習座位預約我要取消', anyOfTools: ['cancel_seat_reservation', 'query_library'] },
    ]);
  });

  it('全工具補齊②：包裹領取、餐點評分、加社群、發文、繳交、行事曆', async () => {
    await runConversation('生活寫入大補帖', [
      { user: '我去宿舍領包裹了確認取件', anyOfTools: ['confirm_package_pickup', 'query_dorm_info'] },
      { user: '便當雞腿飯超讚給五顆星啦', anyOfTools: ['rate_menu_item', 'query_menus'] },
      { user: '加入讀書會群組 cs-read-99', anyOfTools: ['join_group'] },
      { user: '小組發文問大家期末要不要一起念', anyOfTools: ['create_group_post'] },
      {
        user: '報告作業我都寫完了幫我繳交一下',
        anyOfTools: ['submit_assignment', 'query_assignments'],
      },
      {
        user: '幫我加讀書會行程進明天下午三點行事曆',
        anyOfTools: ['create_calendar_event'],
      },
      {
        user: '刪除行程期中考複習那個我不需要了',
        anyOfTools: ['delete_calendar_event', 'query_calendar'],
      },
      {
        user: '修改行程讀書會改到晚上七點好不好',
        anyOfTools: ['update_calendar_event', 'query_calendar'],
      },
    ]);
  });

  it('全工具補齊③：教師／教學場（點名、出作業、批改、公告）', async () => {
    await runConversation(
      '教學端',
      [
        { user: '這堂微積分課開始點名吧', anyOfTools: ['start_attendance', 'query_courses'] },
        { user: '幫我出作業「期末專題提案」截止下週', anyOfTools: ['create_assignment', 'query_courses'] },
        {
          user: '批改作業幫學生小明的繳交打88分寫得不錯',
          anyOfTools: ['grade_submission'],
        },
        {
          user: '發布公告停課因為颱風來了緊急通知',
          anyOfTools: ['create_announcement'],
        },
      ],
      { role: 'teacher' },
    );
  });

  it('地獄難度：破碎句、英中夾雜、假裝系統錯亂、多意圖黏在一起', async () => {
    await runConversation('地獄口語', [
      {
        user: '呃那個啦明天那個課然後我又餓又想看公告你随意',
        anyOfTools: ['query_courses', 'query_announcements', 'recommend_lunch', 'comprehensive_analysis', 'daily_briefing', 'query_menus'],
      },
      {
        user: 'not 飯 ok? I need 成績 + bus route + 失物 錢包 same time thx',
        anyOfTools: ['query_grades', 'query_bus', 'create_lost_found', 'comprehensive_analysis'],
      },
      {
        user: '退選啦干不想修微積分了啦幫我退',
        anyOfTools: ['drop_course', 'query_enrollments'],
      },
      {
        user: '幫我私訊阿銘跟他說錢還你了不要再已讀不回',
        anyOfTools: ['send_message'],
      },
      {
        user: '………算了你直接 comprehensive 我整個人爆炸塞車遲到又有作業 due',
        anyOfTools: ['comprehensive_analysis', 'daily_briefing', 'query_assignments', 'query_courses'],
      },
      {
        user: '欸如果我用火星文講：Orz 簽到 簽倒 簽道 三選一要幫我打卡啦',
        anyOfTools: ['check_in_attendance', 'query_courses', 'query_attendance'],
      },
    ]);
  });

  it('十分鐘口語馬拉松（連續多輪、模擬真實碎念）', async () => {
    await runConversation('馬拉松 A', [
      { user: '早安我還沒醒先給我懶人包', anyOfTools: ['daily_briefing', 'comprehensive_analysis'] },
      { user: '等等我其實只想知道今天第一堂在哪', anyOfTools: ['query_courses'] },
      { user: '幹趕不上簽到了', anyOfTools: ['check_in_attendance', 'query_attendance'] },
      { user: '下課想吃素的路線規劃一下', anyOfTools: ['recommend_lunch', 'query_menus', 'create_order'] },
      { user: '下午請假頭痛一整個爆炸', anyOfTools: ['request_leave'] },
      { user: '回宿舍順便看包裹還在不在', anyOfTools: ['query_dorm_info'] },
      { user: '順便預約洗衣機不然沒內褲穿', anyOfTools: ['reserve_washing_machine'] },
      { user: '晚上自習位子要有插座那種', anyOfTools: ['reserve_library_seat', 'query_library'] },
      { user: '幫我借一本演算法導論參考書', anyOfTools: ['borrow_book', 'query_library'] },
      { user: '睡前盤點我要繳的作業還有啥', anyOfTools: ['query_assignments'] },
    ]);
    await runConversation('馬拉松 B（情緒反轉）', [
      { user: '算了整天廢我只想看活動有沒有票', anyOfTools: ['query_events'] },
      { user: '最爛那種活動不要推薦給我', anyOfTools: ['query_events', 'comprehensive_analysis'] },
      { user: '還是報名第一個試試', anyOfTools: ['register_event'] },
      { user: '後悔不想去了可以嗎', anyOfTools: ['unregister_event', 'query_events', 'register_event'] },
      { user: '錢包又掉了我要發失物', anyOfTools: ['create_lost_found'] },
      { user: '印論文一式兩份黑白雙面感恩', anyOfTools: ['create_print_job'] },
      { user: '最後罵一下已讀不回的人', anyOfTools: ['query_conversations'] },
      { user: '不清通知我睡不著全部已讀啦', anyOfTools: ['mark_notifications_read'] },
    ]);
  });
});

describe('AI 分角色對話壓測', () => {
  beforeAll(() => {
    setDataSource(mockSource as any);
  });

  jest.setTimeout(400000);

  it('student：學生端口語混搭', async () => {
    const r = 'student' as const;
    await runConversation(
      '學生壓測',
      [
        { user: '欸我到底今天幾堂課啊腦袋打結', anyOfTools: pickTools(r, ['query_courses']) },
        {
          user: '微積分那堂我來不及簽到你快救我打卡',
          anyOfTools: pickTools(r, ['check_in_attendance', 'query_courses']),
        },
        {
          user: '我頭超痛明天想請一整天的假別管哪堂了啦',
          anyOfTools: pickTools(r, ['request_leave']),
        },
        {
          user: '便宜又能飽的最好不要太油',
          anyOfTools: pickTools(r, ['recommend_lunch', 'query_menus', 'create_order']),
        },
        {
          user: '幫我點個雞腿飯備註少鹽',
          anyOfTools: pickTools(r, ['create_order']),
        },
        {
          user: '我上次訂的都還在嗎想看看',
          anyOfTools: pickTools(r, ['query_orders']),
        },
        {
          user: '宿網死掉房間又熱這能報修了吧',
          anyOfTools: pickTools(r, ['create_repair_request']),
        },
        {
          user: '在 B508',
          anyOfTools: pickTools(r, ['create_repair_request']),
        },
        {
          user: '圖書館晚點有沒有位子啦',
          anyOfTools: pickTools(r, ['query_library', 'reserve_library_seat']),
        },
        {
          user: '學校有沒有發什麼很吵的公告',
          anyOfTools: pickTools(r, ['query_announcements']),
        },
        {
          user: '我整個人像快爆掉你一鍵講講我到底怎麼了',
          anyOfTools: pickTools(r, ['comprehensive_analysis', 'daily_briefing']),
        },
      ],
      { role: r },
    );
  });

  it('teacher：教學端口語', async () => {
    const r = 'teacher' as const;
    await runConversation(
      '教師壓測',
      [
        {
          user: '這節資料結構開始點名啦同學都進來沒',
          anyOfTools: pickTools(r, ['start_attendance', 'query_courses']),
        },
        {
          user: '幫我上傳個作業叫期末報告初稿截止下星期五',
          anyOfTools: pickTools(r, ['create_assignment', 'query_courses']),
        },
        {
          user: '小明那題程式作業繳交情況順便查一下細節',
          anyOfTools: pickTools(r, ['query_homework_detail', 'query_course_members']),
        },
        {
          user: '幫批改：繳交單號 sub-old-1 這份給個 92 順便寫不錯但格式要統一',
          anyOfTools: pickTools(r, ['grade_submission']),
        },
        {
          user: '颱風假那種要在課程群組貼個正式公告',
          anyOfTools: pickTools(r, ['create_announcement', 'create_group_post']),
        },
        {
          user: '今天課堂上有誰修了退選我需要名單感覺',
          anyOfTools: pickTools(r, ['query_course_members', 'query_courses']),
        },
        {
          user: '上週發的教材連結我到底丟過沒查一下資料夾類的',
          anyOfTools: pickTools(r, ['query_materials', 'query_courses']),
        },
        {
          user: '同學們出勤太爛幫我看整體出席長怎樣',
          anyOfTools: pickTools(r, ['query_attendance']),
        },
        {
          user: '成績要登了先瞄一眼班級平均分走向',
          anyOfTools: pickTools(r, ['query_grades', 'predict_gpa']),
        },
      ],
      { role: r },
    );
  });

  it('staff：總務／行政口吻＋告示', async () => {
    const r = 'staff' as const;
    await runConversation(
      '總務壓測',
      [
        {
          user: '行政大樓二樓廁所燈不亮請先開個修繕',
          anyOfTools: pickTools(r, ['create_repair_request']),
        },
        { user: '在 B215', anyOfTools: pickTools(r, ['create_repair_request']) },
        {
          user: '麻煩全校公告一下飲水機這週清洗中午別接水',
          anyOfTools: pickTools(r, ['create_announcement']),
        },
        {
          user: '我還想看看最近已經貼過哪些公告別重複發',
          anyOfTools: pickTools(r, ['query_announcements']),
        },
        {
          user: '臨時代課這堂心理健康幫開始點名',
          anyOfTools: pickTools(r, ['start_attendance', 'query_courses']),
        },
        {
          user: '隨堂想要出個小考作業題目附連結請同學繳交',
          anyOfTools: pickTools(r, ['create_assignment', 'query_courses']),
        },
        {
          user: '幫統整一下收件匣未讀有哪些雜項',
          anyOfTools: pickTools(r, ['query_notifications', 'daily_briefing']),
        },
      ],
      { role: r },
    );
  });

  it('vendor：餐廳／攤商店主口吻', async () => {
    const r = 'vendor' as const;
    await runConversation(
      '餐飲業者壓測',
      [
        {
          user: '今天我們便當主菜有哪幾樣要上線看一下',
          anyOfTools: pickTools(r, ['query_menus', 'query_announcements']),
        },
        {
          user: '中午不知道推哪幾道給學生冷熱都要有',
          anyOfTools: pickTools(r, ['recommend_lunch', 'query_menus']),
        },
        {
          user: '幫我看一下這週線上訂單還卡在待處理的有誰',
          anyOfTools: pickTools(r, ['query_orders']),
        },
        {
          user: '有人點大碗滷肉飯兩份不要香菜',
          anyOfTools: pickTools(r, ['create_order']),
        },
        {
          user: '飲料甜度客訴那件幫評分紀錄補個五顆安撫一下',
          anyOfTools: pickTools(r, ['rate_menu_item', 'query_menus']),
        },
        {
          user: '櫃台撿到手機一枝幫我登拾獲招領',
          anyOfTools: pickTools(r, ['create_lost_found']),
        },
        {
          user: '欸我到底能在這個助理裡面做哪些事啦',
          anyOfTools: pickTools(r, ['assistant_help']),
        },
        {
          user: '今天整體營運狀況你亂講一份摘要就好',
          anyOfTools: pickTools(r, ['daily_briefing', 'comprehensive_analysis', 'query_orders']),
        },
      ],
      { role: r },
    );
  });

  it('admin：管理端公告與教學操作', async () => {
    const r = 'admin' as const;
    await runConversation(
      '管理員壓測',
      [
        {
          user: '發緊急公告全校停課一天因為強颱那種語氣官方一點',
          anyOfTools: pickTools(r, ['create_announcement']),
        },
        {
          user: '再確認現在已經掛在上的公告頭條有哪幾則',
          anyOfTools: pickTools(r, ['query_announcements']),
        },
        {
          user: '研究生院這堂研究方法幫我先開始點名啦人手不夠',
          anyOfTools: pickTools(r, ['start_attendance', 'query_courses']),
        },
        {
          user: '出一份作業叫文獻綜述初稿統一下週三交',
          anyOfTools: pickTools(r, ['create_assignment', 'query_courses']),
        },
        {
          user: '幫把那個 sub-admin-zz 這份先給個 76 評語寫可加強引用',
          anyOfTools: pickTools(r, ['grade_submission']),
        },
        {
          user: '幫我發個訊息給教務組說補考場次調整請轉發導師',
          anyOfTools: pickTools(r, ['send_message']),
        },
        {
          user: '順便把教務會議改期這件事加進明天下午三點行程',
          anyOfTools: pickTools(r, ['create_calendar_event']),
        },
        {
          user: '今天校園運作概況來個超短總覽',
          anyOfTools: pickTools(r, ['daily_briefing', 'comprehensive_analysis', 'query_announcements']),
        },
      ],
      { role: r },
    );
  });
});
