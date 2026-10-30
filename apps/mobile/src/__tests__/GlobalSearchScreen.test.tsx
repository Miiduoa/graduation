import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList, ScrollView, StyleSheet } from 'react-native';
import { getDocs } from 'firebase/firestore';
import { GlobalSearchScreen } from '../screens/GlobalSearchScreen';
import { safeNavigate } from '../utils/safeNavigate';
import { interpretMobileCampusRequest } from '../services/campusIntentClient';
import { applyTheme } from '../ui/theme';

let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockAuth = {
  user: { uid: 'alice' } as { uid: string } | null,
  profile: { uid: 'alice', role: 'student' },
  loading: false,
  profileLoading: false,
  tokenExpired: false,
};
const mockSource = {
  listAnnouncements: jest.fn(),
  listEvents: jest.fn(),
  listCourses: jest.fn(),
  listPois: jest.fn(),
  listMenus: jest.fn(),
};
const mockHistory = {
  addSearch: jest.fn(),
  clearHistory: jest.fn(),
  recentSearches: jest.fn(() => []),
};
const navigation = { navigate: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../state/searchHistory', () => ({
  useSearchHistory: () => mockHistory,
  POPULAR_SEARCHES: { all: ['圖書館', '選課', '社團活動'] },
}));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => mockSource }));
jest.mock('../ui/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 118 }));
jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
jest.mock('../services/campusIntentClient', () => ({ interpretMobileCampusRequest: jest.fn() }));
jest.mock('../services/inboxActions', () => ({ navigateFromInboxTask: jest.fn(() => false) }));
jest.mock('../utils/campusOs', () => ({ isTeachingRole: (role: string) => role === 'teacher' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: object, ...constraints: unknown[]) => ({ ...ref, constraints }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ count }),
  getDocs: jest.fn(),
}));

function snapshot(rows: Array<{ id: string } & Record<string, unknown>> = []) {
  return { docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function search(view: ReturnType<typeof render>, text: string) {
  await act(async () => {
    fireEvent.changeText(view.getByLabelText('搜尋校園內容'), text);
  });
}
const announcement = {
  id: 'a1',
  title: '專題招募說明',
  body: '共同完成專題',
  publishedAt: '2026-10-25',
  schoolId: 'pu',
};

beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockAuth = {
    user: { uid: 'alice' },
    profile: { uid: 'alice', role: 'student' },
    loading: false,
    profileLoading: false,
    tokenExpired: false,
  };
  Object.values(mockSource).forEach((load) => load.mockReset().mockResolvedValue([]));
  jest
    .mocked(getDocs)
    .mockReset()
    .mockResolvedValue(snapshot() as never);
});

test('offers real shortcuts without starting every network source on entry', async () => {
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await act(async () => {});
  expect(view.getByText('靜宜大學 · 校園搜尋')).toBeTruthy();
  fireEvent.press(view.getByText('我的課表'));
  expect(safeNavigate).toHaveBeenCalledWith(
    navigation,
    'PersonalTimetable',
    undefined,
    expect.any(Object),
  );
  Object.values(mockSource).forEach((load) => expect(load).not.toHaveBeenCalled());
  expect(getDocs).not.toHaveBeenCalled();
  expect(view.queryByText('熱門搜尋')).toBeNull();
});

test('loading is not reported as no matching results', async () => {
  const pending = deferred<(typeof announcement)[]>();
  mockSource.listAnnouncements.mockReturnValueOnce(pending.promise);
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  expect(view.getByText('正在尋找符合的內容')).toBeTruthy();
  expect(view.queryByText('沒有符合的結果')).toBeNull();
  await act(async () => {
    pending.resolve([announcement]);
  });
  expect(view.getByText(announcement.title)).toBeTruthy();
  expect(view.getByText('已載入內容中找到 1 筆')).toBeTruthy();
});

test('partial failure preserves available results and retries only failed sources', async () => {
  mockSource.listAnnouncements.mockRejectedValueOnce(new Error('offline'));
  mockSource.listEvents.mockResolvedValue([
    { id: 'e1', title: '專題成果展', startsAt: '2026-10-25', description: '', schoolId: 'pu' },
  ]);
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  expect(view.getByText('公告暫時讀不到，其他結果仍可開啟。')).toBeTruthy();
  expect(view.getByText('專題成果展')).toBeTruthy();
  expect(view.queryByText('沒有符合的結果')).toBeNull();
  mockSource.listAnnouncements.mockResolvedValueOnce([announcement]);
  await act(async () => {
    fireEvent.press(view.getByText('重試未載入內容'));
  });
  expect(view.getByText(announcement.title)).toBeTruthy();
  expect(view.queryByText('公告暫時讀不到，其他結果仍可開啟。')).toBeNull();
  expect(mockSource.listAnnouncements).toHaveBeenCalledTimes(2);
  expect(mockSource.listEvents).toHaveBeenCalledTimes(1);
  expect(view.getByDisplayValue('專題')).toBeTruthy();
});

test('more than sixty loaded matches stay reachable and filtering resets pagination', async () => {
  mockSource.listAnnouncements.mockResolvedValue(
    Array.from({ length: 65 }, (_, index) => ({
      ...announcement,
      id: `a${index}`,
      title: `專題 ${index + 1}`,
    })),
  );
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  const resultList = () => view.UNSAFE_getByType(FlatList);
  expect(view.getByText('已載入內容中找到 65 筆')).toBeTruthy();
  expect(resultList().props.data).toHaveLength(30);
  fireEvent.press(view.getByText('顯示更多（還有 35 筆）'));
  expect(resultList().props.data).toHaveLength(60);
  fireEvent.press(view.getByText('顯示更多（還有 5 筆）'));
  expect(resultList().props.data[64].title).toBe('專題 65');
  fireEvent.press(view.getByLabelText('搜尋分類：公告'));
  expect(resultList().props.data).toHaveLength(30);
  expect(resultList().props.keyboardShouldPersistTaps).toBe('handled');
  expect(view.UNSAFE_getAllByType(ScrollView).some((scroll) => scroll.props.horizontal)).toBe(true);
});

test('keeps school aliases but filters explicit records from another school', async () => {
  mockSource.listAnnouncements.mockResolvedValue([
    { ...announcement, schoolId: 'tw-pu' },
    { ...announcement, id: 'nthu1', title: '清華專題資料', schoolId: 'nthu' },
  ]);
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  expect(view.getByText(announcement.title)).toBeTruthy();
  expect(view.queryByText('清華專題資料')).toBeNull();
});

test.each(['school', 'account', 'logout', 'revalidating', 'expired'])(
  '%s changes discard private content and late responses immediately',
  async (change) => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    jest.mocked(getDocs).mockImplementation(async (request) => {
      const path = (request as unknown as { path: string }).path;
      if (path === 'users/alice/groups') return snapshot([{ id: 'g1', groupId: 'g1' }]) as never;
      if (path === 'groups/g1/posts') return (await pending.promise) as never;
      return snapshot() as never;
    });
    const view = render(<GlobalSearchScreen navigation={navigation} />);
    await search(view, '專題');
    if (change === 'school') mockSchool = { id: 'nthu', name: '國立清華大學' };
    if (change === 'account')
      mockAuth = { ...mockAuth, user: { uid: 'bob' }, profile: { uid: 'bob', role: 'student' } };
    if (change === 'logout') mockAuth = { ...mockAuth, user: null };
    if (change === 'revalidating') mockAuth = { ...mockAuth, loading: true };
    if (change === 'expired') mockAuth = { ...mockAuth, tokenExpired: true };
    view.rerender(<GlobalSearchScreen navigation={navigation} />);
    await act(async () => {
      pending.resolve(snapshot([{ id: 'p1', title: '專題私人草稿' }]));
    });
    expect(view.queryByText('專題私人草稿')).toBeNull();
    expect(view.queryByDisplayValue('專題')).toBeNull();
    expect(view.getByText('直接開啟')).toBeTruthy();
  },
);

test('logout removes already loaded private results and guests never read memberships', async () => {
  jest.mocked(getDocs).mockImplementation(async (request) => {
    const path = (request as unknown as { path: string }).path;
    if (path === 'users/alice/groups') return snapshot([{ id: 'g1' }]) as never;
    if (path === 'groups/g1/posts') return snapshot([{ id: 'p1', title: '專題私人草稿' }]) as never;
    return snapshot() as never;
  });
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  expect(view.getByText('專題私人草稿')).toBeTruthy();
  mockAuth = { ...mockAuth, user: null };
  view.rerender(<GlobalSearchScreen navigation={navigation} />);
  jest.mocked(getDocs).mockClear();
  await search(view, '專題');
  fireEvent.press(view.getByLabelText('搜尋分類：群組與作業'));
  expect(view.queryByText('專題私人草稿')).toBeNull();
  expect(view.getByText('登入後搜尋自己的群組')).toBeTruthy();
  expect(getDocs).not.toHaveBeenCalled();
});

test('group ids prevent duplicate-key collisions and partial group reads remain retryable', async () => {
  jest.mocked(getDocs).mockImplementation(async (request) => {
    const path = (request as unknown as { path: string }).path;
    if (path === 'users/alice/groups') return snapshot([{ id: 'g1' }, { id: 'g2' }]) as never;
    if (path.endsWith('/posts'))
      return snapshot([{ id: 'same-id', title: `專題 ${path}` }]) as never;
    throw new Error('permission-denied');
  });
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  expect(view.getByText('專題 groups/g1/posts')).toBeTruthy();
  expect(view.getByText('專題 groups/g2/posts')).toBeTruthy();
  const results = view.UNSAFE_getByType(FlatList).props.data;
  expect(new Set(results.map((row: { id: string }) => row.id)).size).toBe(2);
  expect(view.getByText('群組與作業暫時讀不到，其他結果仍可開啟。')).toBeTruthy();
});

test('bounded group history offers a path to older content instead of promising completeness', async () => {
  jest.mocked(getDocs).mockImplementation(async (request) => {
    const path = (request as unknown as { path: string }).path;
    if (path === 'users/alice/groups') return snapshot([{ id: 'g1' }]) as never;
    if (path.endsWith('/posts'))
      return snapshot(
        Array.from({ length: 31 }, (_, index) => ({ id: `p${index}`, title: `專題 ${index}` })),
      ) as never;
    return snapshot() as never;
  });
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  expect(view.getByText('群組搜尋只包含最近的貼文與作業；較早內容請到所屬群組查看。')).toBeTruthy();
  fireEvent.press(view.getByText('前往我的群組'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'Groups');
});

test('menu hits open their actual restaurant and public courses retain the search term', async () => {
  mockSource.listMenus.mockResolvedValue([
    { id: 'm1', name: '專題套餐', cafeteria: '學生餐廳', cafeteriaId: 'caf1', price: 80 },
  ]);
  mockSource.listCourses.mockResolvedValue([
    {
      id: 'pu-crs-1',
      code: 'IM301',
      name: '專題研究',
      instructor: '張老師',
      semester: '1151',
      schedule: [],
    },
  ]);
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  fireEvent.press(view.getByLabelText('餐點：專題套餐'));
  expect(safeNavigate).toHaveBeenCalledWith(
    navigation,
    'Storefront',
    { cafeteriaId: 'caf1' },
    expect.any(Object),
  );
  fireEvent.press(view.getByLabelText('課程：IM301 · 專題研究'));
  expect(safeNavigate).toHaveBeenCalledWith(
    navigation,
    'CourseCatalog',
    { filter: { keyword: 'IM301', semester: '1151' } },
    expect.any(Object),
  );
  expect(mockHistory.addSearch).toHaveBeenCalledWith('專題', 'all');
});

test('search results and selected categories use the OLED theme with readable touch targets', async () => {
  applyTheme('dark');
  mockSource.listAnnouncements.mockResolvedValue([announcement]);
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '專題');
  const button = view.getByLabelText(`公告：${announcement.title}`);
  expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe('#000000');
  const category = view.getByLabelText('搜尋分類：公告');
  expect(StyleSheet.flatten(category.props.style).minHeight).toBeGreaterThanOrEqual(44);
  fireEvent.press(category);
  await waitFor(() =>
    expect(view.getByLabelText('搜尋分類：公告').props.accessibilityState.selected).toBe(true),
  );
});

test('spoken-style questions show direct service links even without an exact keyword hit', async () => {
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '圖書館怎麼走');
  fireEvent.press(view.getByLabelText('前往校園地圖'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'MapV2', undefined);
});


test('AI understands a multi-step campus request without navigating or writing on its own', async () => {
  jest.mocked(interpretMobileCampusRequest).mockResolvedValue({
    status: 'understood', source: 'model',
    summary: '先查空堂，再找讀書和吃飯的地方。',
    destinations: ['/timetable', '/library', '/cafeteria'], clarifyingQuestion: null,
  });
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '明天沒課想找地方讀書再吃飯');
  expect(interpretMobileCampusRequest).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByLabelText('用 AI 理解校園搜尋')));
  expect(view.getByText('先查空堂，再找讀書和吃飯的地方。')).toBeTruthy();
  expect(view.getByText('AI 建議直接開啟')).toBeTruthy();
  expect(safeNavigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('前往圖書館'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'Library', undefined);
});


test('course search shortcuts select the courses tab in the native workspace', async () => {
  const view = render(<GlobalSearchScreen navigation={navigation} />);
  await search(view, '我要交作業');
  fireEvent.press(view.getByLabelText('前往課程與作業'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'NuniWorkspace', { tab: 'courses' });
});
