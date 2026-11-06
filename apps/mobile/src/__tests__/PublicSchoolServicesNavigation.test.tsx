import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking } from 'react-native';
import { resolveDormRepairRoute } from '@campus/shared/src/dormRepairRoutes';
import { dormStorageKey, normalizeDormWorkspace } from '@campus/shared/src/dormitory';
import { PreAuthStack } from '../screens/PreAuthStack';
import { getDefaultCatalogFilter } from '../data/courseCatalogConstants';
import { CourseCatalogScreen } from '../screens/CourseCatalogScreen';
import { queryCatalog, toPersonalCourseDraft, type CatalogCourse, type CatalogQueryResult } from '../services/courseCatalogClient';
import {
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';

const SCHOOL_NAMES: Record<string, string> = {
  pu: '靜宜大學',
  ncku: '國立成功大學',
  ntpu: '國立臺北大學',
  ntu: '國立臺灣大學',
  nthu: '國立清華大學',
};

let mockBrowsingSchoolId = 'ncku';
const mockSchoolListeners = new Set<() => void>();
function setBrowsingSchoolId(schoolId: string) {
  mockBrowsingSchoolId = schoolId;
  mockSchoolListeners.forEach((listener) => listener());
}
let mockSchoolAuth: {
  user: { uid: string } | null;
  profile: { uid: string; schoolId: string; role?: string; department?: string } | null;
  loading: boolean;
  profileLoading: boolean;
  tokenExpired?: boolean;
} = {
  user: null,
  profile: null,
  loading: false,
  profileLoading: false,
  tokenExpired: false,
};

jest.mock('../state/auth', () => ({ useAuth: () => mockSchoolAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => {
    const React = require('react') as typeof import('react');
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
      const listener = () => setTick((value: number) => value + 1);
      mockSchoolListeners.add(listener);
      return () => {
        mockSchoolListeners.delete(listener);
      };
    }, []);
    return {
      school: {
        id: mockBrowsingSchoolId,
        name: SCHOOL_NAMES[mockBrowsingSchoolId] ?? mockBrowsingSchoolId,
      },
      setSelection: jest.fn(),
    };
  },
}));
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({ themeMode: 'light', mode: 'light', theme: require('../ui/theme').getCurrentTheme() }),
  useTheme: () => require('../ui/theme').getCurrentTheme(),
}));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({ session: null, loading: false, error: '', pendingLogout: false }),
  useOptionalNuniSession: () => null,
}));
const mockAddCourse = jest.fn();
jest.mock('../state/schedule', () => ({
  useSchedule: () => ({
    courses: [],
    addCourse: mockAddCourse,
    removeCourse: jest.fn(),
    updateCourse: jest.fn(),
  }),
}));
jest.mock('../services/courseCatalogClient', () => ({
  queryCatalog: jest.fn(),
  toPersonalCourseDraft: jest.fn(),
  detectConflicts: jest.fn(() => []),
}));
jest.mock('../ui/navigationTheme', () => ({
  createStackScreenOptions: () => ({}),
  useTabBarContentBottomPadding: () => 80,
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.unmock('@react-navigation/native');

jest.mock('../screens/NuniWorkspaceScreen', () => ({
  NuniWorkspaceScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="platform-workspace">nuni 帳號</Text>;
  },
}));
jest.mock('../screens/SSOLoginScreen', () => ({
  SSOLoginScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="school-login-form">登入學校帳號</Text>;
  },
}));
jest.mock('../screens/PersonalImportScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="personal-import-screen">匯入課表紀錄</Text> };
});
jest.mock('../screens/PersonalTimetableScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="personal-timetable-screen">整週個人課表</Text> };
});
jest.mock('../screens/GoogleMapsLikeScreen', () => {
  const { Text } = require('react-native');
  return { GoogleMapsLikeScreen: () => <Text testID="public-map-screen">校園地圖</Text> };
});
jest.mock('../screens/BusAiFirstScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-bus-screen">公車查詢</Text> };
});
jest.mock('../screens/LibraryAiFirstScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-library-screen">圖書館</Text> };
});
jest.mock('../screens/LibraryCatalogScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-library-catalog">館藏查詢</Text> };
});
jest.mock('../screens/CampusContentScreens', () => {
  const { Text } = require('react-native');
  return {
    CampusAnnouncementsScreen: () => <Text testID="public-announcements-screen">公開公告</Text>,
    CampusAnnouncementDetailScreen: () => <Text testID="public-announcement-screen">公告詳情</Text>,
  };
});
jest.mock('../components/TodayTimetablePanel', () => ({ TodayTimetablePanel: () => null }));
jest.mock('../components/SchoolBrowsingControl', () => ({
  SchoolBrowsingControl: () => {
    const { Text } = require('react-native');
    return <Text testID="school-browsing-control">瀏覽校園</Text>;
  },
}));

beforeEach(() => {
  mockBrowsingSchoolId = 'ncku';
  mockSchoolListeners.clear();
  mockSchoolAuth = {
    user: null,
    profile: null,
    loading: false,
    profileLoading: false,
    tokenExpired: false,
  };
  setSchoolLoginProviderKinds(['school-issued']);
  mockAddCourse.mockReset();
  jest.mocked(queryCatalog).mockReset();
  jest.mocked(queryCatalog).mockResolvedValue({
    courses: [],
    totalCount: 0,
    source: 'sample',
    fetchedAt: Date.now(),
    showRemain: false,
    filter: { semester: '1151' },
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

afterEach(() => {
  resetSchoolLoginProviderCache();
  jest.restoreAllMocks();
});

test.each(['guest', 'student'])('catalog search handoff keeps explicit criteria for %s', async (role) => {
  setBrowsingSchoolId('pu');
  if (role === 'student') mockSchoolAuth = {
    ...mockSchoolAuth,
    user: { uid: 'student-a' },
    profile: { uid: 'student-a', schoolId: 'pu', role: 'student', department: '資訊管理學系' },
  };
  const filter = { semester: '1151', keyword: 'IM301' };
  const view = render(<CourseCatalogScreen route={{ params: { filter } }} />);
  await waitFor(() => expect(queryCatalog).toHaveBeenCalled());
  expect(jest.mocked(queryCatalog).mock.calls[0][0]).toEqual(filter);
  expect(view.getByDisplayValue('IM301')).toBeTruthy();
});

const catalogCourse: CatalogCourse = {
  semester: '1151', code: 'IM302', name: '新的搜尋課程', nameEn: '',
  courseType: '必修', courseTypeKey: 'required', credits: 3,
  department: '資訊管理學系', classOffered: '', teacher: '授課教師', teacherEmail: '',
  timePlaceRaw: '', slots: [], capacity: 50, enrolled: 30, remaining: 20,
  language: '中文', languageKey: null, syllabusUrl: null, notes: '', tags: [], raw: {},
};

test('catalog refreshes a new incoming search and ignores the earlier response', async () => {
  setBrowsingSchoolId('pu');
  let resolveFirst!: (value: Awaited<ReturnType<typeof queryCatalog>>) => void;
  jest.mocked(queryCatalog).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));

  jest.mocked(queryCatalog).mockResolvedValueOnce({
    filter: { semester: '1151', keyword: 'IM302' }, courses: [catalogCourse], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  });
  const view = render(<CourseCatalogScreen route={{ params: { filter: { semester: '1151', keyword: 'IM301' } } }} />);
  await waitFor(() => expect(queryCatalog).toHaveBeenCalledTimes(1));
  view.rerender(<CourseCatalogScreen route={{ params: { filter: { semester: '1151', keyword: 'IM302' } } }} />);
  expect(await view.findByText('新的搜尋課程')).toBeTruthy();
  expect(view.getByDisplayValue('IM302')).toBeTruthy();
  await act(async () => { resolveFirst({
    filter: { semester: '1151', keyword: 'IM301' },
    courses: [{ ...catalogCourse, code: 'IM301', name: '上一筆搜尋的過期結果' }], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  }); });
  expect(view.queryByText('上一筆搜尋的過期結果')).toBeNull();
  expect(view.getByText('新的搜尋課程')).toBeTruthy();
});

test('the catalog keeps its input mounted and only shows the last submitted search', async () => {
  setBrowsingSchoolId('pu');
  let resolveFirst!: (value: CatalogQueryResult) => void;
  jest.mocked(queryCatalog).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
  jest.mocked(queryCatalog).mockResolvedValueOnce({
    filter: { semester: '1151', keyword: '演算法' }, courses: [catalogCourse], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  });
  const view = render(<CourseCatalogScreen route={{ params: { filter: { semester: '1151' } } }} />);
  const search = view.getByLabelText('搜尋課程、教師或代號');
  fireEvent.changeText(search, '演算');
  expect(view.getByDisplayValue('演算') === search).toBe(true);
  fireEvent.changeText(search, '演算法');
  fireEvent(search, 'submitEditing');
  expect(await view.findByText(catalogCourse.name)).toBeTruthy();

  fireEvent.press(view.getByLabelText('開啟篩選條件'));
  await act(async () => resolveFirst({
    filter: { semester: '1151' }, courses: [], totalCount: 0,
    source: 'live', fetchedAt: Date.now(), showRemain: false, error: '過期的回應',
  }));
  expect(view.getByLabelText('篩選課程關鍵字')).toBeTruthy();
  fireEvent.press(view.getByText('取消'));
  expect(view.getByText(catalogCourse.name)).toBeTruthy();
  expect(view.queryByText('過期的回應')).toBeNull();
});

test('cancel discards draft filters and clearing a submitted keyword keeps the other filters', async () => {
  setBrowsingSchoolId('pu');
  const filter = { semester: '1151', keyword: '英文', weekday: 1 };
  const view = render(<CourseCatalogScreen route={{ params: { filter } }} />);
  await view.findByText('查無符合條件的課程');
  fireEvent.press(view.getByLabelText('開啟篩選條件'));
  const draft = view.getByLabelText('篩選課程關鍵字');
  fireEvent.changeText(draft, '統');
  expect(view.getByLabelText('篩選課程關鍵字') === draft).toBe(true);
  fireEvent.changeText(draft, '統計');
  fireEvent.press(view.getByText('週二'));
  fireEvent.press(view.getByText('取消'));
  expect(view.getByDisplayValue('英文')).toBeTruthy();
  expect(queryCatalog).toHaveBeenCalledTimes(1);

  fireEvent.press(view.getByLabelText('開啟篩選條件'));
  expect(view.getByLabelText('篩選課程關鍵字').props.value).toBe('英文');
  expect(view.getByRole('button', { name: '週一' }).props.accessibilityState.selected).toBe(true);
  fireEvent.changeText(view.getByLabelText('篩選課程關鍵字'), '統計');
  fireEvent.press(view.getByText('週二'));
  fireEvent.press(view.getByText('套用'));
  expect(await view.findByDisplayValue('統計')).toBeTruthy();
  expect(jest.mocked(queryCatalog).mock.calls[1][0]).toEqual({ ...filter, keyword: '統計', weekday: 2 });
  fireEvent.press(view.getByLabelText('清除搜尋關鍵字'));
  await view.findByText('查無符合條件的課程');
  expect(jest.mocked(queryCatalog).mock.calls[2][0]).toEqual({ semester: '1151', weekday: 2 });
  expect(view.getByLabelText('搜尋課程、教師或代號').props.value).toBe('');
});

test('a conflicting catalog course reports failure only after the timetable responds', async () => {
  setBrowsingSchoolId('pu');
  mockSchoolAuth = { ...mockSchoolAuth, user: { uid: 'student-a' },
    profile: { uid: 'student-a', schoolId: 'pu', role: 'student' } };
  const alert = jest.spyOn(Alert, 'alert');
  let rejectAdd!: (reason: Error) => void;
  mockAddCourse.mockReturnValueOnce(new Promise((_, reject) => { rejectAdd = reject; }));
  const slot = { dayOfWeek: 1, startTime: '09:10', endTime: '10:00', location: '任垣 101' };
  jest.mocked(toPersonalCourseDraft).mockReturnValueOnce({
    ...catalogCourse, schedule: [slot],
  });
  jest.mocked(queryCatalog).mockResolvedValueOnce({
    filter: { semester: '1151' }, courses: [catalogCourse], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  });
  const view = render(<CourseCatalogScreen />);
  fireEvent.press(await view.findByText('加入本機課程清單'));
  expect(mockAddCourse).toHaveBeenCalledWith(expect.objectContaining({ schedule: [slot] }));
  expect(view.getByText('加入中…')).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  await act(async () => rejectAdd(new Error('課程時間有衝突')));
  expect(alert.mock.calls).toEqual([['加入失敗', '課程時間有衝突']]);
  expect(view.getByText('加入本機課程清單')).toBeTruthy();
});

test('paused catalog search reads the exact saved query and clearing returns to its original cache without network', async () => {
  setBrowsingSchoolId('pu');
  const originalFetch = globalThis.fetch;
  const fetchSpy = jest.fn().mockRejectedValue(new Error('unexpected network request'));
  const realClient = jest.requireActual<typeof import('../services/courseCatalogClient')>('../services/courseCatalogClient');
  jest.mocked(queryCatalog).mockImplementation(realClient.queryCatalog);
  const filter = { ...getDefaultCatalogFilter(), courseType: 'general' };
  const key = `@course_catalog:v3:pu:${JSON.stringify(filter)}`;
  const cached = {
    filter, courses: [{ ...catalogCourse, syllabusUrl: 'https://mypu.pu.edu.tw/example' }], totalCount: 1,
    source: 'live', fetchedAt: Date.now() - 7 * 86_400_000, showRemain: false,
  };
  await AsyncStorage.setItem(key, JSON.stringify(cached));
  try {
    const { view, navigation, onUnhandledAction } = renderPublicStack();
    globalThis.fetch = fetchSpy;
    fireEvent.press(await view.findByTestId('public-CourseCatalog'));
    expect(await view.findByText(catalogCourse.name)).toBeTruthy();
    expect(view.getByText('校方課綱更新已暫停')).toBeTruthy();
    expect(view.getByText(/1 筆 · 本機紀錄/)).toBeTruthy();
    expect(view.queryByText('查看課綱')).toBeNull();
    const search = view.getByLabelText('搜尋課程、教師或代號');
    fireEvent.changeText(search, '未儲存的關鍵字');
    fireEvent(search, 'submitEditing');
    expect(await view.findByText(/沒有儲存這組條件/)).toBeTruthy();
    fireEvent.press(view.getByText('查看我的課表'));
    await view.findByTestId('personal-timetable-screen');
    expect(navigation.getCurrentRoute()?.name).toBe('PersonalTimetable');
    act(() => navigation.goBack());
    await view.findByText(/沒有儲存這組條件/);
    expect(onUnhandledAction).not.toHaveBeenCalled();
    expect(view.queryByText('重試')).toBeNull();
    expect(view.queryByText(/查無符合條件/)).toBeNull();
    fireEvent.press(view.getByLabelText('清除搜尋關鍵字'));
    expect(await view.findByText(catalogCourse.name)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
    await AsyncStorage.removeItem(key);
  }
});

function renderPublicStack() {
  const navigation = createNavigationContainerRef();
  const onUnhandledAction = jest.fn();
  const content = () => (
    <NavigationContainer ref={navigation} onUnhandledAction={onUnhandledAction}>
      <PreAuthStack />
    </NavigationContainer>
  );
  const view = render(content());
  return { view, navigation, onUnhandledAction, content, rerender: () => view.rerender(content()) };
}

test('landing exposes school-scoped public service entries for guests', async () => {
  const { view, onUnhandledAction } = renderPublicStack();
  await view.findByTestId('login-landing');
  expect(view.getByTestId('public-CourseCatalog')).toBeTruthy();
  expect(view.getByTestId('public-Health')).toBeTruthy();
  expect(view.getByTestId('public-Dormitory')).toBeTruthy();
  expect(view.getByTestId('public-Career')).toBeTruthy();
  expect(view.getByText(/查看國立成功大學課綱或校方課程查詢入口/)).toBeTruthy();
  expect(view.getByText(/前往國立成功大學住宿相關校方入口/)).toBeTruthy();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test.each([
  {
    route: 'Health',
    openLabel: '在瀏覽器開啟',
    url: 'https://counseling-osa.ncku.edu.tw/',
    marker: '成大心理健康與諮商輔導組',
  },
  {
    route: 'Dormitory',
    openLabel: '成大住宿服務組 ↗',
    url: 'https://housing-osa.ncku.edu.tw/',
    marker: /床位、抽籤、繳費、退宿和正式報修/,
  },
  {
    route: 'Career',
    openLabel: '前往成大生涯發展與就業輔導組',
    url: 'https://grad-osa.ncku.edu.tw/',
    marker: /職涯資料尚未連結到校方系統/,
  },
] as const)(
  'non-PU guest can open %s and its school official link without school login',
  async ({ route, openLabel, url, marker }) => {
    const { view, navigation, onUnhandledAction } = renderPublicStack();
    fireEvent.press(await view.findByTestId(`public-${route}`));
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe(route));
    expect(view.getByText(marker)).toBeTruthy();
    expect(view.queryByTestId('school-login-form')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByText(openLabel));
    });
    expect(Linking.openURL).toHaveBeenCalledWith(url);
    expect(onUnhandledAction).not.toHaveBeenCalled();
  },
);

test('non-PU CourseCatalog does not query PU catalog and opens selected-school official course link', async () => {
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-CourseCatalog'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('CourseCatalog'));
  expect(view.getByText(/國立成功大學尚未接入 nuni 內建課綱查詢/)).toBeTruthy();
  expect(queryCatalog).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(view.getByText('開啟成大課程資訊及選課系統'));
  });
  expect(Linking.openURL).toHaveBeenCalledWith('https://course.ncku.edu.tw/index.php?c=portal');
  expect(Linking.openURL).not.toHaveBeenCalledWith(
    expect.stringContaining('mypu.pu.edu.tw'),
  );
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('guest Dormitory provides an editable personal workspace without claiming school access', async () => {
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Dormitory'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('Dormitory'));
  expect(await view.findByText('住得安心，事情好處理')).toBeTruthy();
  expect(view.getByText(/訪客紀錄只存在此裝置/)).toBeTruthy();
  fireEvent.press(view.getByText('設備問題'));
  expect(view.getByText('＋ 記錄問題')).toBeTruthy();
  fireEvent.press(view.getByText('＋ 記錄問題'));
  expect(view.getByText('新增問題')).toBeTruthy();
  expect(view.queryByTestId('school-login-form')).toBeNull();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('residents can open the current school repair channel without saving and later record a case number', async () => {
  setBrowsingSchoolId('ntou');
  const key = dormStorageKey('guest', 'ntou');
  await AsyncStorage.removeItem(key);
  const network = resolveDormRepairRoute('ntou', 'network');
  const general = resolveDormRepairRoute('ntou', 'other');
  if (!network || !general) throw new Error('Missing NTOU repair routes');
  const { view } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Dormitory'));
  fireEvent.press(await view.findByText('設備問題'));
  fireEvent.press(await view.findByText(general.label));
  expect(Linking.openURL).toHaveBeenLastCalledWith(general.url);
  expect(await AsyncStorage.getItem(key)).toBeNull();

  fireEvent.press(view.getByText('已自行確認處理完成'));
  fireEvent.press(view.getByText('宿舍網路無法連線'));
  fireEvent.press(view.getByText(network.label));
  expect(Linking.openURL).toHaveBeenLastCalledWith('tel:0800080412');
  expect(await AsyncStorage.getItem(key)).toBeNull();
  fireEvent.press(view.getByText('儲存紀錄'));
  fireEvent.press(await view.findByText('編輯'));
  fireEvent.changeText(view.getByLabelText('校方案號（選填）'), '  CASE-168  ');
  fireEvent.press(view.getByText('儲存紀錄'));
  expect(await view.findByText('校方案號：CASE-168')).toBeTruthy();
  fireEvent.press(view.getByText(network.label));
  expect(Linking.openURL).toHaveBeenLastCalledWith('tel:0800080412');
  const stored = normalizeDormWorkspace(JSON.parse((await AsyncStorage.getItem(key))!));
  expect(stored.repairs).toHaveLength(1);
  expect(stored.repairs[0]).toMatchObject({ reference: 'CASE-168', category: 'network', status: 'draft' });

  fireEvent.press(view.getByText('編輯'));
  fireEvent.press(view.getByText('水電與漏水'));
  fireEvent.press(view.getByText('儲存紀錄'));
  await view.findByText('編輯');
  fireEvent.press(view.getByText('查海大修繕處理狀況'));
  expect(Linking.openURL).toHaveBeenLastCalledWith(general.url);
  expect(view.queryByText(general.label)).toBeNull();

  act(() => setBrowsingSchoolId('ncku'));
  fireEvent.press(await view.findByText('設備問題'));
  await view.findByText('＋ 記錄問題');
  expect(view.queryByText('校方案號：CASE-168')).toBeNull();
  expect(view.queryByText(network.label)).toBeNull();
  await AsyncStorage.removeItem(key);
});

test('changing residence does not reroute an existing repair to the new hall', async () => {
  setBrowsingSchoolId('pu');
  const key = dormStorageKey('guest', 'pu');
  const location = '希嘉學苑 302';
  const previousHall = resolveDormRepairRoute('pu', 'water', location);
  const currentHall = resolveDormRepairRoute('pu', 'water', '思高學苑');
  if (!previousHall || !currentHall) throw new Error('Missing PU repair routes');
  expect(previousHall.detail).toContain('11245');
  expect(currentHall.detail).toContain('11254');
  await AsyncStorage.setItem(key, JSON.stringify({
    building: '思高學苑', repairs: [{ id: 'leak', title: '洗手台漏水', category: 'water', location }],
  }));
  const { view } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Dormitory'));
  fireEvent.press(await view.findByText('設備問題'));
  fireEvent.press(await view.findByText(previousHall.label));
  expect(view.getByText(previousHall.detail)).toBeTruthy();
  expect(Linking.openURL).toHaveBeenLastCalledWith(previousHall.url);
  fireEvent.press(view.getByText('編輯'));
  fireEvent.changeText(view.getByLabelText('位置'), '思高學苑 103');
  expect(view.getByText(currentHall.detail)).toBeTruthy();
  fireEvent.press(view.getByText(currentHall.label));
  expect(Linking.openURL).toHaveBeenLastCalledWith(currentHall.url);
  fireEvent.press(view.getByText('取消'));
  expect(view.queryByText(currentHall.detail)).toBeNull();
  fireEvent.press(view.getByText(previousHall.label));
  expect(Linking.openURL).toHaveBeenLastCalledWith(previousHall.url);
  await AsyncStorage.removeItem(key);
});

test('PU guest Dormitory guide displays verified reference details without claiming live bed availability', async () => {
  setBrowsingSchoolId('pu');
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Dormitory'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('Dormitory'));
  fireEvent.press(view.getAllByText('宿舍指南')[0]);
  expect(await view.findByText('希嘉學苑')).toBeTruthy();
  expect(view.getByText(/24 小時校安專線/)).toBeTruthy();
  expect(view.getByText(/床位是否開放及實際金額/)).toBeTruthy();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('other campuses never show PU fees in the Dormitory guide', async () => {
  setBrowsingSchoolId('ncku');
  const { view } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Dormitory'));
  fireEvent.press(view.getAllByText('宿舍指南')[0]);
  expect(await view.findByText('尚無可核實的房型資訊')).toBeTruthy();
  expect(view.queryByText('思高學苑')).toBeNull();
});

test('Career wrapper keeps route.name for resolver and only offers registered public actions', async () => {
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Career'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('Career'));
  expect(view.getByText('前往成大生涯發展與就業輔導組')).toBeTruthy();
  expect(view.queryByText('查看校園活動')).toBeNull();
  fireEvent.press(view.getByText('查看校方公告'));
  await view.findByTestId('public-announcements-screen');
  expect(navigation.getCurrentRoute()?.name).toBe('公告總覽');
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('a school without configured sources shows honest unsupported states without inventing links', async () => {
  setBrowsingSchoolId('nthu');
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Health'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('Health'));
  expect(view.getByText(/尚未提供這所學校的健康服務入口/)).toBeTruthy();
  expect(view.queryByText('在瀏覽器開啟')).toBeNull();

  act(() => navigation.goBack());
  await view.findByTestId('login-landing');
  fireEvent.press(view.getByTestId('public-CourseCatalog'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('CourseCatalog'));
  expect(view.getByText(/也尚未登錄可核實的校方課程查詢連結/)).toBeTruthy();
  expect(queryCatalog).not.toHaveBeenCalled();
  expect(view.queryByText(/^開啟/)).toBeNull();

  act(() => navigation.goBack());
  fireEvent.press(await view.findByTestId('public-Dormitory'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('Dormitory'));
  expect(view.queryByText(/前往.*住宿/)).toBeNull();
  expect(await view.findByText(/這所學校目前沒有已核實的住宿專屬網站/)).toBeTruthy();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('switching school while public navigation is active keeps selected-school context', async () => {
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-Health'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('Health'));
  expect(view.getByText('成大心理健康與諮商輔導組')).toBeTruthy();

  act(() => setBrowsingSchoolId('ntpu'));
  await waitFor(() => expect(view.getByText('北大學生諮商中心')).toBeTruthy());
  expect(view.queryByText('成大心理健康與諮商輔導組')).toBeNull();
  await act(async () => {
    fireEvent.press(view.getByText('在瀏覽器開啟'));
  });
  expect(Linking.openURL).toHaveBeenCalledWith('https://new.ntpu.edu.tw/osa/counseling');

  act(() => navigation.goBack());
  await view.findByTestId('login-landing');
  expect(view.getByText(/查看國立臺北大學諮商、就醫與健康檢查資訊/)).toBeTruthy();
  expect(mockSchoolAuth.user).toBeNull();
  expect(mockSchoolAuth.profile).toBeNull();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});

test('PU guest CourseCatalog may query publicly but does not offer schedule mutations', async () => {
  setBrowsingSchoolId('pu');
  const publicCourse: CatalogCourse = {
    semester: '1151', code: 'GE001', name: '公開通識課程', nameEn: '',
    courseType: '通識', courseTypeKey: 'general', credits: 2,
    department: '通識教育中心', classOffered: '', teacher: '授課教師', teacherEmail: '',
    timePlaceRaw: '週一第 1、2 節', slots: [], capacity: 50, enrolled: 30, remaining: 20,
    language: '中文', languageKey: null, syllabusUrl: null, notes: '', tags: [], raw: {},
  };
  jest.mocked(queryCatalog).mockResolvedValueOnce({
    filter: { semester: '1151' }, courses: [publicCourse], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  });
  const { view, navigation, onUnhandledAction } = renderPublicStack();
  fireEvent.press(await view.findByTestId('public-CourseCatalog'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('CourseCatalog'));
  await waitFor(() => expect(queryCatalog).toHaveBeenCalled());
  const catalogCall = jest.mocked(queryCatalog).mock.calls[0];
  expect(catalogCall[1]?.schoolId).toBe('pu');
  expect(await view.findByText('公開通識課程')).toBeTruthy();
  expect(view.getByText(/訪客/)).toBeTruthy();
  expect(view.queryByText('加入本機課程清單')).toBeNull();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});
