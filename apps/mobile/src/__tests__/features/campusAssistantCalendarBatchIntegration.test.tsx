import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { askCampusAssistant } from '../../features/campusAssistant';
import { CampusAssistantScreen } from '../../screens/CampusAssistantScreen';
import { prepareAssistantCalendarBatch } from '../../services/assistantCalendarBatchExecution';
import { assistantCalendarBatchStorageKey, readAssistantCalendarBatchPlans } from '../../services/assistantCalendarBatchStore';
import { assistantCalendarJournalStorageKey, readAssistantCalendarJournal } from '../../services/assistantCalendarJournal';
import { confirmAssistantCalendarTask, createAssistantCalendarTask } from '../../services/assistantCalendarExecution';
import { deletePersonalImport, editPersonalImport, loadPersonalImports, personalImportStorageKey } from '../../services/personalImports';

let mockUid: string | null = 'A';
let mockSchool = 'pu';
let mockPlatform: {
  session: { platformAccountId: string; context: string };
  isSessionCurrent: (id: string, context: string) => boolean;
  request: jest.Mock;
  bffRequest: jest.Mock;
} | null = null;
const mockCallable = jest.fn();
const mockCollect = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}), isFirebaseMockMode: () => false,
}));
jest.mock('../../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../../state/school', () => ({ useSchool: () => ({
  school: { id: mockSchool, name: '靜宜大學' }, selectionReady: true,
}) }));
jest.mock('../../state/nuniSession', () => ({ useOptionalNuniSession: () => mockPlatform }));
jest.mock('../../screens/AssistantClassNowHint', () => ({
  AssistantClassNowHint: ({ children }: { children: (upcoming: boolean) => React.ReactNode }) => children(false),
}));
jest.mock('../../screens/LegacyAssignmentReminders', () => ({ LegacyAssignmentReminders: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: (...args: unknown[]) => mockCollect(...args),
  formatOnDeviceSchoolPrompt: () => 'device context',
}));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: false })), getSavedModelId: jest.fn(async () => null),
    getDownloadedModels: jest.fn(async () => []), isModelDownloaded: jest.fn(async () => false),
    getState: jest.fn(() => ({ status: 'idle' })), loadModel: jest.fn(), generate: jest.fn(),
  }, getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));

const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const scope = { owner: 'firebase:A', schoolId: 'pu' };
const context = () => ({ uid: 'A', schoolId: 'pu', isCurrent: () => mockUid === 'A' && mockSchool === 'pu' });
const events: AssistantCalendarEvent[] = [
  { title: '英文讀書', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' },
  { title: '程式練習', date: '2099-01-02', allDay: false, startTime: '20:00', endTime: '21:00' },
  { title: '資料庫複習', date: '2099-01-02', allDay: false, startTime: '21:00', endTime: '22:00' },
];
const batchQuestion = (count = 3) => '幫我安排以下行程：\n' + events.slice(0, count)
  .map((event) => `${event.date} ${event.startTime} 到 ${event.endTime} ${event.title}`).join('\n');
const singleQuestion = `幫我 ${events[0]!.date} ${events[0]!.startTime} 到 ${events[0]!.endTime} 安排${events[0]!.title}`;
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
const navigation = () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalCalendar', 'Map', 'MapV2'] }) });
function setupPlatform() {
  mockPlatform = {
    session: { platformAccountId: 'platform-a', context: 'a'.repeat(43) },
    isSessionCurrent: (id, candidate) => mockPlatform?.session.platformAccountId === id &&
      mockPlatform.session.context === candidate,
    request: jest.fn(), bffRequest: jest.fn(),
  };
}
async function ready(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.queryByText('正在找回並核對先前的行程操作…')).toBeNull());
}
async function send(view: ReturnType<typeof render>, question: string) {
  await ready(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), question);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '送出問題' })));
}
function expectNoModelCalls() {
  expect(mockCallable).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  expect(jest.requireMock('../../services/localLLMInference').localLLM.generate).not.toHaveBeenCalled();
  if (mockPlatform) {
    expect(mockPlatform.request).not.toHaveBeenCalled();
    expect(mockPlatform.bffRequest).not.toHaveBeenCalled();
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUid = 'A'; mockSchool = 'pu'; mockPlatform = null;
  mockCallable.mockResolvedValue({ data: { content: '一般回答', run: { status: 'completed' }, actions: [] } });
});
afterEach(() => jest.restoreAllMocks());

test.each(['campus', 'dual-login-platform'] as const)('the real %s screen saves a plan without attempts, then confirms and reads back every event once', async (audience) => {
  if (audience === 'dual-login-platform') setupPlatform();
  const target = { owner: audience === 'campus' ? 'firebase:A' : 'nuni:platform-a', schoolId: 'pu' };
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav}
    route={{ name: audience === 'campus' ? 'CampusAssistant' : 'NuniTimetableAssistant' }} />);
  await send(view, batchQuestion(2));
  const plans = await readAssistantCalendarBatchPlans(target, () => true);
  expect(plans).toHaveLength(1);
  expect(plans[0]!.steps.map((step) => step.event)).toEqual(events.slice(0, 2));
  expect(await readAssistantCalendarJournal(target, () => true)).toHaveLength(0);
  expect(ledgerWrites()).toHaveLength(0);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.map(([key]) => key))
    .toEqual([assistantCalendarBatchStorageKey(target)]);
  expect(view.getByText('已核對 0／2 筆行程')).toBeTruthy();
  expectNoModelCalls();
  const confirm = view.getByRole('button', { name: '確認加入 2 筆行程' });
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
  await view.findByText('已逐筆保存並核對 2 筆行程。');
  const ledger = await loadPersonalImports(target);
  expect(ledger.records.map((row) => row.title)).toEqual(events.slice(0, 2).map((event) => event.title));
  expect(new Set(ledger.records.map((row) => row.id)).size).toBe(2);
  expect(ledgerWrites()).toHaveLength(2);
  for (const row of ledger.records) {
    fireEvent.press(view.getByRole('button', { name: `查看行程：${row.title}` }));
    expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: row.id });
  }
  const allowed = new Set([assistantCalendarBatchStorageKey(target), assistantCalendarJournalStorageKey(target),
    personalImportStorageKey(target)]);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.every(([key]) => allowed.has(key))).toBe(true);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([key]) => allowed.has(key))).toBe(true);
  expectNoModelCalls();
});

test('the multi-event shortcut only fills an editable draft until the user sends and confirms it', async () => {
  const view = render(<CampusAssistantScreen />);
  await ready(view);
  fireEvent.press(view.getByRole('button', { name: '填寫多筆行程範例' }));
  expect(view.getByLabelText('詢問校園助理').props.value).toContain('幫我安排以下行程：\n');
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toHaveLength(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '送出問題' })));
  expect(view.getByRole('button', { name: '確認加入 2 筆行程' })).toBeTruthy();
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test.each(['continue', 'cancel'] as const)('restarting a partially completed plan needs a fresh decision to %s the remaining events', async (decision) => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const first = createAssistantCalendarTask(events[0]!, context());
  const saved = await confirmAssistantCalendarTask(first.proposal, context());
  if (saved.state !== 'verified') throw new Error('missing initial receipt');
  jest.clearAllMocks();
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await view.findByText('找回的多筆行程');
  await view.findByRole('button', { name: '確認接續剩餘 2 筆行程' });
  expect(view.getByText('已核對 1／3 筆行程')).toBeTruthy();
  expect(view.getAllByText('尚未開始')).toHaveLength(2);
  expect(ledgerWrites()).toHaveLength(0);
  expect((await readAssistantCalendarJournal(scope, () => true)).map((entry) => entry.proposal.mutationId))
    .toEqual([saved.proposal.mutationId]);
  if (decision === 'continue') {
    await act(async () => fireEvent.press(view.getByRole('button', { name: '確認接續剩餘 2 筆行程' })));
    await view.findByText('已逐筆保存並核對 3 筆行程。');
    expect(ledgerWrites()).toHaveLength(2);
    const ledger = await loadPersonalImports(scope);
    expect(ledger.records).toHaveLength(3);
    expect(ledger.records[0]!.id).toBe(saved.proposal.mutationId);
  } else {
    await act(async () => fireEvent.press(view.getByRole('button', { name: '取消尚未開始的行程' })));
    await waitFor(() => expect(view.getAllByText('已取消，尚未開始')).toHaveLength(2));
    expect(view.queryByRole('button', { name: '確認接續剩餘 2 筆行程' })).toBeNull();
    expect(ledgerWrites()).toHaveLength(0);
    expect((await loadPersonalImports(scope)).records.map((row) => row.id)).toEqual([saved.proposal.mutationId]);
    const plans = await readAssistantCalendarBatchPlans(scope, () => true);
    expect(plans[0]).toMatchObject({ id: prepared.plan.id, cancelledAt: expect.any(String) });
    fireEvent.press(view.getByRole('button', { name: '查看行程：英文讀書' }));
    expect(nav.navigate).toHaveBeenCalledWith('PersonalCalendar', { eventId: saved.proposal.mutationId });
    view.unmount();
    const reopened = render(<CampusAssistantScreen navigation={nav} />);
    await reopened.findByText('已核對 1／3 筆行程');
    expect(reopened.queryByRole('button', { name: '確認接續剩餘 2 筆行程' })).toBeNull();
    expect(ledgerWrites()).toHaveLength(0);
  }
  expectNoModelCalls();
});

test('an unknown second write stops the third until same-ID readback and a fresh continuation confirmation', async () => {
  const targetKey = personalImportStorageKey(scope);
  let writes = 0;
  let lateLedger = '';
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === targetKey && ++writes === 2) {
      lateLedger = value;
      throw new Error('lost native response');
    }
    return originalSet(key, value);
  });
  const view = render(<CampusAssistantScreen />);
  await send(view, batchQuestion());
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入 3 筆行程' })));
  await waitFor(() => expect(view.getAllByText(/目前沒有讀到這筆行程/).length).toBeGreaterThan(0));
  expect(view.getByText('已核對 1／3 筆行程')).toBeTruthy();
  expect(view.getByText('尚未開始')).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認接續剩餘 1 筆行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(2);
  const journal = await readAssistantCalendarJournal(scope, () => true);
  expect(journal.map((entry) => entry.proposal.event.title)).toEqual(['英文讀書', '程式練習']);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  expect(lateLedger).not.toBe('');

  await originalSet(targetKey, lateLedger);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對整份行程' })));
  await view.findByRole('button', { name: '確認接續剩餘 1 筆行程' });
  expect(view.getByText('已核對 2／3 筆行程')).toBeTruthy();
  expect(ledgerWrites()).toHaveLength(2);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(2);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認接續剩餘 1 筆行程' })));
  await view.findByText('已逐筆保存並核對 3 筆行程。');
  const complete = await loadPersonalImports(scope);
  expect(complete.records).toHaveLength(3);
  expect(complete.records.slice(0, 2).map((row) => row.id)).toEqual(journal.map((entry) => entry.proposal.mutationId));
  expect(ledgerWrites()).toHaveLength(3);
  expectNoModelCalls();
});

test.each(['account', 'school'] as const)('a %s change during the first native write never authorizes later steps or exposes old results', async (change) => {
  const targetKey = personalImportStorageKey(scope);
  const gate = deferred();
  let held = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === targetKey && !held) { held = true; await gate.promise; }
    return originalSet(key, value);
  });
  const view = render(<CampusAssistantScreen />);
  await send(view, batchQuestion());
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入 3 筆行程' })));
  await waitFor(() => expect(ledgerWrites()).toHaveLength(1));
  if (change === 'account') mockUid = 'B'; else mockSchool = 'nthu';
  view.rerender(<CampusAssistantScreen />);
  await ready(view);
  await act(async () => gate.resolve());
  await waitFor(async () => expect(JSON.parse((await originalGet(targetKey))!).records).toHaveLength(1));
  expect(view.queryByText('1. 英文讀書')).toBeNull();
  expect(view.queryByText(/已逐筆保存並核對/)).toBeNull();
  expect(view.queryByRole('button', { name: '確認接續剩餘 2 筆行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(1);
  const replacement = { owner: `firebase:${mockUid}`, schoolId: mockSchool };
  expect(await originalGet(personalImportStorageKey(replacement))).toBeNull();
  expect(await readAssistantCalendarJournal(replacement, () => true)).toHaveLength(0);
  expectNoModelCalls();
});

test.each(['missing-time', 'overlap', 'compound'] as const)('an invalid %s row prevents any partial batch, attempt or ledger write', async (kind) => {
  const row = kind === 'missing-time' ? '明天安排英文讀書'
    : kind === 'overlap' ? '2099-01-02 19:30 到 20:30 程式練習'
      : '2099-01-02 20:00 到 21:00 程式練習並且付款';
  const question = '幫我安排以下行程：\n2099-01-02 19:00 到 20:00 英文讀書\n' + row;
  const reply = await askCampusAssistant({ scope: { uid: 'A', schoolId: 'pu' }, messages: [{ role: 'user', content: question }],
    isCurrent: () => true, mode: 'device' });
  expect(reply).toMatchObject({ tool: 'calendar-action', source: 'device', hasActions: false });
  expect(reply.calendarBatch).toBeUndefined();
  expect(reply.calendarTask).toBeUndefined();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expectNoModelCalls();
});

test.each(['batch-first', 'single-first'] as const)('single and batch cards share canonical completion when confirmation is %s', async (order) => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  if (order === 'batch-first') {
    await send(view, singleQuestion);
    await send(view, batchQuestion(2));
    await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入 2 筆行程' })));
  } else {
    await send(view, batchQuestion(2));
    await send(view, singleQuestion);
    await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
    await view.findByRole('button', { name: '確認接續剩餘 1 筆行程' });
    expect(view.getByText('已核對 1／2 筆行程')).toBeTruthy();
    await act(async () => fireEvent.press(view.getByRole('button', { name: '確認接續剩餘 1 筆行程' })));
  }
  await view.findByText('已逐筆保存並核對 2 筆行程。');
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(view.queryByText('正在保存並讀回核對行程…')).toBeNull();
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(2);
  expect(ledgerWrites()).toHaveLength(2);
  const first = ledger.records.find((row) => row.title === '英文讀書')!;
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: first.id });
  fireEvent.press(view.getByRole('button', { name: '查看行程：英文讀書' }));
  expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: first.id });
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(2);
  expectNoModelCalls();
});

test.each([
  { change: 'deleted', recheck: 'batch', copies: 2 },
  { change: 'changed', recheck: 'single-question', copies: 3 },
] as const)('a $change first event withdraws every related success after a $recheck recheck without recreating it', async ({ change, recheck, copies }) => {
  const view = render(<CampusAssistantScreen navigation={navigation()} />);
  await send(view, singleQuestion);
  await send(view, batchQuestion(2));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入 2 筆行程' })));
  await view.findByText('已逐筆保存並核對 2 筆行程。');
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  const initial = await loadPersonalImports(scope);
  const first = initial.records.find((row) => row.title === '英文讀書')!;
  const operationIds = (await readAssistantCalendarJournal(scope, () => true)).map((entry) => entry.proposal.mutationId);
  await act(async () => {
    if (change === 'deleted') await deletePersonalImport(scope, first);
    else await editPersonalImport(scope, first, { ...first, title: '使用者已修改的英文行程' });
  });
  const changedLedger = await originalGet(personalImportStorageKey(scope));
  jest.mocked(AsyncStorage.setItem).mockClear();

  if (recheck === 'batch') {
    await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對整份行程' })));
  } else {
    await send(view, singleQuestion);
  }
  await waitFor(() => {
    expect(view.queryByText('已逐筆保存並核對 2 筆行程。')).toBeNull();
    expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  });
  expect(view.getByText('已核對 1／2 筆行程')).toBeTruthy();
  const explanation = change === 'deleted' ? /目前沒有讀到這筆行程/ : /內容與確認草稿不同/;
  expect(view.getAllByText(explanation).length).toBeGreaterThanOrEqual(copies);
  expect(view.getAllByText(/歷史回執不代表目前仍有相同內容/)).toHaveLength(copies);
  expect(view.queryByRole('button', { name: '查看已建立的行程' })).toBeNull();
  expect(view.queryByRole('button', { name: '查看行程：英文讀書' })).toBeNull();
  expect(view.getByRole('button', { name: '查看行程：程式練習' })).toBeTruthy();
  expect(view.queryAllByRole('button', { name: /^確認(?:加入|接續)/u })).toHaveLength(0);
  expect((await readAssistantCalendarJournal(scope, () => true)).map((entry) => entry.proposal.mutationId))
    .toEqual(operationIds);
  expect(await originalGet(personalImportStorageKey(scope))).toBe(changedLedger);
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('batch review survives mode changes, remains outside cloud history and restores without cloud mode or approval', async () => {
  const view = render(<CampusAssistantScreen />);
  await send(view, batchQuestion(2));
  fireEvent.press(view.getByRole('tab', { name: '校園工具' }));
  fireEvent.press(view.getByText('校園即時 · 需網路'));
  expect(view.getByRole('button', { name: '確認加入 2 筆行程' })).toBeTruthy();
  await send(view, '說明校園助理的使用方式');
  expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
    messages: [{ role: 'user', content: '說明校園助理的使用方式' }],
  }));
  expect(view.getByRole('button', { name: '確認加入 2 筆行程' })).toBeTruthy();
  expect(ledgerWrites()).toHaveLength(0);
  view.unmount();
  const reopened = render(<CampusAssistantScreen />);
  await reopened.findByText('找回的多筆行程');
  await reopened.findByRole('button', { name: '確認加入 2 筆行程' });
  expect(reopened.getByText('靜宜大學 · 手機本地')).toBeTruthy();
  expect(reopened.queryByText('說明校園助理的使用方式')).toBeNull();
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(ledgerWrites()).toHaveLength(0);
  expect(mockCallable).toHaveBeenCalledTimes(1);
});
