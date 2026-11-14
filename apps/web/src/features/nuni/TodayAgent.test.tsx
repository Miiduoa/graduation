import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssistantCalendarReceipt, parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import type { AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import type { HomeTask } from '@/lib/homeOverview';
import { personalImportsStorageKey, readPersonalImports } from '@/lib/personalImports';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { readTodayAgentFollowups, saveTodayAgentFollowup, todayAgentFollowupStorageKey } from '@/lib/todayAgentFollowups';
import { TodayAgent } from './TodayAgent';
import type { V2Card } from './assistant/types';

const environment = vi.hoisted(() => ({ schoolId: 'pu', enabled: true }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: environment.schoolId }),
}));
vi.mock('@/components/AssistantEnabledProvider', () => ({
  useAssistantEnabled: () => environment.enabled,
}));

const context = 'a'.repeat(43);
const accountId = 'alice';
const now = new Date('2026-11-13T13:00:00+08:00');
const localScope = { owner: 'platform:' + accountId, schoolId: 'pu' };
const journalScope = { ...localScope, context };
const urgent: HomeTask = { id: 'task-urgent', courseId: 'course-a', kind: 'assignment',
  title: '資料結構作業', courseName: '資料結構', dueAt: '2026-11-14T23:59:00+08:00' };
const later: HomeTask = { ...urgent, id: 'task-later', kind: 'quiz', title: '英文測驗',
  courseName: '英文', courseId: 'course-b', dueAt: '2026-11-16T12:00:00+08:00' };
const props = { context, accountId, now, tasks: [urgent] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const cardFor = (id = 'home-calendar-001', schoolId = 'pu', title = '準備作業：資料結構作業'): V2Card => ({
  tool: 'propose_personal_event', token: 'signed-' + id, mutationId: id, schoolId,
  destination: '個人行事曆',
  args: { title, date: '2026-11-13', allDay: false, startTime: '14:00', endTime: '14:30' },
});
const receiptFor = (card: V2Card, replay = false) => createAssistantCalendarReceipt({
  schoolId: card.schoolId, mutationId: card.mutationId, event: card.args,
  storage: 'synced', revision: 1, verifiedAt: '2026-11-13T05:01:00.000Z', replay,
  record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
    schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-13T05:00:00.000Z',
    source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } },
});
const checkFor = (card: V2Card, status: 'absent' | 'conflict' | 'revoked', retryable = false) => ({
  version: 1, operation: 'calendar.create', status, schoolId: card.schoolId,
  mutationId: card.mutationId, storage: 'synced', revision: 0,
  checkedAt: '2026-11-13T05:01:00.000Z', authorizationValid: retryable, retryable,
  ...(status === 'revoked' ? { alreadyRevoked: false } : {}),
});
const replyFor = (card: V2Card) => ({
  version: 2, dataRead: true, modelCalls: 0, simulation: false, stopReason: '',
  expiresAt: Date.now() + 300000,
  answer: '已核對原作業、課表與行程，找到 30 分鐘準備時間。',
  cards: [card], steps: [
    { name: 'get_course_work', status: 'ok', summary: '已重新核對選取作業與課程資格' },
    { name: 'find_coursework_study_time', status: 'ok', summary: '已核對課間空堂與個人行程' },
  ],
});
const followupFor = (card: V2Card, change: Partial<AssistantCourseworkFollowup> = {}): AssistantCourseworkFollowup => ({
  version: 1, operation: 'coursework.followup', schoolId: card.schoolId, mutationId: card.mutationId,
  checkedAt: new Date(Date.now()).toISOString(), status: 'scheduled', calendar: 'matching',
  task: { workspaceId: urgent.courseId, taskId: urgent.id, kind: 'assignment' },
  source: { title: urgent.title, courseName: urgent.courseName, dueAt: urgent.dueAt!, state: 'open', submitted: false },
  event: { title: String(card.args.title), date: String(card.args.date), allDay: false, startTime: '14:00', endTime: '14:30' },
  ...change,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Call = { action: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined };
type Handler = (call: Call) => Promise<Response> | Response | undefined;
function api(card = cardFor(), handler?: Handler) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)), signal: init?.signal };
    calls.push(call);
    const handled = handler?.(call);
    if (handled) return handled;
    if (call.action === 'plan') return call.body.routeToken
      ? json(replyFor(card))
      : json({ bootstrap: true, conversationId: 'home-conversation', routeToken: 'signed-route-token' });
    if (call.action === 'followup') return json(followupFor(card));
    throw new Error('Unexpected request: ' + call.action);
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher, actions: () => calls.map(call => call.action) };
}
function saveRecovery(card: V2Card, conversationId = 'prior-conversation') {
  saveAssistantExecutionJournal(journalScope, { conversationId, card }, () => true);
}
async function saveTracking(card = cardFor(), issuedContext = context, conversationId = 'home-conversation') {
  await saveTodayAgentFollowup(localScope, { issuedContext, conversationId,
    card: { tool: 'propose_personal_event', token: card.token, mutationId: card.mutationId, schoolId: card.schoolId,
      destination: card.destination, args: parseAssistantCalendarEvent(card.args) } }, receiptFor(card), () => true);
}
const localStorageMethods = (): Storage => Object.hasOwn(localStorage, 'setItem') ? localStorage : Object.getPrototypeOf(localStorage);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  environment.schoolId = 'pu';
  environment.enabled = true;
  localStorage.clear();
  sessionStorage.clear();
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (key: string, action: () => unknown) => {
      const next = (queues.get(key) || Promise.resolve()).then(action);
      queues.set(key, next.catch(() => {}));
      return next;
    },
  } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('automatically prepares the nearest future task without a chat prompt or any write', async () => {
  const { calls, actions } = api();
  const tasks = [later, { ...urgent, id: 'old-task', dueAt: '2026-11-12T12:00:00+08:00' },
    { ...urgent, id: 'undated-task', dueAt: null }, urgent];
  const view = render(<TodayAgent {...props} tasks={tasks} />);
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['plan', 'plan']);
  for (const { body } of calls) {
    expect(body.task).toEqual({ workspaceId: urgent.courseId, taskId: urgent.id, kind: urgent.kind });
    expect(body).not.toHaveProperty('question');
    expect(body).not.toHaveProperty('history');
  }
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
  expect(screen.queryByRole('textbox')).toBeNull();
  view.rerender(<TodayAgent {...props} tasks={[...tasks]} />);
  await act(async () => {});
  expect(actions()).toEqual(['plan', 'plan']);
});

it('can stop a rejected, uncreated arrangement and then prepare a fresh preview', async () => {
  const card = cardFor();
  const { actions } = api(card, call => {
    if (call.action === 'confirm') return json({ error: 'COURSEWORK_CHANGED' }, 409);
    if (call.action === 'reconcile') return json(checkFor(card, 'absent', false));
    if (call.action === 'cancel') return json(checkFor(card, 'revoked'));
  });
  render(<TodayAgent {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止這份未完成安排' }));
  await screen.findByText('已撤銷未執行提議');
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'reconcile', 'cancel']);
  fireEvent.click(screen.getByRole('button', { name: '替「資料結構作業」找 30 分鐘準備時間' }));
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'reconcile', 'cancel', 'plan']);
});

it('saves recovery evidence before a single confirmed write, then mirrors the verified receipt', async () => {
  const card = cardFor();
  const pending = deferred<Response>();
  let journalAtDispatch: ReturnType<typeof readAssistantExecutionJournal> = [];
  const { actions } = api(card, call => {
    if (call.action === 'confirm') {
      journalAtDispatch = readAssistantExecutionJournal(journalScope);
      return pending.promise;
    }
  });
  render(<TodayAgent {...props} />);
  const confirm = await screen.findByRole('button', { name: '確認' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(actions()).toEqual(['plan', 'plan', 'confirm']));
  expect(journalAtDispatch).toHaveLength(1);
  expect(journalAtDispatch[0]).toMatchObject({ conversationId: 'home-conversation', card: {
    mutationId: card.mutationId, token: card.token, args: card.args,
  } });
  expect(readPersonalImports(localScope)).toEqual([]);
  await act(async () => pending.resolve(json(receiptFor(card))));
  const opened = await screen.findByRole('link', { name: `查看「${urgent.title}」的行程` });
  expect(opened.getAttribute('href')).toContain('eventId=' + card.mutationId);
  expect(readPersonalImports(localScope)).toEqual([receiptFor(card).record]);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'followup']);
});

it('does not accept a different action receipt and reconciles only the original confirmation', async () => {
  const card = cardFor();
  const other = cardFor('different-action-001');
  const { calls, actions } = api(card, call => {
    if (call.action === 'confirm') return json(receiptFor(other));
    if (call.action === 'reconcile') return json(receiptFor(card, true));
  });
  render(<TodayAgent {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認' }));
  await screen.findByRole('link', { name: `查看「${urgent.title}」的行程` });
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'reconcile', 'followup']);
  expect(calls.findLast(call => call.action === 'reconcile')?.body).toEqual(calls[2].body);
  expect(readPersonalImports(localScope).map(row => row.id)).toEqual([card.mutationId]);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it.each(['network', 'permission'] as const)('only reads the original result after a %s confirmation failure', async (failure) => {
  const card = cardFor();
  const { calls, actions } = api(card, call => {
    if (call.action === 'confirm') {
      if (failure === 'network') return Promise.reject(new TypeError('Connection lost after dispatch'));
      return json({ error: 'ASSISTANT_PERMISSION_DENIED' }, 403);
    }
    if (call.action === 'reconcile') return json(checkFor(card, 'absent', false));
  });
  render(<TodayAgent {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認' }));
  await screen.findByRole('button', { name: '重新核對結果' });
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'reconcile']);
  expect(calls.at(-1)?.body).toEqual(calls[2].body);
  expect(screen.queryByRole('button', { name: '重試原確認' })).toBeNull();
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('restores an interrupted operation after reload with one read and no repeated planning or write', async () => {
  const card = cardFor();
  const pending = deferred<Response>();
  const { calls, actions } = api(card, call => {
    if (call.action === 'confirm') return pending.promise;
    if (call.action === 'reconcile') return json(receiptFor(card, true));
  });
  const first = render(<TodayAgent {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認' }));
  await waitFor(() => expect(actions()).toEqual(['plan', 'plan', 'confirm']));
  first.unmount();
  expect(calls[2].signal?.aborted).toBe(true);
  render(<TodayAgent {...props} />);
  await screen.findByRole('link', { name: `查看「${urgent.title}」的行程` });
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'reconcile', 'followup', 'followup']);
  expect(calls[3].body).toEqual(calls[2].body);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toHaveLength(1);
  await act(async () => pending.resolve(json(receiptFor(card))));
  expect(readPersonalImports(localScope)).toHaveLength(1);
});

it('leaves a damaged recovery journal intact and never starts planning or execution', async () => {
  saveRecovery(cardFor());
  const key = sessionStorage.key(0)!;
  sessionStorage.setItem(key, '{damaged-recovery');
  const { actions } = api();
  render(<TodayAgent {...props} />);
  expect((await screen.findByRole('alert')).textContent).toContain('待核對的行程紀錄無法確認');
  expect(actions()).toEqual([]);
  expect(sessionStorage.getItem(key)).toBe('{damaged-recovery');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('keeps the verified action in recovery when local storage fails and later repairs it read-only', async () => {
  const card = cardFor();
  const { actions } = api(card, call => {
    if (call.action === 'confirm') return json(receiptFor(card));
    if (call.action === 'reconcile') return json(receiptFor(card, true));
  });
  render(<TodayAgent {...props} />);
  const confirm = await screen.findByRole('button', { name: '確認' });
  const original = localStorage.setItem;
  const failure = vi.spyOn(localStorageMethods(), 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === localStorage && key === personalImportsStorageKey(localScope)) throw new Error('Storage full');
    return original.call(this, key, value);
  });
  fireEvent.click(confirm);
  const retry = await screen.findByRole('button', { name: '重新核對並更新此裝置' });
  expect(screen.getByText(/帳號中已儲存，此裝置尚未更新/)).toBeTruthy();
  expect(readPersonalImports(localScope)).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(actions()).toEqual(['plan', 'plan', 'confirm']);
  failure.mockRestore();
  fireEvent.click(retry);
  await screen.findByRole('link', { name: `查看「${urgent.title}」的行程` });
  expect(actions()).toEqual(['plan', 'plan', 'confirm', 'reconcile', 'followup']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toHaveLength(1);
});

it.each(['account', 'school'] as const)('ignores a late plan after switching %s', async (changed) => {
  const card = cardFor();
  const delayed = deferred<Response>();
  const { calls, actions } = api(card, call => call.action === 'plan' && call.body.routeToken ? delayed.promise : undefined);
  const view = render(<TodayAgent {...props} />);
  await waitFor(() => expect(actions()).toEqual(['plan', 'plan']));
  if (changed === 'school') environment.schoolId = 'nthu';
  view.rerender(<TodayAgent {...props} accountId={changed === 'account' ? 'bob' : accountId} tasks={[]} />);
  expect(calls[1].signal?.aborted).toBe(true);
  await act(async () => delayed.resolve(json(replyFor(card))));
  await screen.findByText('目前讀到的 nuni 課程沒有待安排的作業或測驗。');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(readPersonalImports(localScope)).toEqual([]);
  expect(actions()).toEqual(['plan', 'plan']);
});

it.each(['account', 'school'] as const)('keeps the original recovery record and ignores a late receipt after switching %s', async (changed) => {
  const card = cardFor();
  const delayed = deferred<Response>();
  const { calls, actions } = api(card, call => call.action === 'confirm' ? delayed.promise : undefined);
  const view = render(<TodayAgent {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認' }));
  await waitFor(() => expect(actions()).toEqual(['plan', 'plan', 'confirm']));
  if (changed === 'school') environment.schoolId = 'nthu';
  view.rerender(<TodayAgent {...props} accountId={changed === 'account' ? 'bob' : accountId} tasks={[]} />);
  expect(calls[2].signal?.aborted).toBe(true);
  await act(async () => delayed.resolve(json(receiptFor(card))));
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  expect(readPersonalImports(localScope)).toEqual([]);
  expect(readPersonalImports({ owner: changed === 'account' ? 'platform:bob' : localScope.owner,
    schoolId: changed === 'school' ? 'nthu' : 'pu' })).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(actions()).toEqual(['plan', 'plan', 'confirm']);
});

it('adopts an operation added by another surface before planning instead of creating a new proposal', async () => {
  const prior = cardFor('prior-calendar-001', 'pu', '先前安排');
  const { actions } = api();
  const view = render(<TodayAgent {...props} tasks={[]} />);
  await screen.findByText('目前讀到的 nuni 課程沒有待安排的作業或測驗。');
  saveRecovery(prior);
  view.rerender(<TodayAgent {...props} />);
  await screen.findByRole('heading', { name: '先前安排' });
  expect(screen.getByRole('alert').textContent).toContain('另一次安排還有結果待核對');
  expect(actions()).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});

it('does not confirm a displayed preview when another surface has added an unresolved operation', async () => {
  const { actions } = api();
  render(<TodayAgent {...props} />);
  const confirm = await screen.findByRole('button', { name: '確認' });
  saveRecovery(cardFor('other-calendar-001', 'pu', '另一次安排'));
  fireEvent.click(confirm);
  await screen.findByRole('heading', { name: '另一次安排' });
  expect(actions()).toEqual(['plan', 'plan']);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('rechecks shared recovery after waiting for a local lock and blocks the pending confirmation', async () => {
  const { actions } = api();
  render(<TodayAgent {...props} />);
  const confirm = await screen.findByRole('button', { name: '確認' });
  let grant: (() => void) | undefined;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_key: string, action: () => unknown) => new Promise((resolve, reject) => {
      grant = () => { void Promise.resolve().then(action).then(resolve, reject); };
    }),
  } });
  fireEvent.click(confirm);
  await waitFor(() => expect(grant).toBeDefined());
  saveRecovery(cardFor('concurrent-calendar-001', 'pu', '等待期間另一筆安排'));
  await act(async () => grant!());
  await screen.findByRole('heading', { name: '等待期間另一筆安排' });
  expect(actions()).toEqual(['plan', 'plan']);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('discards an expired, never-dispatched preview locally so a new arrangement remains possible', async () => {
  const { actions } = api();
  render(<TodayAgent {...props} />);
  const confirm = await screen.findByRole('button', { name: '確認' });
  vi.mocked(Date.now).mockReturnValue(now.getTime() + 300001);
  fireEvent.click(confirm);
  await act(async () => {});
  expect(actions()).toEqual(['plan', 'plan']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
  const cancel = screen.queryByRole('button', { name: '取消' });
  if (cancel) fireEvent.click(cancel);
  const planButton = screen.getByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` });
  await waitFor(() => expect((planButton as HTMLButtonElement).disabled).toBe(false));
  expect(actions()).toEqual(['plan', 'plan']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  fireEvent.click(planButton);
  await screen.findByRole('button', { name: '確認' });
  expect(actions().filter(action => action === 'plan').length).toBeGreaterThan(2);
  expect(actions().some(action => action === 'confirm' || action === 'cancel')).toBe(false);
});

it('limits automatic previews across remounts to one every 15 minutes for the same scope', async () => {
  const { actions } = api();
  const first = render(<TodayAgent {...props} />);
  await screen.findByRole('button', { name: '確認' });
  first.unmount();
  const second = render(<TodayAgent {...props} />);
  const planButton = await screen.findByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` });
  await waitFor(() => expect((planButton as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {});
  expect(actions()).toEqual(['plan', 'plan']);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  second.unmount();
  vi.mocked(Date.now).mockReturnValue(now.getTime() + 15 * 60000 + 1);
  render(<TodayAgent {...props} now={new Date(Date.now())} />);
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['plan', 'plan', 'plan', 'plan']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('allows an explicit plan for a loaded task while other task sources are unavailable', async () => {
  const { actions } = api();
  render(<TodayAgent {...props} error="部分課程資料尚未讀到，請重試。" />);
  const button = await screen.findByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(actions()).toEqual([]);
  fireEvent.click(button);
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['plan', 'plan']);
  expect(screen.getByRole('alert').textContent).toContain('部分課程資料尚未讀到');
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('remembers a verified task after remount and a new login without preparing or writing it again', async () => {
  const card = cardFor();
  const { calls, actions } = api(card, call => call.action === 'confirm' ? json(receiptFor(card)) : undefined);
  const first = render(<TodayAgent {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '確認' }));
  await screen.findByRole('link', { name: `查看「${urgent.title}」的行程` });
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  first.unmount();
  sessionStorage.clear();
  vi.mocked(Date.now).mockReturnValue(now.getTime() + 20 * 60000);
  render(<TodayAgent {...props} context={'b'.repeat(43)} now={new Date(Date.now())} />);
  await screen.findByRole('link', { name: `查看「${urgent.title}」的行程` });
  expect(screen.queryByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` })).toBeNull();
  expect(actions().filter(action => action === 'plan')).toHaveLength(2);
  expect(actions().filter(action => action === 'confirm')).toHaveLength(1);
  expect(calls.at(-1)?.body).toMatchObject({ issuedContext: context, conversationId: 'home-conversation', token: card.token });
});

it('checks existing arrangements before automatically preparing the next unarranged task', async () => {
  const original = cardFor();
  await saveTracking(original);
  const next = cardFor('second-calendar-002', 'pu', '複習測驗：英文測驗');
  const { calls, actions } = api(next, call => call.action === 'followup' ? json(followupFor(original)) : undefined);
  render(<TodayAgent {...props} tasks={[urgent, later]} />);
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['followup', 'plan', 'plan']);
  expect(calls[1].body.task).toEqual({ workspaceId: later.courseId, taskId: later.id, kind: later.kind });
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('keeps an authenticated but unavailable task tracked while allowing a different task to be planned', async () => {
  const original = cardFor();
  await saveTracking(original);
  const next = cardFor('second-calendar-002', 'pu', '複習測驗：英文測驗');
  const { calls, actions } = api(next, call => call.action === 'followup'
    ? json(followupFor(original, { status: 'unavailable', source: null })) : undefined);
  render(<TodayAgent {...props} tasks={[urgent, later]} />);
  await screen.findByRole('button', { name: '確認' });
  expect(screen.getByText('最新狀態尚未確認')).toBeTruthy();
  expect(screen.queryByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` })).toBeNull();
  expect(actions()).toEqual(['followup', 'plan', 'plan']);
  expect(calls[1].body.task).toEqual({ workspaceId: later.courseId, taskId: later.id, kind: later.kind });
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('removes stale display rows after another tab retires the corresponding tracking proof', async () => {
  const card = cardFor();
  await saveTracking(card);
  const { actions } = api(card);
  render(<TodayAgent {...props} error="部分課程資料尚未讀到，請重試。" />);
  await screen.findByText('已安排');
  localStorage.removeItem(todayAgentFollowupStorageKey(localScope));
  fireEvent(window, new StorageEvent('storage', { key: todayAgentFollowupStorageKey(localScope), storageArea: localStorage }));
  const button = await screen.findByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText('已安排')).toBeNull();
  expect(actions()).toEqual(['followup']);
  expect(readTodayAgentFollowups(localScope)).toEqual([]);
});

it('stops before requesting a new plan when tracking is already at capacity', async () => {
  const stored = Array.from({ length: 24 }, (_, index) => cardFor('stored-calendar-' + index));
  await Promise.all(stored.map(card => saveTracking(card)));
  const { actions } = api(cardFor(), call => call.action === 'followup'
    ? json(followupFor(stored.find(card => card.token === call.body.token)!)) : undefined);
  render(<TodayAgent {...props} tasks={[later]} />);
  expect((await screen.findByRole('alert')).textContent).toContain('24 筆');
  expect(actions()).toEqual(Array.from({ length: 24 }, () => 'followup'));
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it('rechecks tracking capacity before dispatching a preview that was already prepared', async () => {
  const stored = Array.from({ length: 24 }, (_, index) => cardFor('stored-calendar-' + index));
  await Promise.all(stored.slice(0, 23).map(card => saveTracking(card)));
  const { actions } = api(cardFor(), call => call.action === 'followup'
    ? json(followupFor(stored.find(card => card.token === call.body.token)!, {
      task: { workspaceId: later.courseId, taskId: later.id, kind: 'quiz' },
      source: { title: later.title, courseName: later.courseName, dueAt: later.dueAt!, state: 'open', submitted: false },
    })) : undefined);
  render(<TodayAgent {...props} />);
  await screen.findByRole('button', { name: '確認' });
  await saveTracking(stored[23]);
  fireEvent(window, new StorageEvent('storage', { key: todayAgentFollowupStorageKey(localScope), storageArea: localStorage }));
  await waitFor(() => expect(actions().filter(action => action === 'followup')).toHaveLength(47));
  await waitFor(() => expect((screen.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  await screen.findByText(/這部裝置已保留 24 筆安排追蹤/);
  expect(actions().filter(action => action === 'confirm')).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
});

it.each([
  ['source_changed', '作業內容或期限有變更'],
  ['submitted', '作業已繳交'],
  ['conflict', '準備時間與最新安排重疊'],
  ['elapsed', '準備時間已結束'],
] as const)('reads %s on return to the foreground without any write', async (status, text) => {
  const card = cardFor();
  await saveTracking(card);
  let changed = false;
  const { actions } = api(card, call => {
    if (call.action !== 'followup') return;
    const source = followupFor(card).source!;
    return json(changed ? followupFor(card, { status,
      source: { ...source, ...(status === 'submitted' ? { submitted: true } : {}),
        ...(status === 'source_changed' ? { dueAt: '2026-11-13T13:30:00+08:00' } : {}) },
      ...(status === 'elapsed' ? { checkedAt: '2026-11-13T07:00:00.000Z' } : {}) }) : followupFor(card));
  });
  render(<TodayAgent {...props} />);
  await screen.findByText('已安排');
  changed = true;
  vi.mocked(Date.now).mockReturnValue(now.getTime() + 60001);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent.focus(window);
  await screen.findByText(text);
  expect(actions()).toEqual(['followup', 'followup']);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readPersonalImports(localScope)).toEqual([]);
  if (status === 'elapsed') expect(screen.queryByText('作業已繳交')).toBeNull();
  fireEvent.focus(window);
  await act(async () => {});
  expect(actions()).toEqual(['followup', 'followup']);
});

it('keeps unread tracking evidence and permits an explicit read retry without starting a new plan', async () => {
  const card = cardFor();
  await saveTracking(card);
  let unavailable = true;
  const { actions } = api(card, call => call.action === 'followup' && unavailable
    ? Promise.reject(new TypeError('Source read disconnected')) : undefined);
  render(<TodayAgent {...props} />);
  expect((await screen.findByRole('alert')).textContent).toContain('部分已安排事項暫時無法核對');
  const find = screen.getByRole('button', { name: `替「${urgent.title}」找 30 分鐘準備時間` }) as HTMLButtonElement;
  expect(find.disabled).toBe(true);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  unavailable = false;
  fireEvent.click(screen.getByRole('button', { name: '重新確認資料' }));
  await screen.findByText('已安排');
  expect(actions()).toEqual(['followup', 'followup']);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});

it('does not clear recovery until the verified arrangement has durable follow-up evidence', async () => {
  const card = cardFor();
  const { actions } = api(card, call => ['confirm', 'reconcile'].includes(call.action) ? json(receiptFor(card)) : undefined);
  render(<TodayAgent {...props} />);
  const confirm = await screen.findByRole('button', { name: '確認' });
  const original = localStorage.setItem;
  const failure = vi.spyOn(localStorageMethods(), 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === localStorage && key === todayAgentFollowupStorageKey(localScope)) throw new Error('Tracking storage full');
    return original.call(this, key, value);
  });
  fireEvent.click(confirm);
  const retry = await screen.findByRole('button', { name: '重新核對並更新此裝置' });
  expect(readPersonalImports(localScope)).toHaveLength(1);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(readTodayAgentFollowups(localScope)).toEqual([]);
  failure.mockRestore();
  fireEvent.click(retry);
  await screen.findByText('已安排');
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(actions().filter(action => action === 'confirm')).toHaveLength(1);
});

it.each(['account', 'school'] as const)('ignores a late follow-up after switching %s', async changed => {
  const card = cardFor();
  await saveTracking(card);
  const delayed = deferred<Response>();
  const { calls, actions } = api(card, call => call.action === 'followup' ? delayed.promise : undefined);
  const view = render(<TodayAgent {...props} />);
  await waitFor(() => expect(actions()).toEqual(['followup']));
  if (changed === 'school') environment.schoolId = 'nthu';
  view.rerender(<TodayAgent {...props} accountId={changed === 'account' ? 'bob' : accountId} tasks={[]} />);
  expect(calls[0].signal?.aborted).toBe(true);
  await act(async () => delayed.resolve(json(followupFor(card))));
  expect(screen.queryByText(urgent.title)).toBeNull();
  expect(screen.queryByText('已安排')).toBeNull();
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readTodayAgentFollowups({ owner: changed === 'account' ? 'platform:bob' : localScope.owner,
    schoolId: changed === 'school' ? 'nthu' : 'pu' })).toEqual([]);
});

it('withdraws an unsent duplicate preview when another tab finishes the same task', async () => {
  const current = cardFor(), completed = cardFor('other-tab-calendar-002');
  const { actions } = api(current, call => call.action === 'followup' ? json(followupFor(completed)) : undefined);
  render(<TodayAgent {...props} />);
  await screen.findByRole('button', { name: '確認' });
  await saveTracking(completed);
  fireEvent(window, new StorageEvent('storage', { key: todayAgentFollowupStorageKey(localScope), storageArea: localStorage }));
  await screen.findByText('已安排');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(actions()).toEqual(['plan', 'plan', 'followup']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('queues proofs added by another tab while the initial follow-up is still loading', async () => {
  const original = cardFor(), additional = cardFor('other-tab-calendar-002');
  await saveTracking(original);
  const delayed = deferred<Response>();
  let initial = true;
  const { actions } = api(original, call => {
    if (call.action !== 'followup') return;
    if (initial) { initial = false; return delayed.promise; }
    return json(call.body.token === original.token ? followupFor(original) : followupFor(additional, {
      task: { workspaceId: later.courseId, taskId: later.id, kind: 'quiz' },
      source: { title: later.title, courseName: later.courseName, dueAt: later.dueAt!, state: 'open', submitted: false },
    }));
  });
  render(<TodayAgent {...props} tasks={[urgent, later]} />);
  await waitFor(() => expect(actions()).toEqual(['followup']));
  await saveTracking(additional);
  fireEvent(window, new StorageEvent('storage', { key: todayAgentFollowupStorageKey(localScope), storageArea: localStorage }));
  await act(async () => delayed.resolve(json(followupFor(original))));
  await screen.findByRole('link', { name: `查看「${later.title}」的行程` });
  expect(actions()).toEqual(['followup', 'followup', 'followup']);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(readTodayAgentFollowups(localScope)).toHaveLength(2);
});

it('retains a damaged tracking history and never treats it as no previous arrangements', async () => {
  const key = todayAgentFollowupStorageKey(localScope);
  localStorage.setItem(key, '{damaged');
  const { actions } = api();
  render(<TodayAgent {...props} />);
  expect((await screen.findByRole('alert')).textContent).toContain('安排追蹤紀錄無法核對');
  expect(actions()).toEqual([]);
  expect(localStorage.getItem(key)).toBe('{damaged');
});

it.each([false, undefined])('shows the task agent with an old or missing assistant setting (%s)', async enabled => {
  environment.enabled = enabled as boolean;
  const { actions } = api();
  render(<TodayAgent {...props} />);
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['plan', 'plan']);
});

it.each(['malformed', 'duplicate'])('shows valid tracking beside %s evidence without removing proofs or enabling writes', async kind => {
  const card = cardFor();
  await saveTracking(card);
  const key = todayAgentFollowupStorageKey(localScope);
  const stored = JSON.parse(localStorage.getItem(key)!);
  stored.entries.unshift({ ...stored.entries[0], ...(kind === 'malformed' ? { issuedContext: 'invalid-old-context' } : {}) });
  const original = JSON.stringify(stored);
  localStorage.setItem(key, original);
  const { actions } = api(card);
  render(<TodayAgent {...props} tasks={[urgent, later]} />);
  await screen.findByText('已安排');
  expect(screen.getByText(later.title)).toBeTruthy();
  expect((screen.getByRole('button', { name: `替「${later.title}」找 30 分鐘準備時間` }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('部分已安排事項暫時無法核對');
  expect(actions()).toEqual(['followup']);
  expect(localStorage.getItem(key)).toBe(original);
});

it('keeps a healthy arrangement visible when another proof is rejected by the server', async () => {
  const bad = cardFor('old-proof-001');
  const good = cardFor('valid-proof-002');
  await saveTracking(bad);
  await saveTracking(good);
  const { actions } = api(good, call => call.action === 'followup' && call.body.token === bad.token
    ? json({ error: 'CONFIRMATION_INVALID' }, 409) : undefined);
  render(<TodayAgent {...props} />);
  await screen.findByText('已安排');
  expect(screen.getByRole('alert').textContent).toContain('部分已安排事項暫時無法核對');
  expect(actions()).toEqual(['followup', 'followup']);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(2);
});
