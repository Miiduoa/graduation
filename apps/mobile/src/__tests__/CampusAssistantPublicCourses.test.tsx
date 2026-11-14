import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { AIOverlayHost } from '../components/AIOverlayHost';

let mockUid: string | null = 'student-a';
let mockSchool = 'pu';
let mockRootReady = false;
let mockPublicReady = false;
let mockOverlayPrompt = '幫我查清大的資料庫課程';
const mockRootDispatch = jest.fn();
const mockPublicDispatch = jest.fn();
const mockClose = jest.fn();
const mockCallable = jest.fn();
jest.mock('../app/rootNavigation', () => ({
  rootNavigationRef: {
    isReady: () => mockRootReady,
    getRootState: () => ({ routeNames: ['Today', '學習', '我的'] }),
    dispatch: (action: unknown) => mockRootDispatch(action),
  },
  subscribeSchoolNavigationReady: () => () => {},
}));
jest.mock('../app/publicNavigation', () => ({
  isPublicNavigationReady: () => mockPublicReady,
  publicNavigationRef: {
    isReady: () => mockPublicReady,
    getRootState: () => ({ routeNames: ['LoginLanding', 'CourseCatalog', 'PersonalImport'] }),
    dispatch: (action: unknown) => mockPublicDispatch(action),
  },
  subscribePublicNavigationReady: () => () => {},
}));
jest.mock('../app/useAIOverlay', () => ({
  useAIOverlay: () => ({ visible: true, mode: 'chat', initialPrompt: mockOverlayPrompt }),
  aiOverlay: { close: () => mockClose() },
}));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({
  selectionReady: true, selection: { schoolId: mockSchool },
  school: { id: mockSchool, name: mockSchool === 'pu' ? '靜宜大學' : '國立清華大學' },
}) }));
jest.mock('../state/nuniSession', () => ({
  ...jest.requireActual('../state/nuniSession'), useOptionalNuniSession: () => null,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}), isFirebaseMockMode: () => false,
}));
jest.mock('../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: false, reason: '沒有本機模型' })),
    getSavedModelId: jest.fn(async () => null),
    isModelDownloaded: jest.fn(async () => false), getDownloadedModels: jest.fn(async () => []),
    generate: jest.fn(), loadModel: jest.fn(),
  },
  getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));
jest.mock('../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: jest.fn(), formatOnDeviceSchoolPrompt: jest.fn(),
}));
jest.mock('../screens/AssistantClassNowHint', () => ({
  AssistantClassNowHint: ({ children }: { children: (upcoming: boolean) => React.ReactNode }) => children(false),
}));
jest.mock('../screens/LegacyAssignmentReminders', () => ({ LegacyAssignmentReminders: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { localLLM } = require('../services/localLLMInference');
const originalFetch = globalThis.fetch;
const fetchSource = jest.fn();
const course = {
  code: '11510CS 542000', section: '00', title: '資料庫系統', department: '資工系', teacher: '王老師',
  time: 'M3M4', room: '資電館 101', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '資電館 101' }],
};
function response(courses = [course]) {
  const operation = resolvePublicCourseOperation('nthu')!;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId: 'nthu', sourceUrl: operation.sourceUrl, courses, truncated: false,
    fetchedAt: '2026-11-07T06:00:00.000Z',
    operation: { id: operation.id, version: 1, responseSchemaVersion: 1, access: 'anonymous-public' },
  }) };
}
const filteredQuestion = '幫我查清大的星期一 3 學分資料庫課程';
const filters = { weekday: 1, credits: 3 };
function filteredResponse(empty = false) {
  const operation = resolvePublicCourseOperation('nthu', 2)!;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId: 'nthu', sourceUrl: operation.sourceUrl, truncated: false, filters, unresolvedCount: 2,
    courses: empty ? [] : [{ ...course, time: 'M3M4\nR5R6', room: '資電館 101\n資電館 202',
      meetings: [{ time: 'M3M4', room: '資電館 101' }, { time: 'R5R6', room: '資電館 202' }] }],
    fetchedAt: '2026-11-07T06:00:00.000Z',
    operation: { id: operation.id, version: 2, responseSchemaVersion: 2, access: operation.access },
  }) };
}
const navigation = () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['CourseCatalog'] }) });
async function ask(view: ReturnType<typeof render>, question = '幫我查清大的資料庫課程') {
  await view.findByText('送出問題');
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), question);
  await act(async () => fireEvent.press(view.getByText('送出問題')));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'student-a'; mockSchool = 'pu'; mockRootReady = false; mockPublicReady = false;
  mockOverlayPrompt = '幫我查清大的資料庫課程';
  fetchSource.mockReset().mockResolvedValue(response());
  globalThis.fetch = fetchSource;
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});
afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); });

test('one sentence reaches the public API, shows verified courses, and retains school and query without changing the draft', async () => {
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await ask(view);
  expect(await view.findByText('資料庫系統')).toBeTruthy();
  expect(view.getByText('國立清華大學 · 校方公開開課資料')).toBeTruthy();
  expect(view.getByText('學期 1151')).toBeTruthy();
  expect(view.getByText('找到 1 筆「資料庫」開課資料。')).toBeTruthy();
  expect(view.getByText('校方資料擷取：2026-11-07 14:00（台灣時間；非校方更新時間）')).toBeTruthy();
  expect(view.getByText('公開課程目錄不代表你已修課、已取得學分或選課成功。')).toBeTruthy();
  expect(view.getByText('公開開課查詢需連網，不需下載 AI 模型或使用付費 AI。')).toBeTruthy();
  expect(view.queryByText('手機離線工具')).toBeNull();
  expect(view.queryByText(/未進行雲端推論或即時校園查詢/)).toBeNull();
  expect(new URL(fetchSource.mock.calls[0][0]).searchParams.get('schoolId')).toBe('nthu');
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '稍後再問下一個問題');
  fireEvent.press(view.getByText('開啟完整查課結果'));
  expect(nav.navigate).toHaveBeenCalledWith('CourseCatalog', {
    publicSchoolId: 'nthu', filter: { keyword: '資料庫' }, autoSearch: true,
  });
  expect(mockSchool).toBe('pu');
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('稍後再問下一個問題');
  fireEvent.press(view.getByText('查看校方課程目錄'));
  expect(Linking.openURL).toHaveBeenCalledWith(resolveOfficialCourseQueryLink('nthu')!.url);
});

test('a source failure offers a retry handoff and never shows an empty success or old courses', async () => {
  const nav = navigation();
  fetchSource.mockResolvedValue({ ok: false, status: 502, headers: { get: () => null } });
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await ask(view);
  expect(await view.findByText(/暫時無法取得國立清華大學公開開課資料/)).toBeTruthy();
  expect(view.queryByText('資料庫系統')).toBeNull();
  expect(view.queryByText(/沒有符合/)).toBeNull();
  fireEvent.press(view.getByText('到查課頁重試'));
  expect(nav.navigate).toHaveBeenCalledWith('CourseCatalog', {
    publicSchoolId: 'nthu', filter: { keyword: '資料庫' }, autoSearch: true,
  });
});

test('a verified empty lookup is displayed as empty and can still reopen the same query', async () => {
  fetchSource.mockResolvedValue(response([]));
  const view = render(<CampusAssistantScreen navigation={navigation()} />);
  await ask(view);
  expect(await view.findByText('這次沒有符合「資料庫」的開課資料，可改用課號或老師姓名查詢。')).toBeTruthy();
  expect(view.getByText('開啟完整查課結果')).toBeTruthy();
  expect(view.queryByText('到查課頁重試')).toBeNull();
});

test('cancellation stops waiting, retains the question, and discards a late response before retry', async () => {
  const delayed = deferred<ReturnType<typeof response>>();
  fetchSource.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(response());
  const view = render(<CampusAssistantScreen navigation={navigation()} />);
  await ask(view);
  fireEvent.press(view.getByText('取消公開課程查詢'));
  expect(await view.findByText('已取消公開課程查詢。')).toBeTruthy();
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('幫我查清大的資料庫課程');
  await act(async () => delayed.resolve(response()));
  expect(view.queryByText('資料庫系統')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重試查詢')));
  expect(await view.findByText('資料庫系統')).toBeTruthy();
  expect(fetchSource).toHaveBeenCalledTimes(2);
});

test.each(['school', 'account', 'unmount'])('pending results cannot appear after %s changes', async (kind) => {
  const delayed = deferred<ReturnType<typeof response>>();
  fetchSource.mockReturnValueOnce(delayed.promise);
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await ask(view);
  if (kind === 'unmount') view.unmount();
  else {
    if (kind === 'school') mockSchool = 'nthu';
    else mockUid = 'student-b';
    view.rerender(<CampusAssistantScreen navigation={nav} />);
  }
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => delayed.resolve(response()));
  if (kind !== 'unmount') {
    expect(view.queryByText('資料庫系統')).toBeNull();
    expect(view.queryByText('開啟完整查課結果')).toBeNull();
  }
  expect(nav.navigate).not.toHaveBeenCalled();
});

test.each(['school', 'public'])('the global overlay actually navigates the active %s container and then closes', async (owner) => {
  mockRootReady = owner === 'school'; mockPublicReady = owner === 'public';
  if (owner === 'public') mockUid = null;
  const view = render(<AIOverlayHost />);
  expect(fetchSource).not.toHaveBeenCalled();
  await view.findByText('送出問題');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await view.findByText('資料庫系統');
  fireEvent.press(view.getByText('開啟完整查課結果'));
  const params = { publicSchoolId: 'nthu', filter: { keyword: '資料庫' }, autoSearch: true };
  if (owner === 'school') {
    expect(mockRootDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NAVIGATE', payload: { name: '學習', params: { screen: 'CourseCatalog', params, initial: false } },
    }));
    expect(mockPublicDispatch).not.toHaveBeenCalled();
  } else {
    expect(mockPublicDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NAVIGATE', payload: { name: 'CourseCatalog', params },
    }));
    expect(mockRootDispatch).not.toHaveBeenCalled();
  }
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test('an overlay without a ready navigation container does not present a false in-app destination', async () => {
  const view = render(<AIOverlayHost />);
  await view.findByText('送出問題');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await view.findByText('資料庫系統');
  expect(view.queryByText('開啟完整查課結果')).toBeNull();
  expect(view.getByText('查看校方課程目錄')).toBeTruthy();
  expect(mockClose).not.toHaveBeenCalled();
});

test('a natural-language filtered answer shows its conditions and all weekdays, then hands off the original read instead of the new draft', async () => {
  fetchSource.mockResolvedValue(filteredResponse());
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await ask(view, filteredQuestion);
  await view.findByText('資料庫系統');
  expect(Object.fromEntries(new URL(fetchSource.mock.calls[0][0]).searchParams)).toEqual({
    schoolId: 'nthu', q: '資料庫', weekday: '1', credits: '3',
  });
  expect(view.getByText('查詢條件：星期一有課 · 3 學分')).toBeTruthy();
  expect(view.getByText('上課日：星期一、星期四')).toBeTruthy();
  expect(view.getByText('星期條件表示當天有課，同一門課也可能在其他天上課。')).toBeTruthy();
  expect(view.getByText('另有 2 筆課程的篩選資料不足，未列入符合結果。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '我想改問週五的課');
  fireEvent.press(view.getByText('開啟完整查課結果'));
  expect(nav.navigate).toHaveBeenCalledWith('CourseCatalog', {
    publicSchoolId: 'nthu', filter: { keyword: '資料庫', weekday: 1, credits: 3 }, autoSearch: true,
  });
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('我想改問週五的課');
  expect(mockSchool).toBe('pu');
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test.each(['empty', 'unavailable'])('the filtered %s answer keeps conditions on the follow-up CTA', async (status) => {
  fetchSource.mockResolvedValue(status === 'empty' ? filteredResponse(true)
    : { ok: false, status: 502, headers: { get: () => null } });
  const nav = navigation();
  const view = render(<CampusAssistantScreen navigation={nav} />);
  await ask(view, filteredQuestion);
  await view.findByText('查詢條件：星期一有課 · 3 學分');
  const label = status === 'empty' ? '開啟完整查課結果' : '到查課頁重試';
  fireEvent.press(view.getByText(label));
  expect(nav.navigate).toHaveBeenCalledWith('CourseCatalog', {
    publicSchoolId: 'nthu', filter: { keyword: '資料庫', weekday: 1, credits: 3 }, autoSearch: true,
  });
  expect(view.queryByText('資料庫系統')).toBeNull();
  if (status === 'empty') expect(view.getByText('另有 2 筆課程的篩選資料不足，未列入符合結果。')).toBeTruthy();
  else expect(view.queryByText(/這次沒有符合/)).toBeNull();
});

test.each(['school', 'public'])('the %s overlay preserves all filters through the actual navigation bridge', async (owner) => {
  mockRootReady = owner === 'school'; mockPublicReady = owner === 'public';
  if (owner === 'public') mockUid = null;
  mockOverlayPrompt = filteredQuestion;
  fetchSource.mockResolvedValue(filteredResponse());
  const view = render(<AIOverlayHost />);
  expect(fetchSource).not.toHaveBeenCalled();
  await view.findByText('送出問題');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await view.findByText('資料庫系統');
  fireEvent.press(view.getByText('開啟完整查課結果'));
  const params = { publicSchoolId: 'nthu', filter: { keyword: '資料庫', weekday: 1, credits: 3 }, autoSearch: true };
  if (owner === 'school') {
    expect(mockRootDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NAVIGATE', payload: { name: '學習', params: { screen: 'CourseCatalog', params, initial: false } },
    }));
    expect(mockPublicDispatch).not.toHaveBeenCalled();
  } else {
    expect(mockPublicDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NAVIGATE', payload: { name: 'CourseCatalog', params },
    }));
    expect(mockRootDispatch).not.toHaveBeenCalled();
  }
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockSchool).toBe('pu');
});
