import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { askCampusAssistant } from '../../features/campusAssistant';
import { CampusAssistantScreen } from '../../screens/CampusAssistantScreen';
import {
  assistantCalendarJournalStorageKey, readAssistantCalendarJournal,
  reserveAssistantCalendarAttempt, saveAssistantCalendarJournalObservation,
} from '../../services/assistantCalendarJournal';
import type { AssistantCalendarProposal } from '../../services/assistantCalendarExecution';
import { assistantCalendarBatchStorageKey } from '../../services/assistantCalendarBatchStore';
import { personalImportStorageKey } from '../../services/personalImports';
import { savedCampusPlansStorageKey } from '../../services/savedCampusPlans';

let mockUid: string | null = 'A';
let mockFake = false;
let mockSchool = 'pu';
let mockSelectionReady = true;
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
  getFunctionsInstance: () => ({}), isFirebaseMockMode: () => mockFake,
}));
jest.mock('../../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../../state/school', () => ({ useSchool: () => ({
  school: { id: mockSchool, name: mockSchool === 'pu' ? '靜宜大學' : '其他學校' },
  selectionReady: mockSelectionReady,
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
const RECOVERING = '正在找回並核對先前的行程操作…';
const VERIFIED = '已在這台手機保存並核對行程。';
const question = '幫我 2099-01-02 19:00 到 20:00 安排英文讀書';
const event = { title: '英文讀書', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' };
const createdAt = '2026-11-07T00:00:00.000Z';
let serial = 0;
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
const scopeFor = (proposal: AssistantCalendarProposal) => ({ owner: proposal.owner, schoolId: proposal.schoolId });

function proposal(owner = 'firebase:A', schoolId = 'pu', title = event.title): AssistantCalendarProposal {
  return { owner, schoolId, mutationId: `aev_recovery_${++serial}`, createdAt, event: { ...event, title } };
}
function recordFor(value: AssistantCalendarProposal) {
  return { ...value.event, id: value.mutationId, batchId: value.mutationId, kind: 'events' as const,
    schoolId: value.schoolId, academicYear: '', semester: '', importedAt: value.createdAt,
    source: { type: 'paste' as const, name: '助理行程', line: 1, rawText: '' } };
}
async function seedPending(value = proposal()) {
  // Seed only durable evidence, without executing confirm or touching its
  // process-local attempted set. A new screen must recover from storage alone.
  await reserveAssistantCalendarAttempt(value, () => true);
  return value;
}
async function seedRow(value: AssistantCalendarProposal, title = value.event.title) {
  const record = { ...recordFor(value), title };
  await originalSet(personalImportStorageKey(scopeFor(value)), JSON.stringify({
    version: 1, records: [record], batches: [{ id: value.mutationId, createdAt, count: 1 }],
  }));
  return record;
}
function setupPlatform(context = 'a'.repeat(43)) {
  mockPlatform = {
    session: { platformAccountId: 'platform-a', context },
    isSessionCurrent: (id, candidate) => mockPlatform?.session.platformAccountId === id &&
      mockPlatform.session.context === candidate,
    request: jest.fn(), bffRequest: jest.fn(),
  };
}
function navigation() {
  return { navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalCalendar', 'Map', 'MapV2'] }) };
}
async function ready(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.queryByText(RECOVERING)).toBeNull());
}
async function send(view: ReturnType<typeof render>, text: string) {
  await ready(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), text);
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUid = 'A'; mockFake = false; mockSchool = 'pu'; mockSelectionReady = true; mockPlatform = null;
  mockCallable.mockResolvedValue({ data: { content: '一般回答', run: { status: 'completed' }, actions: [] } });
});
afterEach(() => jest.restoreAllMocks());

test.each(['campus', 'dual-login-platform'] as const)('a fresh %s screen restores the original operation using only scoped storage and exact readback', async (audience) => {
  const owner = audience === 'campus' ? 'firebase:A' : 'nuni:platform-a';
  const value = await seedPending(proposal(owner));
  await seedRow(value);
  if (audience === 'dual-login-platform') {
    // The signed-in Firebase account is not this route's storage authority.
    await seedPending(proposal('firebase:A', 'pu', '另一個帳號的私人行程'));
    setupPlatform();
  }
  jest.clearAllMocks();
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav}
    route={{ name: audience === 'campus' ? 'CampusAssistant' : 'NuniTimetableAssistant' }} />);
  expect(view.queryByText(VERIFIED)).toBeNull();
  await view.findByText(VERIFIED);
  expect(view.getByText('找回的行程紀錄')).toBeTruthy();
  expect(view.queryByText('另一個帳號的私人行程')).toBeNull();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(view.queryByRole('button', { name: '先不要' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
  expect(nav.navigate).toHaveBeenCalledWith('PersonalCalendar', { eventId: value.mutationId });
  const allowed = new Set([assistantCalendarJournalStorageKey(scopeFor(value)), personalImportStorageKey(scopeFor(value)),
    assistantCalendarBatchStorageKey(scopeFor(value)), savedCampusPlansStorageKey(scopeFor(value))]);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.length).toBeGreaterThan(0);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.every(([key]) => allowed.has(key))).toBe(true);
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test.each(['absent', 'changed', 'unavailable'] as const)('restoring a %s row cannot inherit permission to confirm or recreate it', async (result) => {
  const value = await seedPending();
  const scope = scopeFor(value);
  if (result === 'changed') await seedRow(value, '使用者修改的行程');
  if (result === 'unavailable') {
    const receipt = createAssistantCalendarReceipt({ schoolId: value.schoolId, mutationId: value.mutationId,
      event: value.event, storage: 'device', record: recordFor(value), verifiedAt: createdAt });
    await saveAssistantCalendarJournalObservation(value, { state: 'verified', checkedAt: createdAt, receipt }, () => true);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
      if (key === personalImportStorageKey(scope)) throw new Error('native storage unavailable');
      return originalGet(key);
    });
  }
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen />);
  await view.findByRole('button', { name: '重新核對行程' });
  expect(view.queryByText(VERIFIED)).toBeNull();
  expect(view.queryByRole('button', { name: '查看已建立的行程' })).toBeNull();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(view.queryByRole('button', { name: '先不要' })).toBeNull();
  if (result === 'absent') expect(view.getByText(/目前沒有讀到這筆行程/)).toBeTruthy();
  if (result === 'changed') expect(view.getByText(/內容與確認草稿不同/)).toBeTruthy();
  if (result === 'unavailable') expect(view.getByText(/歷史回執不代表目前仍有相同內容/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對行程' })));
  expect(ledgerWrites()).toHaveLength(0);
  expect((await readAssistantCalendarJournal(scope, () => true)).map((entry) => entry.proposal.mutationId))
    .toEqual([value.mutationId]);
  expectNoModelCalls();
});

test('an empty conversation reuses a persisted absent operation, and the screen renders that ID only once after asking again', async () => {
  const value = await seedPending();
  jest.clearAllMocks();
  const answer = await askCampusAssistant({ scope: { uid: 'A', schoolId: 'pu' }, isCurrent: () => true,
    messages: [{ role: 'user', content: question }], mode: 'device' });
  expect(answer.calendarTask).toMatchObject({ state: 'unknown', reason: 'absent', proposal: value });
  const view = render(<CampusAssistantScreen />);
  await view.findByRole('button', { name: '重新核對行程' });
  await send(view, question);
  expect(view.getAllByText(value.event.title)).toHaveLength(1);
  expect(view.getAllByRole('button', { name: '重新核對行程' })).toHaveLength(1);
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('the initial 16-card display limit preserves older operations for expansion and empty-history reuse', async () => {
  const entries: AssistantCalendarProposal[] = [];
  for (let index = 0; index < 17; index += 1) {
    entries.push(await seedPending({ ...proposal('firebase:A', 'pu', index ? `第${index}次讀書` : '較早的英文讀書'),
      createdAt: new Date(Date.parse(createdAt) + index * 60_000).toISOString() }));
  }
  const oldest = entries[0]!;
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen />);
  const more = await view.findByRole('button', { name: '顯示更多行程紀錄（1）' });
  expect(view.getAllByRole('button', { name: '重新核對行程' })).toHaveLength(16);
  expect(view.queryByText(oldest.event.title)).toBeNull();

  const answer = await askCampusAssistant({ scope: { uid: 'A', schoolId: 'pu' }, isCurrent: () => true,
    messages: [{ role: 'user', content: `幫我 2099-01-02 19:00 到 20:00 安排${oldest.event.title}` }], mode: 'device' });
  expect(answer.calendarTask).toMatchObject({ state: 'unknown', reason: 'absent', proposal: oldest });
  fireEvent.press(more);
  expect(view.getByText(oldest.event.title)).toBeTruthy();
  expect(view.getAllByRole('button', { name: '重新核對行程' })).toHaveLength(17);
  expect(view.queryByRole('button', { name: '顯示更多行程紀錄（1）' })).toBeNull();
  expect(await readAssistantCalendarJournal(scopeFor(oldest), () => true)).toHaveLength(17);
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('a pending journal read blocks a new send until original operations have been recovered', async () => {
  const value = await seedPending();
  await seedRow(value);
  const journalKey = assistantCalendarJournalStorageKey(scopeFor(value));
  const raw = await originalGet(journalKey);
  const gate = deferred<string | null>();
  let held = false;
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) => {
    if (key === journalKey && !held) { held = true; return gate.promise; }
    return originalGet(key);
  });
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledWith(journalKey));
  expect(view.getByText(RECOVERING)).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.editable).toBe(false);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), question);
  const sendButton = view.queryByRole('button', { name: '送出問題' });
  if (sendButton) fireEvent.press(sendButton);
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(view.queryByText(VERIFIED)).toBeNull();
  await act(async () => gate.resolve(raw));
  await view.findByText(VERIFIED);
  expect(view.queryByText(question)).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test.each(['account', 'school'] as const)('a late recovery from the old %s is discarded without clearing its journal', async (change) => {
  const value = await seedPending(proposal('firebase:A', 'pu', '舊範圍的私人行程'));
  await seedRow(value);
  const journalKey = assistantCalendarJournalStorageKey(scopeFor(value));
  const raw = await originalGet(journalKey);
  const gate = deferred<string | null>();
  let held = false;
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) => {
    if (key === journalKey && !held) { held = true; return gate.promise; }
    return originalGet(key);
  });
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledWith(journalKey));
  if (change === 'account') mockUid = 'B'; else mockSchool = 'nthu';
  view.rerender(<CampusAssistantScreen />);
  await ready(view);
  await act(async () => gate.resolve(raw));
  expect(view.queryByText(value.event.title)).toBeNull();
  expect(view.queryByText(VERIFIED)).toBeNull();
  expect(view.queryByRole('button', { name: '重新核對行程' })).toBeNull();
  expect(await originalGet(journalKey)).toBe(raw);
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('a renewed platform session can recover the same account, but a late old-session read cannot replace its fresh absence', async () => {
  setupPlatform();
  const value = await seedPending(proposal('nuni:platform-a'));
  await seedRow(value);
  const ledgerKey = personalImportStorageKey(scopeFor(value));
  const oldLedger = await originalGet(ledgerKey);
  const gate = deferred<string | null>();
  let held = false;
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) => {
    if (key === ledgerKey && !held) { held = true; return gate.promise; }
    return originalGet(key);
  });
  jest.clearAllMocks();
  const props = { route: { name: 'NuniTimetableAssistant' } };
  const view = render(<CampusAssistantScreen {...props} />);
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledWith(ledgerKey));
  await originalSet(ledgerKey, JSON.stringify({ version: 1, records: [], batches: [] }));
  setupPlatform('b'.repeat(43));
  view.rerender(<CampusAssistantScreen {...props} />);
  await view.findByText(/目前沒有讀到這筆行程/);
  await act(async () => gate.resolve(oldLedger));
  expect(view.getByText(value.event.title)).toBeTruthy();
  expect(view.getByText(/目前沒有讀到這筆行程/)).toBeTruthy();
  expect(view.queryByText(VERIFIED)).toBeNull();
  expect(view.queryByRole('button', { name: '查看已建立的行程' })).toBeNull();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('a failed durable reservation stops confirmation before any calendar write', async () => {
  const view = render(<CampusAssistantScreen />);
  await send(view, question);
  expect(view.getByRole('button', { name: '確認加入個人行事曆' })).toBeTruthy();
  const journalKey = assistantCalendarJournalStorageKey({ owner: 'firebase:A', schoolId: 'pu' });
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === journalKey) throw new Error('quota exceeded');
    return originalSet(key, value);
  });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  expect(view.queryByText(VERIFIED)).toBeNull();
  expect(view.getAllByRole('alert').length).toBeGreaterThan(0);
  expect(ledgerWrites()).toHaveLength(0);
  expect(await originalGet(personalImportStorageKey({ owner: 'firebase:A', schoolId: 'pu' }))).toBeNull();
  expectNoModelCalls();
});

test.each(['reserved', 'already-saved'] as const)('a review adopts the original ID when another screen has %s the same event', async (otherScreen) => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await send(view, question);
  expect(view.getByRole('button', { name: '確認加入個人行事曆' })).toBeTruthy();
  // The on-screen draft predates this distinct operation. Confirmation must
  // follow the durable event's ID and update the old card out of saving state.
  const canonical = await seedPending();
  if (otherScreen === 'already-saved') await seedRow(canonical);
  jest.clearAllMocks();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '確認加入個人行事曆' })));
  if (otherScreen === 'already-saved') {
    await view.findByText(VERIFIED);
    fireEvent.press(view.getByRole('button', { name: '查看已建立的行程' }));
    expect(nav.navigate).toHaveBeenCalledWith('PersonalCalendar', { eventId: canonical.mutationId });
  } else {
    await view.findByText(/目前沒有讀到這筆行程/);
    expect(view.getByRole('button', { name: '重新核對行程' })).toBeTruthy();
    expect(view.queryByText(VERIFIED)).toBeNull();
  }
  expect(view.queryByText('正在保存並讀回核對行程…')).toBeNull();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(view.getAllByText(event.title)).toHaveLength(1);
  expect((await readAssistantCalendarJournal(scopeFor(canonical), () => true)).map((entry) => entry.proposal.mutationId))
    .toEqual([canonical.mutationId]);
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('journal load failure offers retry and permits service questions while new calendar proposals fail closed', async () => {
  const value = await seedPending();
  const journalKey = assistantCalendarJournalStorageKey(scopeFor(value));
  let unavailable = true;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
    if (key === journalKey && unavailable) throw new Error('native read unavailable');
    return originalGet(key);
  });
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen navigation={navigation()} />);
  await view.findByRole('button', { name: '重新載入行程紀錄' });
  await send(view, '打開校園地圖');
  expect(view.getByText('打開校園地圖')).toBeTruthy();
  await send(view, question);
  expect(view.getByText(/暫時無法建立新的行程草稿/)).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  unavailable = false;
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新載入行程紀錄' })));
  await view.findByRole('button', { name: '重新核對行程' });
  expect(view.getByText(value.event.title)).toBeTruthy();
  expect(ledgerWrites()).toHaveLength(0);
  expectNoModelCalls();
});

test('restored task records survive a mode switch without becoming cloud conversation history or approval', async () => {
  const value = await seedPending();
  await seedRow(value);
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen />);
  await view.findByText(VERIFIED);
  fireEvent.press(view.getByRole('tab', { name: '校園工具' }));
  fireEvent.press(view.getByText('校園即時 · 需網路'));
  expect(view.getByText(VERIFIED)).toBeTruthy();
  await send(view, '說明校園助理的使用方式');
  expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
    messages: [{ role: 'user', content: '說明校園助理的使用方式' }],
    context: expect.objectContaining({ sessionId: expect.any(String) }),
  }));
  expect(view.getByText(VERIFIED)).toBeTruthy();
  expect(view.queryByRole('button', { name: '確認加入個人行事曆' })).toBeNull();
  expect(ledgerWrites()).toHaveLength(0);
});

test.each(['guest', 'mock', 'unresolved'] as const)('a %s screen never reads or exposes a private recovery journal', async (kind) => {
  const value = await seedPending(proposal('firebase:A', 'pu', '不應顯示的私人行程'));
  if (kind === 'guest') mockUid = null;
  if (kind === 'mock') mockFake = true;
  if (kind === 'unresolved') mockSelectionReady = false;
  jest.clearAllMocks();
  const view = render(<CampusAssistantScreen />);
  await ready(view);
  expect(view.queryByText(value.event.title)).toBeNull();
  expect(view.queryByText('找回的行程紀錄')).toBeNull();
  const calendarKeys = new Set([assistantCalendarJournalStorageKey(scopeFor(value)),
    assistantCalendarBatchStorageKey(scopeFor(value)), personalImportStorageKey(scopeFor(value))]);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.every(([key]) =>
    !calendarKeys.has(String(key)))).toBe(true);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expectNoModelCalls();
});
