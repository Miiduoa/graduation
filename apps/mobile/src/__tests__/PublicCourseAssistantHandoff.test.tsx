import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import type { PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { CourseCatalogScreen } from '../screens/CourseCatalogScreen';
import { queryCatalog } from '../services/courseCatalogClient';
import * as ledger from '../services/personalImports';

let mockSchool = 'pu';
jest.mock('../state/school', () => ({ useSchool: () => ({
  school: { id: mockSchool, name: mockSchool === 'pu' ? '靜宜大學' : mockSchool },
}) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student-a' }, profile: null }) }));
jest.mock('../state/schedule', () => ({ useSchedule: () => ({ courses: [] }) }));
jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () => ({ owner: 'nuni:student-a', schoolId: mockSchool }),
}));
jest.mock('../services/courseCatalogClient', () => ({ queryCatalog: jest.fn() }));
jest.mock('../services/analytics', () => ({ analytics: {} }));
jest.mock('../services/tronClassWebUiGate', () => ({}));
jest.mock('../services/tronClassDataEnabled', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0 }));

const originalFetch = globalThis.fetch;
const fetchSource = jest.fn();
const nthuCourse = {
  code: '11510AES 520300', section: '00', title: '分析化學專題', department: 'AES', teacher: '王老師',
  time: 'M3M4', room: '教室甲', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '教室甲' }],
};
const ncnuCourse = {
  code: '130032', section: '0', title: '資料庫管理系統', department: '資管系', teacher: '',
  time: '4efg', room: '管268', semester: '1151', credits: '3',
};
function response(schoolId: 'ncnu' | 'nthu' = 'nthu') {
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId, sourceUrl: resolvePublicCourseOperation(schoolId)!.sourceUrl,
    courses: [schoolId === 'nthu' ? nthuCourse : ncnuCourse], truncated: false,
  }) };
}
const route = (publicSchoolId: unknown, keyword = 'AES', filters: PublicCourseFilters = {}) => ({ params: {
  publicSchoolId, filter: { keyword, ...filters }, autoSearch: true,
} });
function filteredResponse(schoolId: 'ncnu' | 'nthu', filters: PublicCourseFilters, empty = false) {
  const operation = resolvePublicCourseOperation(schoolId, 2)!;
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId, sourceUrl: operation.sourceUrl, fetchedAt: '2026-11-07T08:00:00.000Z',
    operation: { id: operation.id, version: 2, responseSchemaVersion: 2, access: operation.access },
    filters, unresolvedCount: 0, truncated: false,
    courses: empty ? [] : [schoolId === 'nthu' ? nthuCourse : ncnuCourse],
  }) };
}
beforeEach(() => {
  jest.clearAllMocks(); mockSchool = 'pu';
  fetchSource.mockReset().mockResolvedValue(response());
  globalThis.fetch = fetchSource;
});
afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); });

test('an explicit NTHU handoff searches the requested campus while retaining the PU account and blocking cross-school writes', async () => {
  const append = jest.spyOn(ledger, 'appendPersonalImports');
  const view = render(<CourseCatalogScreen route={route('nthu')} />);
  expect(await view.findByText('分析化學專題')).toBeTruthy();
  expect(view.getByText('正在瀏覽國立清華大學的公開課程；目前選校仍為靜宜大學。')).toBeTruthy();
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe('AES');
  expect(fetchSource).toHaveBeenCalledWith('https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES', expect.objectContaining({ credentials: 'omit' }));
  expect(mockSchool).toBe('pu');
  expect(queryCatalog).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('核對並加入課表'));
  expect(view.getByText(/請先確認目前帳號與所選學校/)).toBeTruthy();
  expect(view.queryByText('確認加入個人課表')).toBeNull();
  expect(append).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('an empty assistant query still runs once and can browse the same public list', async () => {
  const view = render(<CourseCatalogScreen route={route('nthu', '')} />);
  await view.findByText('分析化學專題');
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe('');
  expect(fetchSource).toHaveBeenCalledTimes(1);
  expect(fetchSource.mock.calls[0][0]).toBe('https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=');
});

test('the handoff preserves 80 Unicode code points and does not cut supplementary characters in half', async () => {
  const keyword = '𠮷'.repeat(80);
  const view = render(<CourseCatalogScreen route={route('nthu', keyword)} />);
  await view.findByText('分析化學專題');
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe(keyword);
  expect(new URL(fetchSource.mock.calls[0][0]).searchParams.get('q')).toBe(keyword);
  fireEvent.changeText(view.getByLabelText('搜尋清大課程'), keyword + '再');
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe(keyword);
});

test.each(['pu', 'NTHU', 'https://example.test', ['nthu'], null])('unknown explicit public targets fail without another-school lookup: %j', (schoolId) => {
  mockSchool = 'ncnu';
  const view = render(<CourseCatalogScreen route={route(schoolId)} />);
  expect(view.getByText('這個公開查課連結的學校無法確認，請回到助理重新查詢。')).toBeTruthy();
  expect(fetchSource).not.toHaveBeenCalled();
  expect(queryCatalog).not.toHaveBeenCalled();
});

test('replacing the public handoff aborts its old request and ignores an eventual old response', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  fetchSource.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response('ncnu'));
  const view = render(<CourseCatalogScreen route={route('nthu')} />);
  await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
  view.rerender(<CourseCatalogScreen route={route('ncnu', '資料庫')} />);
  expect(await view.findByText('資料庫管理系統')).toBeTruthy();
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finish(response()));
  expect(view.queryByText('分析化學專題')).toBeNull();
  expect(view.getByLabelText('搜尋暨大課程').props.value).toBe('資料庫');
  expect(mockSchool).toBe('pu');
});

test.each([['nthu', 1], ['ncnu', 4]] as const)('a filtered %s handoff preserves the empty keyword and independent selected-school scope', async (schoolId, weekday) => {
  const filters = { weekday, credits: 3 };
  fetchSource.mockResolvedValue(filteredResponse(schoolId, filters));
  const append = jest.spyOn(ledger, 'appendPersonalImports');
  const view = render(<CourseCatalogScreen route={route(schoolId, '', filters)} />);
  await view.findByText(schoolId === 'nthu' ? nthuCourse.title : ncnuCourse.title);
  expect(Object.fromEntries(new URL(fetchSource.mock.calls[0][0]).searchParams)).toEqual({
    schoolId, q: '', weekday: String(weekday), credits: '3',
  });
  expect(view.getByLabelText('課程學分').props.value).toBe('3');
  expect(view.getByRole('button', { name: weekday === 1 ? '星期一' : '星期四' }).props.accessibilityState.selected).toBe(true);
  expect(view.getByText(/目前選校仍為靜宜大學/)).toBeTruthy();
  fireEvent.press(view.getByText('核對並加入課表'));
  expect(view.getByText(/請先確認目前帳號與所選學校/)).toBeTruthy();
  expect(append).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(queryCatalog).not.toHaveBeenCalled();
  expect(mockSchool).toBe('pu');
});

test('an existing semester handoff stays editable and requires an explicit latest-catalog search', async () => {
  mockSchool = 'nthu';
  fetchSource.mockResolvedValue(filteredResponse('nthu', { weekday: 1, credits: 3 }));
  const view = render(<CourseCatalogScreen route={{ params: {
    filter: { keyword: 'AES', semester: '1142' }, autoSearch: true,
  } }} />);
  expect(view.getByText('連結指定114學年度第2學期，目前僅能查校方最新公開開課，無法按指定學期篩選。')).toBeTruthy();
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe('AES');
  expect(fetchSource).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('搜尋清大課程'), '化學');
  fireEvent.press(view.getByRole('button', { name: '星期一' }));
  fireEvent.changeText(view.getByLabelText('課程學分'), '3');
  fireEvent(view.getByLabelText('搜尋清大課程'), 'submitEditing');
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe('化學');
  expect(fetchSource).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查詢最新公開課程' }));
  await view.findByText(nthuCourse.title);
  expect(Object.fromEntries(new URL(fetchSource.mock.calls[0][0]).searchParams)).toEqual({
    schoolId: 'nthu', q: '化學', weekday: '1', credits: '3',
  });
  expect(view.getByText('115 學年度第 1 學期')).toBeTruthy();
  expect(queryCatalog).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(mockSchool).toBe('nthu');
});

test.each([
  { weekday: 0 }, { weekday: 8 }, { weekday: '1' }, { weekday: [1] },
  { credits: -1 }, { credits: 40.01 }, { credits: 3.001 }, { credits: '3' },
  { credits: null }, { semester: '1153' }, { semester: 1151 }, { semester: '' }, { keyword: '課'.repeat(81) },
])('invalid public entry conditions cannot be dropped or interpreted as PU defaults: %j', (filter) => {
  const view = render(<CourseCatalogScreen route={{ params: { publicSchoolId: 'nthu', filter, autoSearch: true } }} />);
  expect(view.getByText('這個公開查課連結的星期、學分或搜尋條件無法確認，請回到助理重新查詢。')).toBeTruthy();
  expect(fetchSource).not.toHaveBeenCalled();
  expect(queryCatalog).not.toHaveBeenCalled();
});

test('an accessor in public entry filters is rejected without evaluating it', () => {
  const getter = jest.fn(() => 1);
  const filter = Object.defineProperty({ keyword: 'AES' }, 'weekday', { enumerable: true, get: getter });
  const view = render(<CourseCatalogScreen route={{ params: { publicSchoolId: 'nthu', filter, autoSearch: true } }} />);
  expect(view.getByText(/星期、學分或搜尋條件無法確認/)).toBeTruthy();
  expect(getter).not.toHaveBeenCalled();
  expect(fetchSource).not.toHaveBeenCalled();
});

test.each(['fetch', 'body'])('changing only route filters cancels the old %s while keeping the new empty result', async (stage) => {
  let finish!: (value: never) => void;
  const delayed = new Promise<never>(resolve => { finish = resolve; });
  const oldBody = jest.fn(() => delayed);
  if (stage === 'fetch') fetchSource.mockReturnValueOnce(delayed);
  else fetchSource.mockResolvedValueOnce({ ...filteredResponse('nthu', { weekday: 1, credits: 3 }), text: oldBody });
  fetchSource.mockResolvedValueOnce(filteredResponse('nthu', { weekday: 4, credits: 3 }, true));
  const view = render(<CourseCatalogScreen route={route('nthu', 'AES', { weekday: 1, credits: 3 })} />);
  await waitFor(() => expect(stage === 'fetch' ? fetchSource : oldBody).toHaveBeenCalledTimes(1));
  view.rerender(<CourseCatalogScreen route={route('nthu', 'AES', { weekday: 4, credits: 3 })} />);
  await view.findByText('找不到「AES」的開課資料。');
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  const previous = filteredResponse('nthu', { weekday: 1, credits: 3 });
  await act(async () => finish((stage === 'fetch' ? previous : await previous.text()) as never));
  expect(view.queryByText(nthuCourse.title)).toBeNull();
  expect(view.getByText('本次查詢條件：星期四有課 · 3 學分')).toBeTruthy();
  expect(view.getByRole('button', { name: '星期四' }).props.accessibilityState.selected).toBe(true);
  expect(mockSchool).toBe('pu');
});
