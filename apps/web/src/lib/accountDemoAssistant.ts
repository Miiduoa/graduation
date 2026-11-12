'use client';

import {
  ACCOUNT_DEMO_ACTIONS,
  ACCOUNT_DEMO_ACTION_LABELS,
  ACCOUNT_DEMO_FEATURE_LABELS,
  ACCOUNT_DEMO_MEAL,
  applyAccountDemoAction,
  type AccountDemoSnapshot,
  type AccountDemoStateKey,
} from '@campus/shared/src/accountDemo';
import { browserRequest } from '@/features/nuni/Session';
import { parseOwnedAccountDemo } from './accountDemoClient';

export type AccountDemoAssistantScope = {
  context: string;
  accountId: string;
  schoolId: string;
};
export type AccountDemoAssistantProposal = {
  id: string;
  action: AccountDemoStateKey;
  snapshot: AccountDemoSnapshot;
};
export type AccountDemoAssistantAnswer = {
  answer: string;
  proposal?: AccountDemoAssistantProposal;
};
type Request = (input?: { expectedRevision: number; action: AccountDemoStateKey }) => Promise<unknown>;

const actionPages: Record<AccountDemoStateKey, { path: string; label: string }> = {
  submitAssignment: { path: '/classroom', label: '課程與作業' },
  checkIn: { path: '/classroom', label: '課程與點名' },
  requestLeave: { path: '/leave', label: '請假' },
  approveLeave: { path: '/leave/review', label: '請假審核' },
  publishGrade: { path: '/grades?tab=feedback', label: '課程成績' },
  createOrder: { path: '/food', label: '點餐與取餐' },
  readyOrder: { path: '/merchant/workspace', label: '店家工作台' },
  postStory: { path: '/community/me', label: '我的社群頁' },
  sendMessage: { path: '/dms', label: '訊息' },
  reserveSeat: { path: '/library', label: '圖書館' },
  renewBook: { path: '/library', label: '圖書館' },
  requestRepair: { path: '/dormitory', label: '宿舍' },
  postAnnouncement: { path: '/announcements', label: '公告' },
};

export function accountDemoActionDestination(action: AccountDemoStateKey, schoolId: string) {
  const page = actionPages[action];
  return {
    label: page.label,
    href: page.path + (page.path.includes('?') ? '&' : '?') + 'campus=' + encodeURIComponent(schoolId),
  };
}

const actions: readonly [RegExp, AccountDemoStateKey][] = [
  [/^(?:訂餐|點餐|建立訂餐|訂一份雞腿飯)$/, 'createOrder'],
  [/^(?:標示可取餐|餐點已完成|完成餐點)$/, 'readyOrder'],
  [/^(?:預約座位|預約圖書館座位)$/, 'reserveSeat'],
  [/^(?:續借|續借圖書|續借圖書館的書)$/, 'renewBook'],
  [/^(?:請假|送出請假|申請請假)$/, 'requestLeave'],
  [/^(?:核准請假|審核請假)$/, 'approveLeave'],
  [/^(?:簽到|點名|完成簽到)$/, 'checkIn'],
  [/^(?:報修|送出報修|宿舍報修)$/, 'requestRepair'],
  [/^(?:繳交作業|交作業)$/, 'submitAssignment'],
  [/^(?:發布成績|公布成績)$/, 'publishGrade'],
  [/^(?:發布限時動態|發限動)$/, 'postStory'],
  [/^(?:傳送訊息|傳訊息)$/, 'sendMessage'],
  [/^(?:發布公告|發公告)$/, 'postAnnouncement'],
];

/** Only explicit demonstration requests use synthetic data; normal requests keep their original path. */
export function accountDemoAssistantIntent(question: string): 'overview' | AccountDemoStateKey | null {
  const text = question.trim().replace(/[\s，。！？!?：:]/g, '');
  if (/^(?:請|幫我)?(?:查看|查詢|看看)?(?:展示|示範|演示|demo)(?:進度|資料|狀態)$/i.test(text))
    return 'overview';
  const match = /^(?:請|幫我|我要)?(?:展示|示範|演示|demo)(?:一下)?(?:幫我|請)?(.+)$/i.exec(text);
  if (!match) return null;
  return actions.find(([pattern]) => pattern.test(match[1]))?.[1] ?? null;
}

function ensureActive(active: () => boolean): void {
  if (!active()) throw new Error('登入或校園已變更，請重新提問。');
}
function readSnapshot(raw: unknown, scope: AccountDemoAssistantScope): AccountDemoSnapshot {
  const demo = parseOwnedAccountDemo(raw, scope.accountId);
  if (!demo || demo.profile.schoolId !== scope.schoolId)
    throw new Error('這個帳號在目前校園沒有可用的展示資料。');
  if (!demo.permissions.assistant)
    throw new Error('展示助理目前已關閉，請先在設定開啟。');
  return demo;
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function connection(scope: AccountDemoAssistantScope): Request {
  return (input) => browserRequest('account-demo', scope.context, input);
}
function assertAction(demo: AccountDemoSnapshot, action: AccountDemoStateKey) {
  try {
    return applyAccountDemoAction(demo, action);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'DEMO_FEATURE_DISABLED')
      throw new Error('這項展示功能目前已關閉，請先在設定開啟。');
    if (code === 'DEMO_ACTION_NOT_READY')
      throw new Error('這項展示需要先完成前一步，請先建立訂餐、送出請假或繳交作業。');
    throw new Error('這項展示操作目前無法執行。');
  }
}

export function accountDemoActionSummary(action: AccountDemoStateKey): string {
  if (action === 'createOrder' || action === 'readyOrder') {
    return `${ACCOUNT_DEMO_MEAL.merchant} · ${ACCOUNT_DEMO_MEAL.name} × ${ACCOUNT_DEMO_MEAL.quantity} · NT$${ACCOUNT_DEMO_MEAL.price}；${ACCOUNT_DEMO_MEAL.pickup} 於${ACCOUNT_DEMO_MEAL.place}取餐。`;
  }
  return `${ACCOUNT_DEMO_ACTION_LABELS[action]}，並把結果保存至此帳號的展示紀錄。`;
}

export async function prepareAccountDemoAssistant(
  question: string,
  scope: AccountDemoAssistantScope,
  request: Request = connection(scope),
  active: () => boolean = () => true,
): Promise<AccountDemoAssistantAnswer | null> {
  const intent = accountDemoAssistantIntent(question);
  if (!intent) return null;
  ensureActive(active);
  const raw = await request();
  ensureActive(active);
  const demo = readSnapshot(raw, scope);
  if (intent === 'overview') {
    const completed = ACCOUNT_DEMO_ACTIONS.filter((action) => demo.state[action]);
    const disabled = Object.entries(demo.permissions)
      .filter(([, enabled]) => !enabled)
      .map(([feature]) => ACCOUNT_DEMO_FEATURE_LABELS[feature as keyof typeof demo.permissions]);
    const order = demo.state.readyOrder ? '餐點已可取餐' : demo.state.createOrder ? '訂單已建立，等待店家備餐' : '尚未訂餐';
    const leave = demo.state.approveLeave ? '請假已核准' : demo.state.requestLeave ? '請假待審核' : '尚未請假';
    return {
      answer: `已讀取${demo.profile.schoolName}的本人展示資料，目前完成 ${completed.length} 項操作。\n\n訂餐：${order}。\n請假：${leave}。\n圖書館：${demo.state.reserveSeat ? '已預約座位' : '尚未預約座位'}，${demo.state.renewBook ? '已完成續借' : '尚未續借'}。\n\n${disabled.length ? `目前關閉：${disabled.join('、')}。` : '12 項展示功能皆已開啟。'}可以接著說「展示點餐」或「展示預約座位」。`,
    };
  }
  assertAction(demo, intent);
  if (demo.state[intent]) {
    return { answer: `展示紀錄已確認「${ACCOUNT_DEMO_ACTION_LABELS[intent]}」完成，這次沒有重複送出。可以到「${actionPages[intent].label}」查看目前資料。` };
  }
  return {
    answer: `已備好「${ACCOUNT_DEMO_ACTION_LABELS[intent]}」的展示操作，請核對下方內容後確認。`,
    proposal: { id: crypto.randomUUID(), action: intent, snapshot: demo },
  };
}

/** A fresh read, CAS update, exact receipt and a second read are all required before success. */
export async function executeAccountDemoAssistant(
  proposal: AccountDemoAssistantProposal,
  scope: AccountDemoAssistantScope,
  request: Request = connection(scope),
  active: () => boolean = () => true,
): Promise<AccountDemoSnapshot> {
  ensureActive(active);
  if (proposal.snapshot.accountId !== scope.accountId || proposal.snapshot.profile.schoolId !== scope.schoolId)
    throw new Error('登入或校園已變更，請重新提問。');
  const raw = await request();
  ensureActive(active);
  const current = readSnapshot(raw, scope);
  if (!same(current, proposal.snapshot))
    throw new Error('展示資料已變更，請重新提問並核對新的確認卡。');
  const expectedState = assertAction(current, proposal.action);
  if (current.state[proposal.action]) return current;
  ensureActive(active);
  const written = await request({ expectedRevision: current.revision, action: proposal.action });
  ensureActive(active);
  const saved = readSnapshot(written, scope);
  const expected = { ...current, revision: current.revision + 1, state: expectedState };
  if (!same(saved, expected))
    throw new Error('展示操作的回執尚未核對，請開啟對應功能查看。');
  const confirmed = await request();
  ensureActive(active);
  const verified = readSnapshot(confirmed, scope);
  if (!same(verified, saved))
    throw new Error('展示操作的儲存結果尚未核對，請開啟對應功能查看。');
  return verified;
}
