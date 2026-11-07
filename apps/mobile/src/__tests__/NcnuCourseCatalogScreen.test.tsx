import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { CourseCatalogScreen } from '../screens/CourseCatalogScreen';
import { queryCatalog } from '../services/courseCatalogClient';

let mockSchoolId = 'ncnu';
const setBrowsingSchoolId = (value: string) => { mockSchoolId = value; };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId, name: mockSchoolId } }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('../state/schedule', () => ({ useSchedule: () => ({ courses: [] }) }));
jest.mock('../services/courseCatalogClient', () => ({ queryCatalog: jest.fn() }));
jest.mock('../services/analytics', () => ({ analytics: {} }));
jest.mock('../services/tronClassWebUiGate', () => ({}));
jest.mock('../services/tronClassDataEnabled', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0,
}));
beforeEach(() => { jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never); });
afterEach(() => { jest.restoreAllMocks(); });

function ncnuJson(courses: unknown[], schoolId = 'ncnu') {
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId, sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall',
    truncated: false, courses,
  }) };
}
const ncnuDatabaseCourse = {
  code: '130032', section: '0', title: '資料庫管理系統', department: '資管系', teacher: '', time: '4efg',
  room: '管268', semester: '1151', credits: '3.0',
};

test('NCNU guest catalog opens directly and supports code search, empty results and the official guest link', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  const fetchSource = jest.fn().mockResolvedValueOnce(ncnuJson([ncnuDatabaseCourse])).mockResolvedValueOnce(ncnuJson([]));
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen />);
    const input = await view.findByLabelText('搜尋暨大課程');
    fireEvent.changeText(input, '130032');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('資料庫管理系統')).toBeTruthy();
    expect(view.getByText('星期四 e、f、g 節 · 13:30–16:20 · 管268')).toBeTruthy();
    expect(fetchSource).toHaveBeenCalledWith('https://nuni.tw/api/public-course-catalog?schoolId=ncnu&q=130032', expect.objectContaining({ credentials: 'omit' }));
    fireEvent.changeText(input, '其他');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('找不到「其他」的開課資料。')).toBeTruthy();
    fireEvent.press(view.getByText('開啟暨大官方課程目錄'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall');
    expect(queryCatalog).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});

test('NCNU late response is cancelled on school switch and a different-campus payload fails closed', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  let finish!: (data: ReturnType<typeof ncnuJson>) => void;
  const fetchSource = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(ncnuJson([ncnuDatabaseCourse], 'pu'));
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
    setBrowsingSchoolId('ncku');
    view.rerender(<CourseCatalogScreen />);
    await waitFor(() => expect(view.queryByLabelText('搜尋暨大課程')).toBeNull());
    expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { finish(ncnuJson([ncnuDatabaseCourse])); });
    expect(view.queryByText('資料庫管理系統')).toBeNull();
    setBrowsingSchoolId('ncnu');
    view.rerender(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    expect(await view.findByText('暫時無法讀取暨大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(view.queryByText('資料庫管理系統')).toBeNull();
  } finally { globalThis.fetch = original; }
});
