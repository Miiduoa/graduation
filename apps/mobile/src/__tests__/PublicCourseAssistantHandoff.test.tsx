import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
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
const route = (publicSchoolId: unknown, keyword = 'AES') => ({ params: {
  publicSchoolId, filter: { keyword }, autoSearch: true,
} });
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
