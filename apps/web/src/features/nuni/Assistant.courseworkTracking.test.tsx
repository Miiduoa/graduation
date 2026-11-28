import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssistantCalendarReceipt, parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import type { AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import { answerAssistantPersonalQuestion } from '@/lib/assistantPersonalReads';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { readTodayAgentFollowups, saveTodayAgentFollowup, todayAgentFollowupStorageKey } from '@/lib/todayAgentFollowups';
import { readPersonalImports } from '@/lib/personalImports';
import { Conversation } from './Assistant';
import { TodayAgent } from './TodayAgent';
import type { V2Card } from './assistant/types';

const environment = vi.hoisted(() => ({ schoolId: 'pu' }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: environment.schoolId }),
}));
vi.mock('@/components/AssistantEnabledProvider', () => ({ useAssistantEnabled: () => true }));
vi.mock('@/lib/assistantPersonalReads', async original => ({
  ...(await original<typeof import('@/lib/assistantPersonalReads')>()),
  answerAssistantPersonalQuestion: vi.fn(),
}));

const context = 'a'.repeat(43);
const localScope = { owner: 'platform:alice', schoolId: 'pu' };
const journalScope = { ...localScope, context };
const now = new Date('2026-11-13T13:00:00+08:00');
const target = { workspaceId: 'course-one', taskId: 'assignment-one', kind: 'assignment' as const,
  title: '期末資料模型', courseTitle: '資料庫管理', dueAt: '2026-11-14T23:59:00+08:00' };
const task = { id: target.taskId, courseId: target.workspaceId, kind: target.kind,
  title: target.title, courseName: target.courseTitle, dueAt: target.dueAt };
const cardFor = (id = 'chat-study-calendar-001', coursework: boolean | undefined = true): V2Card => ({
  tool: 'propose_personal_event', token: 'signed-' + id, mutationId: id, schoolId: 'pu', destination: '個人行事曆',
  ...(coursework === undefined ? {} : { coursework }),
  args: { title: '準備期末資料模型', date: '2026-11-13', allDay: false, startTime: '14:00', endTime: '14:30' },
});
const receiptFor = (card: V2Card) => createAssistantCalendarReceipt({
  schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced', revision: 1,
  verifiedAt: now.toISOString(), replay: false,
  record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events', schoolId: card.schoolId,
    academicYear: '', semester: '', importedAt: now.toISOString(),
    source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } },
});
const followupFor = (card: V2Card, change: Partial<AssistantCourseworkFollowup> = {}): AssistantCourseworkFollowup => ({
  version: 1, operation: 'coursework.followup', schoolId: card.schoolId, mutationId: card.mutationId,
  checkedAt: now.toISOString(), status: 'scheduled', calendar: 'matching',
  task: { workspaceId: target.workspaceId, taskId: target.taskId, kind: target.kind },
  source: { title: target.title, courseName: target.courseTitle, dueAt: target.dueAt, state: 'open', submitted: false },
  event: parseAssistantCalendarEvent(card.args), ...change,
});
const replyFor = (card: V2Card) => ({ version: 2, dataRead: true, modelCalls: 0,
  simulation: false, expiresAt: Date.now() + 300_000, answer: '已核對原作業與空堂，請確認準備時間。',
  steps: [{ name: 'get_course_work', status: 'ok', summary: '已核對原作業與時間' }], cards: [card] });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
type Call = { action: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined };
function api(card = cardFor(), handler?: (call: Call) => Response | Promise<Response | undefined> | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { action: url.split('/').at(-1)!, body: JSON.parse(String(init?.body)), signal: init?.signal };
    calls.push(call);
    const handled = await handler?.(call);
    if (handled) return handled;
    if (call.action === 'ask') return json(replyFor(card));
    if (call.action === 'plan') return json(call.body.routeToken
      ? replyFor(cardFor('home-unsent-calendar-001'))
      : { bootstrap: true, conversationId: 'home-conversation', routeToken: 'home-route' });
    if (call.action === 'confirm' || call.action === 'reconcile') return json(receiptFor(card));
    if (call.action === 'followup') return json(followupFor(card));
    throw new Error('Unexpected request: ' + call.action);
  }));
  return { calls, actions: () => calls.map(call => call.action) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function Chat({ accountId = 'alice', session = context }: { accountId?: string; session?: string }) {
  const [text, setText] = useState('');
  return <section aria-label="聊天工作"><Conversation key={[accountId, session, environment.schoolId].join(':')}
    context={session} accountId={accountId} schoolId={environment.schoolId}
    cloudEnabled={false} inlineDraft={{ text, setText }} /></section>;
}
function Workspace() {
  return <><section aria-label="首頁工作"><TodayAgent context={context} accountId="alice" tasks={[task]} now={now} /></section>
    <Chat /></>;
}
const chat = () => within(screen.getByRole('region', { name: '聊天工作' }));
const home = () => within(screen.getByRole('region', { name: '首頁工作' }));
async function preview() {
  fireEvent.change(chat().getByLabelText('問題'), { target: { value: '我有哪些未交作業？' } });
  fireEvent.submit(chat().getByRole('form', { name: '傳送問題' }));
  fireEvent.click(await chat().findByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' }));
  return (await chat().findAllByRole('button', { name: '確認' }))[0];
}
async function fillTracking() {
  for (let index = 0; index < 24; index++) {
    const card = cardFor('already-tracked-' + index);
    await saveTodayAgentFollowup(localScope, { issuedContext: context, conversationId: 'original-' + index,
      card: { tool: 'propose_personal_event', token: card.token, args: parseAssistantCalendarEvent(card.args),
        mutationId: card.mutationId, schoolId: card.schoolId, destination: card.destination } }, receiptFor(card), () => true);
  }
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  Element.prototype.scrollIntoView = vi.fn();
  environment.schoolId = 'pu';
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
  vi.mocked(answerAssistantPersonalQuestion).mockReset().mockResolvedValue({ kind: 'personal',
    content: '資料庫管理：期末資料模型尚未繳交。', serviceIds: ['classroom'], courseworkTargets: [target] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('connects an explicit chat confirmation to the already mounted home without reload or a second write', async () => {
  const card = cardFor(), { calls, actions } = api(card);
  render(<Workspace />);
  await home().findByRole('button', { name: '確認' });
  const confirm = await preview();
  expect(actions().filter(action => action === 'confirm')).toEqual([]);
  expect(readTodayAgentFollowups(localScope)).toEqual([]);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  const tracked = await home().findByRole('group', { name: '「期末資料模型」的安排追蹤' });
  expect(within(tracked).getByText('已安排')).toBeTruthy();
  expect(within(tracked).getByRole('link', { name: '查看「期末資料模型」的作業' }).getAttribute('href'))
    .toBe('/classroom/course/course-one#assignment-assignment-one');
  expect(home().queryByRole('button', { name: '確認' })).toBeNull();
  expect(home().queryByRole('list', { name: '代辦步驟' })).toBeNull();
  expect(home().queryByRole('button', { name: '替「期末資料模型」找 30 分鐘準備時間' })).toBeNull();
  await waitFor(() => expect(readAssistantExecutionJournal(journalScope)).toEqual([]));
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readPersonalImports(localScope).map(row => row.id)).toEqual([card.mutationId]);
  expect(actions().filter(action => action === 'confirm')).toHaveLength(1);
  expect(actions().filter(action => action === 'ask')).toHaveLength(1);
  expect(actions().filter(action => action === 'followup')).toHaveLength(2);
  const confirmation = calls.find(call => call.action === 'confirm')!;
  for (const call of calls.filter(call => call.action === 'followup'))
    expect(call.body).toMatchObject({ issuedContext: context, conversationId: confirmation.body.conversationId,
      token: card.token, args: card.args });
  expect(calls.find(call => call.action === 'ask')?.body).toMatchObject({ consent: false, history: [],
    studyTarget: { workspaceId: target.workspaceId, taskId: target.taskId, kind: target.kind } });
});

it('keeps the receipt and journal after followup fails, then resumes through reads without resending confirmation', async () => {
  const card = cardFor();
  let offline = true;
  const { actions } = api(card, call => call.action === 'followup' && offline
    ? json({ message: '安排追蹤暫時無法讀取。' }, 503) : undefined);
  render(<Chat />);
  fireEvent.click(await preview());
  await chat().findByText(/行程已核對，但安排追蹤尚未接續/);
  expect(readPersonalImports(localScope)).toHaveLength(1);
  expect(readTodayAgentFollowups(localScope)).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(chat().queryByRole('button', { name: '確認' })).toBeNull();
  offline = false;
  expect(chat().queryByText(/帳號中已儲存，此裝置尚未更新/)).toBeNull();
  fireEvent.click(chat().getByRole('button', { name: '重新核對結果' }));
  await waitFor(() => expect(readAssistantExecutionJournal(journalScope)).toEqual([]));
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(chat().queryByText(/安排追蹤尚未接續/)).toBeNull();
  expect(actions()).toEqual(['ask', 'confirm', 'followup', 'reconcile', 'followup']);
  expect(readPersonalImports(localScope)).toHaveLength(1);
});

it('checks coursework tracking capacity before sending any confirmation', async () => {
  await fillTracking();
  const { actions } = api();
  render(<Chat />);
  fireEvent.click(await preview());
  await chat().findByText(/這部裝置已保留 24 筆安排追蹤/);
  expect(actions()).toEqual(['ask']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(localScope)).toEqual([]);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(24);
});

it('retains recovery when tracking fills after preflight instead of discarding another task or creating again', async () => {
  const card = cardFor();
  const { actions } = api(card, async call => {
    if (call.action !== 'confirm') return;
    await fillTracking();
    return json(receiptFor(card));
  });
  render(<Chat />);
  fireEvent.click(await preview());
  await chat().findByText(/行程已核對，但安排追蹤尚未接續/);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(24);
  expect(readAssistantExecutionJournal(journalScope).map(entry => entry.card.mutationId)).toEqual([card.mutationId]);
  expect(readPersonalImports(localScope).map(row => row.id)).toEqual([card.mutationId]);
  fireEvent.click(chat().getByRole('button', { name: '重新核對結果' }));
  await waitFor(() => expect(actions()).toEqual(['ask', 'confirm', 'followup', 'reconcile', 'followup']));
  await chat().findByText(/行程已核對，但安排追蹤尚未接續/);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
});

it.each(['account', 'school'] as const)('ignores a late followup after the %s changes', async changed => {
  const card = cardFor(), pending = deferred<Response>();
  const { calls, actions } = api(card, call => call.action === 'followup' ? pending.promise : undefined);
  const view = render(<Chat />);
  fireEvent.click(await preview());
  await waitFor(() => expect(actions()).toEqual(['ask', 'confirm', 'followup']));
  const read = calls.at(-1)!;
  if (changed === 'school') environment.schoolId = 'nthu';
  view.rerender(<Chat accountId={changed === 'account' ? 'bob' : 'alice'} session={'b'.repeat(43)} />);
  expect(read.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(json(followupFor(card))));
  expect(readTodayAgentFollowups(localScope)).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(readPersonalImports({ owner: changed === 'account' ? 'platform:bob' : localScope.owner,
    schoolId: changed === 'school' ? 'nthu' : 'pu' })).toEqual([]);
  expect(chat().queryByText('準備期末資料模型')).toBeNull();
});

it.each([true, false, undefined])('classifies restored coursework hint %s before clearing its original journal', async hint => {
  const card = cardFor('restored-calendar-001');
  if (hint === undefined) delete card.coursework;
  else card.coursework = hint;
  saveAssistantExecutionJournal(journalScope, { conversationId: 'original-conversation', card }, () => true);
  const { calls, actions } = api(card);
  render(<Chat />);
  await chat().findByRole('link', { name: '開啟這筆行程' });
  expect(actions()).toEqual(hint === false ? ['reconcile'] : ['reconcile', 'followup']);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(hint === false ? 0 : 1);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  for (const call of calls) expect(call.body).toMatchObject({ conversationId: 'original-conversation', token: card.token });
});

it('classifies a legacy ordinary event with a read without adding coursework tracking', async () => {
  const card = cardFor();
  delete card.coursework;
  saveAssistantExecutionJournal(journalScope, { conversationId: 'original-conversation', card }, () => true);
  const { actions } = api(card, call => call.action === 'followup'
    ? json(followupFor(card, { status: 'not_coursework', calendar: 'unavailable', task: null, source: null })) : undefined);
  render(<Chat />);
  await chat().findByRole('link', { name: '開啟這筆行程' });
  expect(actions()).toEqual(['reconcile', 'followup']);
  expect(readTodayAgentFollowups(localScope)).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('allows an explicit retry of an absent legacy ordinary event even when coursework tracking is full', async () => {
  await fillTracking();
  const card = cardFor('legacy-ordinary-calendar-001');
  delete card.coursework;
  saveAssistantExecutionJournal(journalScope, { conversationId: 'original-conversation', card }, () => true);
  const { actions } = api(card, call => {
    if (call.action === 'reconcile') return json({ version: 1, operation: 'calendar.create', status: 'absent',
      schoolId: 'pu', mutationId: card.mutationId, storage: 'synced', revision: 0, checkedAt: now.toISOString(),
      authorizationValid: true, retryable: true });
    if (call.action === 'followup') return json(followupFor(card, {
      status: 'not_coursework', calendar: 'unavailable', task: null, source: null,
    }));
  });
  render(<Chat />);
  fireEvent.click(await chat().findByRole('button', { name: '重試原確認' }));
  await waitFor(() => expect(readAssistantExecutionJournal(journalScope)).toEqual([]));
  expect(actions()).toEqual(['reconcile', 'confirm', 'followup']);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(24);
  expect(readPersonalImports(localScope).map(row => row.id)).toEqual([card.mutationId]);
});

it('keeps a new ordinary event independent of coursework capacity and tracking locks', async () => {
  await fillTracking();
  const request = navigator.locks.request.bind(navigator.locks);
  vi.spyOn(navigator.locks, 'request').mockImplementation(((key: string, action: () => unknown) => {
    if (key === todayAgentFollowupStorageKey(localScope)) throw new Error('tracking locks unavailable');
    return request(key, action);
  }) as typeof navigator.locks.request);
  const card = cardFor('ordinary-calendar-001', false), { actions } = api(card);
  render(<Chat />);
  fireEvent.click(await preview());
  await chat().findByRole('link', { name: '開啟這筆行程' });
  expect(actions()).toEqual(['ask', 'confirm']);
  expect(readTodayAgentFollowups(localScope)).toHaveLength(24);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('retains the original receipt when the following calendar read detects a concurrent change', async () => {
  const card = cardFor(), { actions } = api(card, call => call.action === 'followup'
    ? json(followupFor(card, { status: 'event_changed', calendar: 'changed' })) : undefined);
  render(<Chat />);
  fireEvent.click(await preview());
  await chat().findByText('行程的最新狀態仍需確認，原安排與追蹤紀錄已保留。請重新核對或查看行事曆。');
  expect(readTodayAgentFollowups(localScope)).toHaveLength(1);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(chat().getByRole('button', { name: '重新核對結果' })).toBeTruthy();
  expect(chat().queryByRole('button', { name: '確認' })).toBeNull();
  expect(actions()).toEqual(['ask', 'confirm', 'followup']);
});

it('stops dependent confirmations until the original tracking warning is repaired by a read', async () => {
  const first = cardFor(), second = { ...cardFor('chat-study-calendar-002'),
    args: { ...cardFor().args, title: '準備第二份作業', startTime: '15:00', endTime: '15:30' } };
  let unavailable = true;
  const { calls, actions } = api(first, call => {
    if (call.action === 'ask') return json({ ...replyFor(first), cards: [first, second] });
    const card = call.body.token === second.token ? second : first;
    if (call.action === 'confirm' || call.action === 'reconcile') return json(receiptFor(card));
    if (call.action === 'followup') return unavailable ? json({ message: '追蹤暫時無法讀取。' }, 503)
      : json(followupFor(card));
  });
  render(<Chat />);
  await preview();
  fireEvent.click(chat().getByRole('button', { name: '依序確認 2 筆個人行程' }));
  await chat().findByText(/行程已核對，但安排追蹤尚未接續/);
  const secondCard = within(chat().getAllByRole('article', { name: '行程確認卡' })[1]);
  expect((secondCard.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
  expect(secondCard.getByText(/前一筆行程已儲存，裝置資料或安排追蹤仍待核對/)).toBeTruthy();
  expect(calls.filter(call => call.action === 'confirm').map(call => call.body.token)).toEqual([first.token]);
  unavailable = false;
  fireEvent.click(secondCard.getByRole('button', { name: '重新核對前一步行程' }));
  await waitFor(() => expect((secondCard.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false));
  expect(actions().filter(action => action === 'confirm')).toHaveLength(1);
  expect(readTodayAgentFollowups(localScope).map(entry => entry.card.mutationId)).toEqual([first.mutationId]);
  fireEvent.click(secondCard.getByRole('button', { name: '確認' }));
  await waitFor(() => expect(readTodayAgentFollowups(localScope)).toHaveLength(2));
  expect(calls.filter(call => call.action === 'confirm').map(call => call.body.token)).toEqual([first.token, second.token]);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});
