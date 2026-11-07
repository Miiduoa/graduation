import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import type { PublicCatalogCourse } from '@campus/shared/src/publicCourseCatalog';
import { PublicCourseCatalogScreen } from '../screens/PublicCourseCatalogScreen';
import { loadPersonalImports } from '../services/personalImports';
import { safeNavigate } from '../utils/safeNavigate';

let mockScope = { owner: 'guest:device', schoolId: 'nthu' };
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => undefined | (() => void)) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  // Preserve layout hooks used by the real Button and its loading overlay.
  ...jest.requireActual('../ui/navigationTheme'),
  useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0,
}));

const originalFetch = globalThis.fetch;
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });
afterEach(() => { globalThis.fetch = originalFetch; });

const nthu: PublicCatalogCourse = {
  code: '11510AES 520300', section: '00', title: '分析化學專題', department: 'AES', teacher: '王老師',
  time: 'M3M4\nR5R6', room: '教室甲\n教室乙', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '教室甲' }, { time: 'R5R6', room: '教室乙' }],
};
const ncnu: PublicCatalogCourse = {
  code: '130032', section: '0', title: '資料庫管理系統', department: '資管系', teacher: '',
  time: '4efg', room: '管268', semester: '1151', credits: '3.0',
};

test.each(['nthu', 'ncnu'] as const)('the actual %s card exposes review controls and saves without a clipboard round trip', async (schoolId) => {
  mockScope = { owner: 'guest:device', schoolId };
  const course = schoolId === 'nthu' ? nthu : ncnu;
  const sourceUrl = schoolId === 'nthu'
    ? 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json'
    : 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall';
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true, headers: { get: () => null },
    text: async () => JSON.stringify({ schoolId, sourceUrl, truncated: false, courses: [course] }),
  });
  const view = render(<PublicCourseCatalogScreen schoolId={schoolId} initialQuery={course.code} />);
  // Render the real Card and Button; the action must remain an accessible button,
  // not be swallowed by a parent grouped as the card's heading.
  fireEvent.press(await view.findByRole('button', { name: '核對並加入課表' }));
  fireEvent.press(view.getByRole('button', { name: '確認加入個人課表' }));
  await view.findByRole('button', { name: '查看個人課表' });
  const saved = await loadPersonalImports(mockScope);
  expect(saved.records).toHaveLength(schoolId === 'nthu' ? 2 : 1);
  expect(saved.records.every((row) => row.schoolId === schoolId && row.courseCode === course.code)).toBe(true);
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(safeNavigate).not.toHaveBeenCalled();
});
