import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment } from '@campus/shared/src/nuni';
import { CampusAssistantScreen } from '../../screens/CampusAssistantScreen';
import { appendPersonalImports, loadPersonalImports, personalImportStorageKey } from '../../services/personalImports';
import { readAssistantCalendarJournal } from '../../services/assistantCalendarJournal';
import { notifyNuniAssignmentChanged } from '../../services/nuniAssignmentChanges';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const accountId = `pa_${uuid(1)}`;
const workspaceId = `cw_${uuid(1)}`;
const assignmentId = `cwa_${uuid(1)}`;
const sessionContext = 'a'.repeat(43);
let mockSchool = 'pu';
let mockContext = sessionContext;
const mockRequest = jest.fn();
const mockBff = jest.fn();
const mockCallable = jest.fn();
const mockCollect = jest.fn();
const mockTimetable = jest.fn();
const mockPlatform = {
  get session() { return { platformAccountId: accountId, context: mockContext }; },
  isSessionCurrent: (id: string, context: string) => id === accountId && context === mockContext,
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

const occurrence = {
  courseId: 'imported-db', name: '資料庫', date: '2026-11-05', term: '115|1', room: '305',
  startTime: '08:10', endTime: '10:00',
};
const record: PersonalImportRecord = {
  kind: 'timetable', schoolId: 'pu', id: occurrence.courseId, title: occurrence.name,
  batchId: 'fixture', academicYear: '115', semester: '1', dayOfWeek: 4, startPeriod: 1, endPeriod: 2,
  location: '305', linkedCourseId: workspaceId, importedAt: '2026-09-01T05:00:00Z',
  source: { type: 'paste', line: 1, rawText: '' },
};
const assignment = (fields: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: assignmentId, workspaceId, title: '期末資料模型', createdAt: '2026-11-04T05:00:00Z',
  closedAt: fields.state === 'closed' ? '2026-11-08T05:00:00Z' : null,
  dueAt: '2099-01-03T10:00:00Z', instructions: '不應送進模型的全文', state: 'open',
  unitId: null, unitTitle: null, mySubmission: null, submissionCount: 0, ...fields,
});
const scope = { owner: `nuni:${accountId}`, schoolId: 'pu' };
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const route = { name: 'NuniTimetableAssistant' };
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
const navigation = () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalCalendar', 'NuniWorkspace', 'PersonalTimetable'] }) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function send(view: ReturnType<typeof render>, question: string) {
  await waitFor(() => expect(view.queryByText('正在找回並核對先前的行程操作…')).toBeNull());
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), question);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '送出問題' })));
}
async function queried(view: ReturnType<typeof render>) {
  await send(view, '我現在有課嗎？');
  await send(view, '這堂課有什麼作業？');
  await view.findByRole('button', { name: '安排準備時間' });
}
async function reviewed(view: ReturnType<typeof render>) {
  await queried(view);
  await send(view, '幫這份作業 2099-01-02 19:00 到 19:30 安排準備');
  await view.findByRole('button', { name: '確認建立準備行程' });
}
beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockSchool = 'pu'; mockContext = sessionContext;
  mockCollect.mockResolvedValue({
    ownerUid: '', checkedAt: new Date().toISOString(), schoolId: 'pu', schoolName: '靜宜大學',
    timetable: { source: 'saved-device-copy', updatedAt: record.importedAt,
      courses: [], currentClasses: [occurrence] },
  });
  mockTimetable.mockResolvedValue({ timetable: null, schoolId: 'pu', updatedAt: record.importedAt, records: [record] });
  mockRequest.mockResolvedValue({ workspaces: [{ id: workspaceId, title: '資料庫 A 班', state: 'active', memberRole: 'student' }] });
  mockBff.mockResolvedValue({ assignments: [assignment()] });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function suggested(view: ReturnType<typeof render>) {
  await queried(view);
  await send(view, '幫這份作業找 30 分鐘準備時間');
  const choice = await view.findByRole('button', { name: '時段 1：2026-11-12 10:10–10:40（台灣時間）' });
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  fireEvent.press(choice);
  await view.findByRole('button', { name: '確認建立準備行程' });
}

function automaticTimetable() {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'performance', 'queueMicrotask'] });
  jest.setSystemTime(new Date('2026-11-09T07:00:00+08:00'));
  mockCollect.mockResolvedValue({ ownerUid: '', checkedAt: new Date().toISOString(), schoolId: 'pu', schoolName: '靜宜大學',
    timetable: { source: 'saved-device-copy', updatedAt: record.importedAt, courses: [], currentClasses: [occurrence] } });
  mockTimetable.mockResolvedValue({ timetable: null, schoolId: 'pu', updatedAt: record.importedAt, records: [record,
    { ...record, id: 'afternoon', title: '網頁設計', startPeriod: 6, endPeriod: 7, linkedCourseId: undefined },
  ] });
}

test('the real conversation finds a slot and saves its exact selection without typing dates or clocks', async () => {
  automaticTimetable();
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await suggested(view);
  expect(view.getByText(/依這台手機已存課表與個人行程，保留前後各 10 分鐘/)).toBeTruthy();
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  await view.findByText('已在這台手機保存並核對行程。');
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(1);
  expect(ledger.records[0]).toMatchObject({ title: '準備：期末資料模型', date: '2026-11-12', startTime: '10:10', endTime: '10:40' });
  expect(ledgerWrites()).toHaveLength(1);
  expect(mockBff).toHaveBeenCalledTimes(2);
  expect(mockCallable).not.toHaveBeenCalled();
  expect(jest.requireMock('../../services/localLLMInference').localLLM.generate).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: ledger.records[0]!.id });
  view.unmount();
  const reopened = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await reopened.findByText('已在這台手機保存並核對行程。');
  expect(ledgerWrites()).toHaveLength(1);
});

test('a personal event added after selecting an automatic slot blocks confirmation in the real conversation', async () => {
  automaticTimetable();
  const view = render(<CampusAssistantScreen route={route} />);
  await suggested(view);
  await act(async () => { await appendPersonalImports(scope, [{ id: 'other-plan', kind: 'events', schoolId: 'pu',
    academicYear: '', semester: '', title: '小組討論', date: '2026-11-12', startTime: '10:00', endTime: '11:00',
    source: { type: 'paste', line: 1, rawText: '' } }]); });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  await view.findByText(/課表或個人行程已更新/);
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  expect(ledgerWrites()).toHaveLength(1);
  expect((await loadPersonalImports(scope)).records.map((row) => row.title)).toEqual(['小組討論']);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
});

test('the real conversation carries an exact assignment through editable time, confirmation, ledger readback and restart', async () => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await queried(view);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '安排準備時間' })));
  fireEvent.changeText(view.getByLabelText('準備行程日期'), '2099-01-02');
  fireEvent.changeText(view.getByLabelText('準備行程開始時間'), '19:00');
  fireEvent.changeText(view.getByLabelText('準備行程結束時間'), '19:30');
  fireEvent.press(view.getByRole('button', { name: '預覽準備行程' }));
  expect(view.getByText('作業：期末資料模型')).toBeTruthy();
  expect(view.getByText('課程：資料庫 A 班')).toBeTruthy();
  expect(view.getByText(/作業參考期限：/)).toBeTruthy();
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(ledgerWrites()).toHaveLength(0);
  expect(mockBff).toHaveBeenCalledTimes(1);
  const confirm = view.getByRole('button', { name: '確認建立準備行程' });
  await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
  await view.findByText('已在這台手機保存並核對行程。');
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看原作業' }));
  expect(nav.navigate).toHaveBeenLastCalledWith('NuniWorkspace', {
    tab: 'courses', workspaceId, assignmentId, assistantAccountId: accountId,
  });
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(1);
  expect(ledger.records[0]).toMatchObject({ date: '2099-01-02', startTime: '19:00', endTime: '19:30' });
  expect(ledger.records[0]!.title).toContain('期末資料模型');
  expect(ledger.records[0]!.source.rawText).toBe('');
  expect(ledgerWrites()).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
  expect(mockRequest).toHaveBeenCalledTimes(2);
  expect(mockBff.mock.calls.map(([path]) => path)).toEqual(Array(2).fill(`class-workspaces/${workspaceId}/assignments`));
  expect(mockCallable).not.toHaveBeenCalled();
  expect(jest.requireMock('../../services/localLLMInference').localLLM.generate).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenLastCalledWith('PersonalCalendar', { eventId: ledger.records[0]!.id });
  act(() => notifyNuniAssignmentChanged({ accountId, context: sessionContext, workspaceId, assignmentId }));
  expect(view.getByText(/原作業後來有更新/)).toBeTruthy();
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  expect(view.queryByRole('button', { name: '預覽準備行程' })).toBeNull();
  view.unmount();
  const reopened = render(<CampusAssistantScreen route={route} navigation={nav} />);
  await reopened.findByText('已在這台手機保存並核對行程。');
  expect(reopened.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(1);
  expect(mockBff).toHaveBeenCalledTimes(2);
  expect((await loadPersonalImports({ owner: 'firebase:campus-a', schoolId: 'pu' })).records).toHaveLength(0);
});

test('same-name choices preserve the second assignment and its deadline after the receipt is handed to the conversation', async () => {
  mockBff.mockResolvedValue({ assignments: [assignment(), assignment({ id: `cwa_${uuid(2)}`, dueAt: '2099-01-04T10:00:00Z' })] });
  const view = render(<CampusAssistantScreen route={route} />);
  await queried(view);
  await send(view, '幫這份作業 2099-01-02 19:00 到 19:30 安排準備');
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: /^第 2 份：期末資料模型/ }));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  await view.findByText('已在這台手機保存並核對行程。');
  expect(view.getByText('作業參考期限：2099/1/4 下午6:00（台灣時間）')).toBeTruthy();
  expect(view.getByText('作業：期末資料模型')).toBeTruthy();
  expect(view.queryByRole('button', { name: /^第 1 份：/ })).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(1);
});

test.each([
  { title: '已變更題目' }, { dueAt: '2099-01-04T10:00:00Z' }, { state: 'closed' as const },
])('a source change after the actual preview prevents a calendar attempt: %j', async (change) => {
  const view = render(<CampusAssistantScreen route={route} />);
  await reviewed(view);
  mockBff.mockResolvedValue({ assignments: [assignment(change)] });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  await waitFor(() => expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull());
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  expect(view.getByRole('button', { name: '重新查詢作業' })).toBeTruthy();
});

test.each(['stop', 'session', 'notification'] as const)('a %s during fresh source lookup prevents a late calendar write', async (interruption) => {
  const view = render(<CampusAssistantScreen route={route} />);
  await reviewed(view);
  const pending = deferred<{ assignments: NuniAssignment[] }>();
  mockBff.mockReturnValueOnce(pending.promise);
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })); });
  await waitFor(() => expect(mockBff).toHaveBeenCalledTimes(2));
  if (interruption === 'stop') fireEvent.press(view.getByRole('button', { name: '停止後續處理' }));
  else if (interruption === 'session') {
    mockContext = 'b'.repeat(43);
    view.rerender(<CampusAssistantScreen route={route} />);
  } else act(() => notifyNuniAssignmentChanged({ accountId, context: sessionContext, workspaceId, assignmentId }));
  await act(async () => pending.resolve({ assignments: [assignment()] }));
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
});

test('an uncertain native save reaches the original read-only action card and later resolves without another write', async () => {
  const view = render(<CampusAssistantScreen route={route} />);
  await queried(view);
  await send(view, '幫這份作業 2099-01-02 20:00 到 20:30 安排準備');
  const key = personalImportStorageKey(scope);
  let saved = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key) { saved = true; throw new Error('lost reply'); }
  });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (storageKey) => {
    if (storageKey === key && saved) throw new Error('temporarily unavailable');
    return originalGet(storageKey);
  });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  await view.findByRole('button', { name: '重新核對行程' });
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(1);
  const before = await readAssistantCalendarJournal(scope, () => true);
  jest.mocked(AsyncStorage.getItem).mockImplementation(originalGet);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對行程' })));
  await view.findByText('已在這台手機保存並核對行程。');
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
  expect((await loadPersonalImports(scope)).records[0]!.id).toBe(before[0]!.proposal.mutationId);
  expect(ledgerWrites()).toHaveLength(1);
  expect(mockBff).toHaveBeenCalledTimes(2);
});

test.each(['stop', 'source'] as const)('a %s during dispatched native storage retains a path to the original late result', async (interruption) => {
  const view = render(<CampusAssistantScreen route={route} />);
  await queried(view);
  const hour = interruption === 'stop' ? '21' : '22';
  await send(view, `幫這份作業 2099-01-02 ${hour}:00 到 ${hour}:30 安排準備`);
  const target = personalImportStorageKey(scope);
  const held = deferred<void>(); let dispatched = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === target) { dispatched = true; await held.promise; }
    return originalSet(key, value);
  });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認建立準備行程' })));
  await waitFor(() => expect(dispatched).toBe(true));
  const journal = await readAssistantCalendarJournal(scope, () => true);
  expect(journal).toHaveLength(1);
  if (interruption === 'stop') fireEvent.press(view.getByRole('button', { name: '停止後續處理' }));
  else act(() => notifyNuniAssignmentChanged({ accountId, context: sessionContext, workspaceId, assignmentId }));
  const label = interruption === 'stop' ? '重新核對行程' : '核對行程紀錄';
  await view.findByRole('button', { name: label });
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
  await act(async () => held.resolve());
  await act(async () => fireEvent.press(view.getByRole('button', { name: label })));
  await view.findByText('已在這台手機保存並核對行程。');
  expect((await loadPersonalImports(scope)).records[0]!.id).toBe(journal[0]!.proposal.mutationId);
  expect(ledgerWrites()).toHaveLength(1);
  expect(mockBff).toHaveBeenCalledTimes(2);
});

test.each(['2099-01-03T18:00:00', '2099-02-30T18:00:00+08:00'])(
  'a permissively parsed platform deadline is not displayed as a verified exact time: %s', async (dueAt) => {
    mockBff.mockResolvedValue({ assignments: [assignment({ dueAt })] });
    const view = render(<CampusAssistantScreen route={route} />);
    await queried(view);
    await act(async () => fireEvent.press(view.getByRole('button', { name: '安排準備時間' })));
    expect(view.getByText('作業參考期限：尚無可核對的明確時間')).toBeTruthy();
    expect(view.getByText('這份作業沒有可核對的明確截止時間，請先到原作業確認。')).toBeTruthy();
    expect(view.queryByLabelText('準備行程日期')).toBeNull();
    expect(view.queryByRole('button', { name: '確認建立準備行程' })).toBeNull();
    expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(0);
    expect(ledgerWrites()).toHaveLength(0);
  },
);
