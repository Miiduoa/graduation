import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { askCampusAssistant, type CampusAssistantMessage } from '../../features/campusAssistant';
import { CampusAssistantScreen } from '../../screens/CampusAssistantScreen';
import { deletePersonalImport, editPersonalImport, loadPersonalImports, personalImportStorageKey } from '../../services/personalImports';
import { confirmAssistantCalendarTask } from '../../services/assistantCalendarExecution';

let mockUid: string | null = 'A';
let mockFake = false;
let mockSchool = 'pu';
let mockSelectionReady = true;
let mockPlatform: { session: { platformAccountId: string; context: string };
  isSessionCurrent: (id: string, context: string) => boolean; request: jest.Mock; bffRequest: jest.Mock } | null = null;
const mockCallable = jest.fn();
const mockCollect = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: jest.fn(() => ({ currentUser: mockUid ? { uid: mockUid } : null })),
  getFunctionsInstance: jest.fn(() => ({})), isFirebaseMockMode: () => mockFake,
}));
jest.mock('../../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../../state/school', () => ({ useSchool: () => ({
  school: { id: mockSchool, name: '靜宜大學' }, selectionReady: mockSelectionReady,
}) }));
jest.mock('../../state/nuniSession', () => ({ useOptionalNuniSession: () => mockPlatform }));
jest.mock('../../screens/AssistantClassNowHint', () => ({
  AssistantClassNowHint: ({ children }: { children: (upcoming: boolean) => React.ReactNode }) => children(false),
}));
jest.mock('../../screens/LegacyAssignmentReminders', () => ({ LegacyAssignmentReminders: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: (...args: unknown[]) => mockCollect(...args), formatOnDeviceSchoolPrompt: () => 'device context',
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
const request = '幫我明天 19:00 到 20:00 安排英文讀書';
const question = (content: string): CampusAssistantMessage[] => [{ role: 'user', content }];
const input = (content = request) => ({ scope: { uid: 'A', schoolId: 'pu' }, messages: question(content),
  isCurrent: () => true, mode: 'device' as const });
const platform = (content = request) => ({ ...input(content), scope: { uid: '', schoolId: 'pu' },
  platformTimetable: { accountId: 'platform-a', isCurrent: () => true } });
const ledgerReads = () => jest.mocked(AsyncStorage.getItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUid = 'A'; mockFake = false; mockSchool = 'pu'; mockSelectionReady = true; mockPlatform = null;
  mockCallable.mockResolvedValue({ data: { content: '一般回答', run: { status: 'completed' }, actions: [] } });
  mockCollect.mockImplementation(async ({ uid, schoolId }) => ({ ownerUid: uid,
    checkedAt: new Date().toISOString(), schoolId, schoolName: '靜宜大學',
    timetable: { source: 'not-available', updatedAt: null, courses: [] } }));
});
afterEach(() => jest.restoreAllMocks());

test.each(['device', 'campus', 'platform'] as const)('%s explicit appointment returns a review before any model, network or ledger access', async (mode) => {
  const args = mode === 'platform' ? platform() : { ...input(), mode };
  const reply = await askCampusAssistant(args);
  expect(reply).toMatchObject({ source: 'device', tool: 'calendar-action', hasActions: false,
    calendarTask: { state: 'review', proposal: { owner: mode === 'platform' ? 'nuni:platform-a' : 'firebase:A',
      schoolId: 'pu', event: { title: '英文讀書', startTime: '19:00', endTime: '20:00', allDay: false } } } });
  expect(ledgerReads()).toHaveLength(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  const { localLLM } = jest.requireMock('../../services/localLLMInference');
  expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test.each(['guest', 'mock'] as const)('%s cannot obtain a private calendar execution proposal', async (kind) => {
  if (kind === 'guest') mockUid = null; else mockFake = true;
  const reply = await askCampusAssistant({ ...input(), scope: { uid: kind === 'guest' ? '' : 'A', schoolId: 'pu' } });
  expect(reply.content).toContain('請先登入');
  expect(reply.calendarTask).toBeUndefined();
  expect(reply.serviceSelection).toEqual({ kind: 'open', serviceIds: ['account'] });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('a repeated request reuses the original unknown operation instead of minting a second create ID', async () => {
  const first = await askCampusAssistant(platform());
  const calendarTask = first.calendarTask!;
  const history: CampusAssistantMessage[] = [...question(request), { role: 'assistant', ...first,
    calendarTask: { proposal: calendarTask.proposal, state: 'unknown', reason: 'unavailable', message: '待核對' } }, ...question(request)];
  const again = await askCampusAssistant({ ...platform(), messages: history });
  expect(again.calendarTask).toEqual(history[1].calendarTask);
  expect(ledgerReads()).toHaveLength(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a cancelled draft can be proposed again, but never changes another owner or school task', async () => {
  const first = await askCampusAssistant(platform());
  const task = first.calendarTask!;
  for (const stale of [
    { proposal: task.proposal, state: 'cancelled' as const },
    { proposal: { ...task.proposal, owner: 'nuni:other' }, state: 'review' as const },
    { proposal: { ...task.proposal, schoolId: 'nthu' }, state: 'review' as const },
  ]) {
    const again = await askCampusAssistant({ ...platform(), messages: [{ role: 'assistant', content: '舊草稿', calendarTask: stale }, ...question(request)] });
    expect(again.calendarTask?.proposal.mutationId).not.toBe(task.proposal.mutationId);
    expect(again.calendarTask?.proposal).toMatchObject({ owner: 'nuni:platform-a', schoolId: 'pu' });
  }
});

test('the existing read-only study plan remains a plan and never becomes a calendar mutation', async () => {
  mockCollect.mockResolvedValueOnce({ ownerUid: 'A', schoolId: 'pu', schoolName: '靜宜大學', checkedAt: new Date().toISOString(),
    timetable: { source: 'saved-device-copy', updatedAt: new Date().toISOString(), courses: [{ name: '英文', day: 1, start: 1, end: 2 }] } });
  const reply = await askCampusAssistant(input('請依手機儲存的課表整理學習安排'));
  expect(reply.calendarTask).toBeUndefined();
  expect(reply.tool).toBe('campus-plan');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a later campus request excludes the local calendar question and receipt from cloud history', async () => {
  const first = await askCampusAssistant(input());
  await askCampusAssistant({ ...input(), mode: 'campus', messages: [
    ...question(request), { role: 'assistant', ...first }, ...question('這週有哪些校園活動？'),
  ] });
  expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ messages: question('這週有哪些校園活動？') }));
});

test.each(['deleted', 'edited'] as const)('asking again after the actual calendar row is %s checks the old ID and never recreates it', async (change) => {
  const first = await askCampusAssistant(input());
  const context = { ...input().scope, isCurrent: () => true };
  const verified = await confirmAssistantCalendarTask(first.calendarTask!.proposal, context);
  if (verified.state !== 'verified') throw new Error('missing receipt');
  const scope = { owner: 'firebase:A', schoolId: 'pu' };
  const stored = (await loadPersonalImports(scope)).records[0];
  if (change === 'deleted') await deletePersonalImport(scope, stored);
  else await editPersonalImport(scope, stored, { ...stored, title: '使用者已修改的行程' });
  jest.mocked(AsyncStorage.setItem).mockClear();
  const again = await askCampusAssistant({ ...input(), messages: [
    ...question(request), { role: 'assistant', ...first, calendarTask: verified }, ...question(request),
  ] });
  expect(again.calendarTask).toMatchObject({ state: 'unknown', reason: change === 'deleted' ? 'absent' : 'changed',
    proposal: { mutationId: verified.proposal.mutationId }, lastVerified: verified.receipt });
  expect(ledgerWrites()).toHaveLength(0);
  expect(mockCallable).not.toHaveBeenCalled();
});

test('asking again when storage cannot be read retains the previous successful receipt and verification time', async () => {
  const first = await askCampusAssistant(input());
  const verified = await confirmAssistantCalendarTask(first.calendarTask!.proposal, { ...input().scope, isCurrent: () => true });
  if (verified.state !== 'verified') throw new Error('missing receipt');
  const ledgerKey = personalImportStorageKey({ owner: 'firebase:A', schoolId: 'pu' });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
    if (key === ledgerKey) throw new Error('unavailable');
    return originalGet(key);
  });
  const again = await askCampusAssistant({ ...input(), messages: [
    ...question(request), { role: 'assistant', ...first, calendarTask: verified }, ...question(request),
  ] });
  expect(again.calendarTask).toMatchObject({ state: 'verified', receipt: verified.receipt,
    warning: expect.stringContaining('目前內容尚未重新確認') });
  expect(ledgerWrites()).toHaveLength(1);
});

function setupPlatform() {
  mockPlatform = { session: { platformAccountId: 'platform-a', context: 'ctx-a' },
    isSessionCurrent: (id, context) => id === 'platform-a' && context === 'ctx-a', request: jest.fn(), bffRequest: jest.fn() };
}
async function send(view: ReturnType<typeof render>, text: string) {
  if (mockSelectionReady) await waitFor(() => expect(view.getByLabelText('詢問校園助理').props.editable).not.toBe(false));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), text);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '送出問題' })));
}
test.each(['campus', 'dual-login-platform'] as const)('real %s conversation completes review → persistence → receipt → exact calendar and retains it after the next question', async (audience) => {
  if (audience === 'dual-login-platform') setupPlatform(); // Firebase A remains signed in.
  const nav = { navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalCalendar', 'Map'] }) };
  const view = render(<CampusAssistantScreen navigation={nav}
    route={{ name: audience === 'campus' ? 'CampusAssistant' : 'NuniTimetableAssistant' }} />);
  await send(view, request);
  expect(view.getByRole('button', { name: '確認加入個人行事曆' })).toBeTruthy();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  const owner = audience === 'campus' ? 'firebase:A' : 'nuni:platform-a';
  const ledger = await loadPersonalImports({ owner, schoolId: 'pu' });
  expect(ledger.records).toHaveLength(1);
  expect(ledgerWrites().map(([key]) => key)).toEqual([personalImportStorageKey({ owner, schoolId: 'pu' })]);
  await send(view, '打開校園地圖');
  expect(view.getByText('已在這台手機保存並核對行程。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenCalledWith('PersonalCalendar', { eventId: ledger.records[0].id });
  expect(mockCallable).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  if (mockPlatform) expect(mockPlatform.request).not.toHaveBeenCalled();
  expect(jest.requireMock('../../services/localLLMInference').localLLM.generate).not.toHaveBeenCalled();
});

test('a school change removes old action controls before the draft can write', async () => {
  setupPlatform();
  const props = { route: { name: 'NuniTimetableAssistant' } };
  const view = render(<CampusAssistantScreen {...props} />);
  await send(view, request);
  expect(view.getByRole('button', { name: '確認加入個人行事曆' })).toBeTruthy();
  mockSchool = 'nthu';
  view.rerender(<CampusAssistantScreen {...props} />);
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('reasking after deletion updates the older conversation card instead of leaving a stale success control', async () => {
  const view = render(<CampusAssistantScreen />);
  await send(view, request);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  const scope = { owner: 'firebase:A', schoolId: 'pu' };
  const ledger = await loadPersonalImports(scope);
  await deletePersonalImport(scope, ledger.records[0]);
  jest.mocked(AsyncStorage.setItem).mockClear();
  await send(view, request);
  expect(view.queryByText('已在這台手機保存並核對行程。')).toBeNull();
  expect(view.queryByRole('button', { name: '查看已建立的行程' })).toBeNull();
  expect(view.getAllByText(/目前沒有讀到這筆行程/)).toHaveLength(2);
  expect(view.getAllByText(/歷史回執不代表目前仍有相同內容/)).toHaveLength(2);
  expect(ledgerWrites()).toHaveLength(0);
});

test('an unresolved school selection cannot create a proposal against its temporary school value', async () => {
  setupPlatform(); mockSelectionReady = false;
  const view = render(<CampusAssistantScreen route={{ name: 'NuniTimetableAssistant' }} />);
  await send(view, request);
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
