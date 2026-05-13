/* eslint-disable */
/**
 * 多輪對話離線驗收：模擬使用者連續發話，並以「有呼叫對的工具 + 最後一輪 context 含關鍵線索」
 * 粗判是否算「有在解問題」（非 LLM 裁判）。
 */

import type { AssistantChoiceMenu, CampusActorRole } from '../data/types';
import { mockSource } from '../data/mockSource';
import { setDataSource } from '../data/source';
import {
  autonomousQuery,
  resetAdaptiveLearnedPatternsForTests,
  type AgentQueryResult,
  type ConversationTurn,
} from './aiLocalAgent';

export type MultiTurnScenario = {
  id: string;
  description: string;
  /** 依序的使用者句（不含助手；助手內容由系統拼上） */
  userTurns: string[];
  expectAnyTools: string[];
  /** 檢查最後一輪 contextText（代理匯總）須包含的子字串，代表回覆有給出具體線索 */
  expectContextIncludes?: string[];
  /** 檢查最後一輪工具／讀取摘要拼出的助理訊息，避免「有 context 前綴但內容空洞」的假陽性 */
  expectLastAssistantIncludes?: string[];
  role?: CampusActorRole;
};

export type MultiTurnFailure = { scenarioId: string; reason: string; detail: string };

function pickLatestChoiceMenu(result: AgentQueryResult): AssistantChoiceMenu | undefined {
  for (const e of result.executedActions ?? []) {
    if (e.result?.choiceMenu?.options?.length) return e.result.choiceMenu;
  }
  if (result.choiceMenu?.options?.length) return result.choiceMenu;
  return undefined;
}

function assistantSummaryForHistory(result: AgentQueryResult): string {
  const exec = (result.executedActions ?? [])
    .map((e) => String(e.result?.summary ?? ''))
    .filter(Boolean)
    .join('\n');
  const failed = (result.failedActions ?? []).map((f) => `${f.reason}: ${f.missingInfo}`).join('\n');
  const reads = (result.results ?? [])
    .map((x) => String(x.result?.summary ?? ''))
    .filter(Boolean)
    .join('\n');
  return exec || failed || reads || '(無工具摘要)';
}

function collectAllTools(results: AgentQueryResult[]): Set<string> {
  const tools = new Set<string>();
  for (const result of results) {
    for (const i of result.intents ?? []) tools.add(i.tool);
    for (const e of result.executedActions ?? []) tools.add(e.tool);
    for (const r of result.results ?? []) tools.add(r.tool);
  }
  return tools;
}

export function evaluateMultiTurnOutcome(
  scenario: MultiTurnScenario,
  results: AgentQueryResult[],
): MultiTurnFailure | null {
  if (results.length === 0) {
    return { scenarioId: scenario.id, reason: 'no_results', detail: '' };
  }
  const tools = collectAllTools(results);
  if (scenario.expectAnyTools.length) {
    const hit = scenario.expectAnyTools.some((t) => tools.has(t));
    if (!hit) {
      return {
        scenarioId: scenario.id,
        reason: `missing_tool:${scenario.expectAnyTools.join('|')}`,
        detail: [...tools].join(','),
      };
    }
  }
  const lastResult = results[results.length - 1]!;
  const lastCtx = String(lastResult.contextText ?? '');
  if (scenario.expectContextIncludes?.length) {
    for (const kw of scenario.expectContextIncludes) {
      if (!lastCtx.includes(kw)) {
        return {
          scenarioId: scenario.id,
          reason: `context_missing:${kw}`,
          detail: lastCtx.slice(0, 360),
        };
      }
    }
  }
  if (scenario.expectLastAssistantIncludes?.length) {
    const lastAsst = assistantSummaryForHistory(lastResult);
    for (const kw of scenario.expectLastAssistantIncludes) {
      if (!lastAsst.includes(kw)) {
        return {
          scenarioId: scenario.id,
          reason: `assistant_missing:${kw}`,
          detail: lastAsst.slice(0, 360),
        };
      }
    }
  }
  return null;
}

/**
 * 執行一則多輪場景（每則前清空自適應快取，避免場景互污染）。
 */
export async function runOneMultiTurnScenario(scenario: MultiTurnScenario): Promise<{
  results: AgentQueryResult[];
  failure: MultiTurnFailure | null;
}> {
  resetAdaptiveLearnedPatternsForTests();
  setDataSource(mockSource as any);

  const ctxBase = {
    userId: 'multi-turn-eval',
    schoolId: 'pu',
    role: (scenario.role ?? 'student') as CampusActorRole,
    isOnline: true,
  };

  const history: ConversationTurn[] = [];
  const results: AgentQueryResult[] = [];
  let lastChoiceMenu: AssistantChoiceMenu | undefined;

  for (const text of scenario.userTurns) {
    const r = await autonomousQuery(text, { ...ctxBase, lastChoiceMenu }, undefined, history);
    results.push(r);
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: assistantSummaryForHistory(r) });
    const next = pickLatestChoiceMenu(r);
    if (next) lastChoiceMenu = next;
  }

  return { results, failure: evaluateMultiTurnOutcome(scenario, results) };
}

/** 離線長訓／壓測用：涵蓋訂餐選單、圖書館、報修補房、借書、請假、簽到查詢、私訊、健康查紀錄、教師點名 */
export const MULTI_TURN_SELF_DIALOG_SCENARIOS: MultiTurnScenario[] = [
  {
    id: 'mt-order-then-first',
    description: '訂午餐後選第一個',
    userTurns: ['幫我訂午餐', '第一個'],
    expectAnyTools: ['create_order'],
    expectContextIncludes: ['以下是我自主查詢'],
  },
  {
    id: 'mt-library-seat-first',
    description: '預約自習座位後選第一個',
    userTurns: ['我想預約自習座位', '第一個就好'],
    expectAnyTools: ['reserve_library_seat'],
    expectContextIncludes: ['以下是我自主查詢'],
  },
  {
    id: 'mt-repair-then-room',
    description: '報修後補房號',
    userTurns: ['宿舍冷氣壞掉了幫我報修', '在 B302'],
    expectAnyTools: ['create_repair_request'],
    expectContextIncludes: ['B302'],
  },
  {
    id: 'mt-borrow-then-random',
    description: '借書選單後隨便一本',
    userTurns: ['幫我借《人工智慧》這本書', '隨便借一本相關的'],
    expectAnyTools: ['borrow_book'],
    expectContextIncludes: ['以下是我自主查詢'],
  },
  {
    id: 'mt-leave-sick',
    description: '口語請假病假',
    userTurns: ['我明天頭痛要請假'],
    expectAnyTools: ['request_leave'],
    expectContextIncludes: ['病假'],
  },
  {
    id: 'mt-already-checked-in',
    description: '已簽到只查不簽',
    userTurns: ['我已經簽到了'],
    expectAnyTools: ['query_attendance'],
    expectContextIncludes: ['以下是我自主查詢'],
  },
  {
    id: 'mt-notify-peer',
    description: '傳訊給同學',
    userTurns: ['通知小敏明天的會議改到 10 點'],
    expectAnyTools: ['send_message'],
    expectContextIncludes: ['以下是我自主查詢'],
  },
  {
    id: 'mt-health-records-only',
    description: '查健檢預約紀錄不直接掛號',
    userTurns: ['幫我查預約健康檢查'],
    expectAnyTools: ['query_health_records'],
    expectContextIncludes: ['以下是我自主查詢'],
  },
  {
    id: 'mt-teacher-roll',
    description: '教師開始點名',
    userTurns: ['這堂微積分課開始點名吧'],
    expectAnyTools: ['start_attendance', 'query_courses'],
    expectContextIncludes: ['以下是我自主查詢'],
    role: 'teacher',
  },
  {
    id: 'mt-print-job',
    description: '列印並帶出檔名份數',
    userTurns: ['幫我印一下期中報告.pdf 黑白兩份'],
    expectAnyTools: ['create_print_job'],
    expectContextIncludes: ['期中報告.pdf'],
  },
  {
    id: 'mt-notifications-read',
    description: '全部通知已讀',
    userTurns: ['幫我把所有通知都標為已讀'],
    expectAnyTools: ['mark_notifications_read'],
    expectContextIncludes: ['已將所有通知'],
    expectLastAssistantIncludes: ['已將所有通知'],
  },
  /** 以下自 aiConversationSim：學生訂單流、教師建作業、管理端公告／查公告、總務公告 */
  {
    id: 'mt-student-orders-then-cancel',
    description: '查訂單後取消最後一筆',
    userTurns: ['查看我的訂單', '取消最後一筆訂單'],
    expectAnyTools: ['cancel_order'],
    expectContextIncludes: ['以下是我自主查詢'],
    expectLastAssistantIncludes: ['取消'],
  },
  {
    id: 'mt-teacher-create-assignment',
    description: '教師口語建立作業',
    userTurns: ['幫我上傳個作業叫期末報告初稿截止下星期五'],
    expectAnyTools: ['create_assignment', 'query_courses'],
    expectContextIncludes: ['以下是我自主查詢'],
    expectLastAssistantIncludes: ['作業'],
    role: 'teacher',
  },
  {
    id: 'mt-admin-urgent-announce',
    description: '管理員發緊急公告（工具仍會被呼叫）',
    userTurns: ['發緊急公告全校停課一天因為強颱那種語氣官方一點'],
    expectAnyTools: ['create_announcement'],
    expectContextIncludes: ['以下是我自主查詢', '管理後台'],
    expectLastAssistantIncludes: ['管理後台'],
    role: 'admin',
  },
  {
    id: 'mt-admin-query-announcements',
    description: '管理員查目前公告頭條',
    userTurns: ['再確認現在已經掛在上的公告頭條有哪幾則'],
    expectAnyTools: ['query_announcements'],
    expectContextIncludes: ['以下是我自主查詢', '公告'],
    expectLastAssistantIncludes: ['公告'],
    role: 'admin',
  },
  {
    id: 'mt-staff-drinking-water-announce',
    description: '總務發全校飲水機清洗公告',
    userTurns: ['麻煩全校公告一下飲水機這週清洗中午別接水'],
    expectAnyTools: ['create_announcement'],
    expectContextIncludes: ['以下是我自主查詢', '管理後台'],
    expectLastAssistantIncludes: ['管理後台'],
    role: 'staff',
  },
];

export async function runMultiTurnScenarioBatch(options: {
  iterations: number;
  seed: number;
  maxFailures: number;
}): Promise<{
  attempts: number;
  passed: number;
  failed: number;
  failures: MultiTurnFailure[];
}> {
  const { iterations, maxFailures } = options;
  let a = mulberry32(options.seed >>> 0);
  const failures: MultiTurnFailure[] = [];
  let passed = 0;
  let failed = 0;
  const pool = MULTI_TURN_SELF_DIALOG_SCENARIOS;

  for (let i = 0; i < iterations; i++) {
    const sc = pool[Math.floor(a() * pool.length)]!;
    const { failure } = await runOneMultiTurnScenario(sc);
    if (failure) {
      failed++;
      if (failures.length < 24) failures.push(failure);
      if (failed >= maxFailures) break;
    } else {
      passed++;
    }
  }

  return { attempts: passed + failed, passed, failed, failures };
}

function mulberry32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    let t = (x += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
