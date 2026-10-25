import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { Linking } from 'react-native';
import { PreAuthStack } from '../screens/PreAuthStack';
import { CourseCatalogScreen } from '../screens/CourseCatalogScreen';
import { queryCatalog, type CatalogCourse } from '../services/courseCatalogClient';
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
}));
jest.mock('../state/schedule', () => ({
  useSchedule: () => ({
    courses: [],
    addCourse: jest.fn(),
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
    return <Text testID="platform-workspace">Campus One 帳號</Text>;
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

test('catalog refreshes a new incoming search and ignores the earlier response', async () => {
  setBrowsingSchoolId('pu');
  let resolveFirst!: (value: Awaited<ReturnType<typeof queryCatalog>>) => void;
  jest.mocked(queryCatalog).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
  const course: CatalogCourse = {
    semester: '1151', code: 'IM302', name: '新的搜尋課程', nameEn: '',
    courseType: '必修', courseTypeKey: 'required', credits: 3,
    department: '資訊管理學系', classOffered: '', teacher: '授課教師', teacherEmail: '',
    timePlaceRaw: '', slots: [], capacity: 50, enrolled: 30, remaining: 20,
    language: '中文', languageKey: null, syllabusUrl: null, notes: '', tags: [], raw: {},
  };
  jest.mocked(queryCatalog).mockResolvedValueOnce({
    filter: { semester: '1151', keyword: 'IM302' }, courses: [course], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  });
  const view = render(<CourseCatalogScreen route={{ params: { filter: { semester: '1151', keyword: 'IM301' } } }} />);
  await waitFor(() => expect(queryCatalog).toHaveBeenCalledTimes(1));
  view.rerender(<CourseCatalogScreen route={{ params: { filter: { semester: '1151', keyword: 'IM302' } } }} />);
  expect(await view.findByText('新的搜尋課程')).toBeTruthy();
  expect(view.getByDisplayValue('IM302')).toBeTruthy();
  await act(async () => { resolveFirst({
    filter: { semester: '1151', keyword: 'IM301' },
    courses: [{ ...course, code: 'IM301', name: '上一筆搜尋的過期結果' }], totalCount: 1,
    source: 'live', fetchedAt: Date.now(), showRemain: false,
  }); });
  expect(view.queryByText('上一筆搜尋的過期結果')).toBeNull();
  expect(view.getByText('新的搜尋課程')).toBeTruthy();
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
  expect(view.getByText(/國立成功大學尚未接入 Campus One 內建課綱查詢/)).toBeTruthy();
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
  expect(await view.findByText('住宿工作區')).toBeTruthy();
  expect(view.getByText(/訪客紀錄只存在此裝置/)).toBeTruthy();
  fireEvent.press(view.getByText('設備問題'));
  expect(view.getByText('＋ 記錄問題')).toBeTruthy();
  fireEvent.press(view.getByText('＋ 記錄問題'));
  expect(view.getByText('新增問題')).toBeTruthy();
  expect(view.queryByTestId('school-login-form')).toBeNull();
  expect(onUnhandledAction).not.toHaveBeenCalled();
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
  expect(view.queryByText('加入我的課表')).toBeNull();
  expect(onUnhandledAction).not.toHaveBeenCalled();
});
