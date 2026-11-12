import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment, NuniQuiz, NuniWorkspace } from '@campus/shared/src/nuni';
import { CampusAssistantScreen } from '../../screens/CampusAssistantScreen';
import { loadPersonalImports, personalImportStorageKey } from '../../services/personalImports';
import { readAssistantCalendarJournal } from '../../services/assistantCalendarJournal';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const accountId = `pa_${uuid(1)}`;
const workspaceId = `cw_${uuid(1)}`;
const assignmentId = `cwa_${uuid(1)}`;
const sessionContext = 'a'.repeat(43);
let mockAccountId = accountId;
let mockSchool = 'pu';
let mockContext = sessionContext;
let mockAssignment: NuniAssignment;
let mockExtraAssignments: NuniAssignment[] = [];
let mockQuizzes: NuniQuiz[] = [];
const mockRequest = jest.fn();
const mockBff = jest.fn();
const mockCallable = jest.fn();
const mockCollect = jest.fn();
const mockTimetable = jest.fn();
const mockPlatform = {
  get session() { return { platformAccountId: mockAccountId, context: mockContext }; },
  isSessionCurrent: (id: string, context: string) => id === mockAccountId && context === mockContext,
  request: (...args: unknown[]) => mockRequest(...args),
  bffRequest: (...args: unknown[]) => mockBff(...args),
};
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'campus-a' } }),
  getFunctionsInstance: () => ({}), isFirebaseMockMode: () => false,
}));
jest.mock('../../state/auth', () => ({ useAuth: () => ({ user: { uid: 'campus-a' } }) }));
jest.mock('../../state/school', () => ({ useSchool: () => ({
  selection: { schoolId: mockSchool },
  school: { id: mockSchool, name: '靜宜大學' }, selectionReady: true,
}) }));
jest.mock('../../state/nuniSession', () => ({ useOptionalNuniSession: () => mockPlatform }));
jest.mock('../../screens/AssistantClassNowHint', () => ({
  AssistantClassNowHint: ({ children }: { children: (upcoming: boolean) => React.ReactNode }) => children(false),
}));
jest.mock('../../screens/LegacyAssignmentReminders', () => ({ LegacyAssignmentReminders: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: (...args: unknown[]) => mockCollect(...args),
  formatOnDeviceSchoolPrompt: () => 'device context',
}));
jest.mock('../../services/assistantTimetableSource', () => ({
  readAssistantTimetable: (...args: unknown[]) => mockTimetable(...args),
}));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: false })), getSavedModelId: jest.fn(async () => null),
    getDownloadedModels: jest.fn(async () => []), isModelDownloaded: jest.fn(async () => false),
    getState: jest.fn(() => ({ status: 'idle' })), loadModel: jest.fn(), generate: jest.fn(),
  }, getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));

// The planner, exact-source bridge, slot reader, calendar executor and journal
// are real. Only API/native boundaries and the clock are substituted.
const workspace: NuniWorkspace = { id: workspaceId, title: '資料庫', state: 'active', memberRole: 'student' };
const record: PersonalImportRecord = {
  id: 'imported-db', kind: 'timetable', schoolId: 'pu', title: '資料庫',
  academicYear: '115', semester: '1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00',
  teacher: '張老師', courseCode: 'MIS302', className: '資管三甲', location: '305',
  linkedCourseId: workspaceId, importedAt: '2026-11-01T05:00:00Z', batchId: 'fixture',
  source: { type: 'paste', line: 1, rawText: '不應傳送的匯入原文' },
};
const reviewed = {
  workspaceId, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: `ccd_${uuid(1)}`, version: 1, workspaceId, verification: 'administrator-reviewed',
    title: '資料庫', schoolId: 'pu', academicYear: '115', semester: '1', teacher: '張老師',
    courseCode: 'MIS302', className: '資管三甲' },
};
const scope = { owner: `nuni:${accountId}`, schoolId: 'pu' };
const route = { name: 'NuniTimetableAssistant' };
const studyLabel = '安排「期末資料模型」的準備時間';
const slotLabel = '時段 1：2026-11-09 10:10–10:40（台灣時間）';
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function navigation() {
  let focused = true;
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  return {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['PersonalCalendar', 'NuniWorkspace', 'PersonalTimetable'] }),
    isFocused: () => focused,
    addListener: (event: 'focus' | 'blur', listener: () => void) => {
      listeners[event].add(listener);
      return () => { listeners[event].delete(listener); };
    },
    emit: (event: 'focus' | 'blur') => {
      focused = event === 'focus';
      [...listeners[event]].forEach((listener) => listener());
    },
  };
}
async function planned(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.queryByText('正在找回並核對先前的行程操作…')).toBeNull());
  await act(async () => fireEvent.press(view.getByRole('button', { name: '規劃未來七天' })));
  await view.findAllByRole('button', { name: studyLabel });
  expect(mockBff).toHaveBeenCalledWith(`class-workspaces/${workspaceId}/assignments`, sessionContext);
}
async function saveAndExpand(view: ReturnType<typeof render>) {
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  await view.findByText('計畫已儲存');
  fireEvent.press(view.getByRole('tab', { name: '已儲存計畫' }));
  fireEvent.press(await view.findByRole('button', { name: /^查看.*已處理 /u }));
  return view.findByRole('button', { name: '依目前資料重新規劃' });
}
async function selectStudySlot(view: ReturnType<typeof render>) {
  await act(async () => fireEvent.press(view.getAllByRole('button', { name: studyLabel })[0]!));
  const slot = await view.findByRole('button', { name: slotLabel });
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  fireEvent.press(slot);
  return view.findByRole('button', { name: '確認建立準備行程' });
}
async function pendingLookup(view: ReturnType<typeof render>, doubleTap = false) {
  const held = deferred<{ assignments: NuniAssignment[] }>();
  const before = mockBff.mock.calls.length;
  mockBff.mockImplementationOnce(() => held.promise);
  const action = view.getAllByRole('button', { name: studyLabel })[0]!;
  await act(async () => {
    fireEvent.press(action);
    if (doubleTap) fireEvent.press(action);
  });
  await waitFor(() => expect(mockBff).toHaveBeenCalledTimes(before + 1));
  await view.findByText('正在核對計畫中的作業…');
  return { held, before };
}
function expectNoModels() {
  expect(mockCallable).not.toHaveBeenCalled();
  expect(jest.requireMock('../../services/localLLMInference').localLLM.generate).not.toHaveBeenCalled();
}

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'performance', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-11-09T07:00:00+08:00'));
  mockAccountId = accountId; mockSchool = 'pu'; mockContext = sessionContext; mockQuizzes = []; mockExtraAssignments = [];
  mockAssignment = {
    id: assignmentId, workspaceId, title: '期末資料模型', createdAt: '2026-11-04T05:00:00Z',
    closedAt: null, dueAt: '2026-11-11T23:59:00+08:00', instructions: '不應送進模型的作業全文',
    state: 'open', unitId: null, unitTitle: null, mySubmission: null, submissionCount: 0,
  };
  mockCollect.mockReset().mockResolvedValue({
    ownerUid: '', checkedAt: new Date().toISOString(), schoolId: 'pu', schoolName: '靜宜大學',
    timetable: { source: 'saved-device-copy', updatedAt: record.importedAt, courses: [], currentClasses: [] },
  });
  mockTimetable.mockReset().mockResolvedValue({ timetable: null, schoolId: 'pu', updatedAt: record.importedAt,
    records: [record, { ...record, id: 'imported-web', title: '網頁設計', startTime: '13:00', endTime: '14:00',
      linkedCourseId: undefined, courseCode: 'MIS303' }] });
  mockRequest.mockReset().mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [workspace] };
    if (path === `class-workspaces/${workspaceId}`) return workspace;
    if (path === 'course-access/workspace-course') return reviewed;
    if (path === `class-workspaces/${workspaceId}/quizzes`) return { quizzes: mockQuizzes };
    throw new Error(`Unexpected course request: ${path}`);
  });
  mockBff.mockReset().mockImplementation(async (path: string) => {
    if (path === `class-workspaces/${workspaceId}/assignments`) return { assignments: [mockAssignment, ...mockExtraAssignments] };
    throw new Error(`Unexpected coursework request: ${path}`);
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('a real live plan rereads the selected assignment, saves one chosen slot and recovers its verified receipt', async () => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await planned(view);
  const plannedReads = mockBff.mock.calls.length;
  const savedReplan = await saveAndExpand(view);
  fireEvent.press(view.getByRole('tab', { name: '對話' }));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '下一個問題先留著');
  mockAssignment = { ...mockAssignment, title: '期末資料模型（修訂）' };
  const confirm = await selectStudySlot(view);
  expect(view.getByText('作業：期末資料模型（修訂）')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('下一個問題先留著');
  expect(mockBff).toHaveBeenCalledTimes(plannedReads + 2);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);

  const heldWrite = deferred<void>();
  let dispatched = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === personalImportStorageKey(scope)) { dispatched = true; await heldWrite.promise; }
    return originalSet(key, value);
  });
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
  await waitFor(() => expect(dispatched).toBe(true));
  const sourceReads = mockBff.mock.calls.length;
  const lockedActions = [
    view.getByRole('tab', { name: '已儲存計畫' }),
    view.getByRole('button', { name: '繼續已儲存的計畫（1）' }),
    savedReplan,
    ...view.getAllByRole('button', { name: '開啟課程與作業核對' }),
    ...view.getAllByRole('button', { name: studyLabel }),
  ];
  await act(async () => {
    for (const action of lockedActions) {
      expect(action.props.accessibilityState).toMatchObject({ disabled: true });
      fireEvent.press(action);
    }
  });
  expect(view.getByRole('tab', { name: '對話' }).props.accessibilityState.selected).toBe(true);
  expect(nav.navigate).not.toHaveBeenCalled();
  expect(mockBff).toHaveBeenCalledTimes(sourceReads);
  await act(async () => heldWrite.resolve(undefined));
  await view.findByText('已在這台手機保存並核對行程。');
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(1);
  expect(ledger.records[0]).toMatchObject({ title: '準備：期末資料模型（修訂）', date: '2026-11-09',
    startTime: '10:10', endTime: '10:40', source: { rawText: '' } });
  expect(ledgerWrites()).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
  expect(mockBff).toHaveBeenCalledTimes(plannedReads + 3);
  expect(mockBff.mock.calls).toEqual(Array.from({ length: plannedReads + 3 }, () =>
    [`class-workspaces/${workspaceId}/assignments`, sessionContext]));
  expectNoModels();
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: ledger.records[0]!.id });
  view.unmount();
  const reopened = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await reopened.findByText('已在這台手機保存並核對行程。');
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  expect(ledgerWrites()).toHaveLength(1);
});

test('double tapping a live plan starts one lookup and cancellation discards its late response', async () => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await planned(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '保留還沒送出的問題');
  const { held, before } = await pendingLookup(view, true);
  const routeAction = view.getAllByRole('button', { name: '開啟課程與作業核對' })[0]!;
  expect(routeAction.props.accessibilityState).toMatchObject({ disabled: true });
  fireEvent.press(routeAction);
  expect(nav.navigate).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '取消準備時間查詢' })));
  await view.findByText('已停止這次準備時間查詢，尚未建立行程。');
  await act(async () => held.resolve({ assignments: [mockAssignment] }));
  expect(mockBff).toHaveBeenCalledTimes(before + 1);
  expect(view.queryByRole('button', { name: slotLabel })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('保留還沒送出的問題');
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expectNoModels();
});

test.each(['account', 'school'] as const)('changing %s while a plan lookup waits cannot create an action in the new scope', async (change) => {
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await planned(view);
  const { held, before } = await pendingLookup(view);
  if (change === 'account') mockAccountId = `pa_${uuid(2)}`;
  else mockSchool = 'ncku';
  view.rerender(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await act(async () => held.resolve({ assignments: [mockAssignment] }));
  await waitFor(() => expect(view.queryByText('正在找回並核對先前的行程操作…')).toBeNull());
  expect(mockBff).toHaveBeenCalledTimes(before + 1);
  expect(view.queryByRole('button', { name: slotLabel })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(await readAssistantCalendarJournal({ owner: `nuni:${mockAccountId}`, schoolId: mockSchool }, () => true)).toHaveLength(0);
});

test('leaving and returning to the screen does not revive a pending plan lookup', async () => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await planned(view);
  const { held, before } = await pendingLookup(view);
  await act(async () => { nav.emit('blur'); nav.emit('focus'); });
  await view.findByText('已停止這次準備時間查詢，尚未建立行程。');
  await act(async () => held.resolve({ assignments: [mockAssignment] }));
  expect(mockBff).toHaveBeenCalledTimes(before + 1);
  expect(view.queryByRole('button', { name: slotLabel })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(nav.navigate).not.toHaveBeenCalled();
  expect(ledgerWrites()).toHaveLength(0);
});

test('restored historical plans show their checklist and replan action without an executable study entry', async () => {
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await planned(view);
  await saveAndExpand(view);
  view.unmount();
  const sourceReads = mockBff.mock.calls.length;
  const reopened = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await waitFor(() => expect(reopened.queryByText('正在找回並核對先前的行程操作…')).toBeNull());
  fireEvent.press(await reopened.findByRole('button', { name: '繼續已儲存的計畫（1）' }));
  fireEvent.press(await reopened.findByRole('button', { name: /^查看.*已處理 /u }));
  await reopened.findByRole('button', { name: '依目前資料重新規劃' });
  expect(reopened.getByRole('checkbox', { name: '我已處理：期末資料模型' })).toBeTruthy();
  expect(reopened.queryAllByRole('button', { name: /^安排「.*」的準備時間$/u, includeHiddenElements: true })).toHaveLength(0);
  expect(reopened.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(mockBff).toHaveBeenCalledTimes(sourceReads);
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
});

test('a live quiz retains its source-opening action without being treated as an assignment study action', async () => {
  mockQuizzes = [{ id: `cwq_${uuid(1)}`, workspaceId, title: '資料庫小考',
    createdAt: '2026-11-04T05:00:00Z', closedAt: null, dueAt: '2026-11-10T23:59:00+08:00',
    prompt: '不應傳送的測驗題目', state: 'open', unitId: null, unitTitle: null, myResponse: null, responseCount: 0 }];
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await planned(view);
  expect(view.getAllByRole('button', { name: '查看這份測驗' }).length).toBeGreaterThan(0);
  expect(view.queryByRole('button', { name: '安排「資料庫小考」的準備時間' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModels();
});

function addSecondAssignment() {
  mockExtraAssignments = [{ ...mockAssignment, id: `cwa_${uuid(2)}`, title: '資料正規化',
    dueAt: '2026-11-12T23:59:00+08:00' }];
}

async function selectStudyBatch(view: ReturnType<typeof render>) {
  await planned(view);
  expect(view.getAllByRole('checkbox', { name: /^選取作業：/u })).toHaveLength(2);
  fireEvent.press(view.getByRole('checkbox', { name: '選取作業：期末資料模型（資料庫）' }));
  expect(view.getByRole('button', { name: '預覽 1 份作業的準備安排' })).toBeDisabled();
  fireEvent.press(view.getByRole('checkbox', { name: '選取作業：資料正規化（資料庫）' }));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '預覽 2 份作業的準備安排' })));
  return view.findByRole('button', { name: '確認加入 2 筆行程' });
}

test('one live-plan confirmation schedules two real source-bound study events and restores their exact receipts', async () => {
  addSecondAssignment();
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  const confirm = await selectStudyBatch(view);
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(view.getByText('1. 準備：期末資料模型')).toBeTruthy();
  expect(view.getByText('2. 準備：資料正規化')).toBeTruthy();
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
  await view.findByText('已逐筆保存並核對 2 筆準備行程。');
  expect(ledgerWrites()).toHaveLength(2);
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: '準備：期末資料模型', date: '2026-11-09', startTime: '10:10', endTime: '10:40' }),
    expect.objectContaining({ title: '準備：資料正規化', date: '2026-11-09', startTime: '10:50', endTime: '11:20' }),
  ]));
  const journal = await readAssistantCalendarJournal(scope, () => true);
  expect(journal).toHaveLength(2);
  expect(journal[0].proposal.origin).toMatchObject({ kind: 'batch-step', batchId: expect.any(String), stepId: expect.any(String) });
  expect(journal[1].proposal.origin?.batchId).toBe(journal[0].proposal.origin?.batchId);
  expect(journal[1].proposal.origin?.stepId).not.toBe(journal[0].proposal.origin?.stepId);
  for (const event of ledger.records) {
    fireEvent.press(view.getByRole('button', { name: `查看行程：${event.title}` }));
    expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: event.id });
  }
  view.unmount();
  const reopened = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await reopened.findByText('已逐筆保存並核對 2 筆準備行程。');
  expect(ledgerWrites()).toHaveLength(2);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(2);
  expectNoModels();
});

test('the batch preflight rereads every selected source before the first write', async () => {
  addSecondAssignment();
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  const confirm = await selectStudyBatch(view);
  mockExtraAssignments[0] = { ...mockExtraAssignments[0], state: 'closed', closedAt: new Date().toISOString() };
  await act(async () => fireEvent.press(confirm));
  await waitFor(() => expect(view.queryByText('正在依序處理，完成一筆才會進入下一筆…')).toBeNull());
  expect(view.queryByText('已逐筆保存並核對 2 筆準備行程。')).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expectNoModels();
});

test('a source change after the first readback preserves its result and stops the next step', async () => {
  addSecondAssignment();
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  const confirm = await selectStudyBatch(view);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === personalImportStorageKey(scope)) {
      mockExtraAssignments[0] = { ...mockExtraAssignments[0], dueAt: '2026-11-10T23:59:00+08:00' };
    }
  });
  await act(async () => fireEvent.press(confirm));
  await waitFor(() => expect(view.queryByText('正在依序處理，完成一筆才會進入下一筆…')).toBeNull());
  expect(view.getByText('已核對 1／2 筆行程')).toBeTruthy();
  expect(view.getByText('尚未開始')).toBeTruthy();
  expect(ledgerWrites()).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
  view.unmount();
  const reopened = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await reopened.findByText('已核對 1／2 筆行程');
  expect(ledgerWrites()).toHaveLength(1);
  const resume = await reopened.findByRole('button', { name: '確認接續剩餘 1 筆行程' });
  await act(async () => fireEvent.press(resume));
  expect(ledgerWrites()).toHaveLength(1);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('a stopped batch resumes the unstarted source step after restart without recreating its first event', async () => {
  addSecondAssignment();
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  const confirm = await selectStudyBatch(view);
  const held = deferred<void>();
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === personalImportStorageKey(scope) && ledgerWrites().length === 1) await held.promise;
  });
  act(() => fireEvent.press(confirm));
  await waitFor(() => expect(ledgerWrites()).toHaveLength(1));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '停止後續行程' })));
  await act(async () => held.resolve());
  await waitFor(() => expect(view.queryByRole('button', { name: '停止後續行程' })).toBeNull());
  const firstId = (await loadPersonalImports(scope)).records[0].id;
  view.unmount();
  const reopened = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  const resume = await reopened.findByRole('button', { name: '確認接續剩餘 1 筆行程' });
  expect(ledgerWrites()).toHaveLength(1);
  await act(async () => fireEvent.press(resume));
  await reopened.findByText('已逐筆保存並核對 2 筆準備行程。');
  expect(ledgerWrites()).toHaveLength(2);
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(2);
  expect(ledger.records.filter((row) => row.id === firstId)).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(2);
});

test('cancelling the complete preview lookup keeps the composer draft and never creates a task', async () => {
  addSecondAssignment();
  const view = render(<CampusAssistantScreen route={route} navigation={navigation()} />);
  await planned(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '我稍後還要查公車');
  fireEvent.press(view.getByRole('checkbox', { name: '選取作業：期末資料模型（資料庫）' }));
  fireEvent.press(view.getByRole('checkbox', { name: '選取作業：資料正規化（資料庫）' }));
  const held = deferred<{ assignments: NuniAssignment[] }>();
  mockBff.mockImplementationOnce(() => held.promise);
  act(() => fireEvent.press(view.getByRole('button', { name: '預覽 2 份作業的準備安排' })));
  await view.findByText('正在核對作業並安排整體準備時間…');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '取消整體準備安排' })));
  await view.findByText('已停止這次整體準備安排，尚未建立行程。');
  await act(async () => held.resolve({ assignments: [mockAssignment, ...mockExtraAssignments] }));
  expect(view.getByLabelText('詢問校園助理')).toHaveProp('value', '我稍後還要查公車');
  expect(view.queryByRole('button', { name: '確認加入 2 筆行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
});

test('leaving during batch source preflight stops execution even when the reader resolves after returning', async () => {
  addSecondAssignment();
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  const confirm = await selectStudyBatch(view);
  const held = deferred<{ assignments: NuniAssignment[] }>();
  const reads = mockBff.mock.calls.length;
  mockBff.mockImplementationOnce(() => held.promise);
  act(() => fireEvent.press(confirm));
  await waitFor(() => expect(mockBff.mock.calls.length).toBeGreaterThan(reads));
  await act(async () => { nav.emit('blur'); nav.emit('focus'); });
  await waitFor(() => expect(view.queryByRole('button', { name: '停止後續行程' })).toBeNull());
  await act(async () => held.resolve({ assignments: [mockAssignment, ...mockExtraAssignments] }));
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(view.getByText('已核對 0／2 筆行程')).toBeTruthy();
  expect(view.queryByText('已逐筆保存並核對 2 筆準備行程。')).toBeNull();
});
