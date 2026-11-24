import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import EventScreen from '../screens/EventDetailAiFirstScreen';
import EventsScreen from '../screens/EventsListAiFirstScreen';
import { CampusEventCalendarDraftScreen } from '../screens/PersonalCalendarScreen';
import { PersonalImportAuthorityProvider } from '../state/personalImportAuthority';
import { campusEventCalendarDraft } from '../services/campusEventCalendarDraft';
import { loadCampusEvent, loadCampusEventPage } from '../services/publicCampusContent';
import {
  loadPersonalImports,
  personalImportStorageKey,
  subscribePersonalImports,
  type PersonalImportScope,
} from '../services/personalImports';

jest.unmock('@react-navigation/native');
jest.mock('../state/auth', () => ({
  useAuth: () => require('react').useContext(mockAuthContext),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: { id: require('react').useContext(mockScopeContext)?.schoolId ?? 'pu', name: '校園' },
    schoolId: require('react').useContext(mockScopeContext)?.schoolId ?? 'pu',
    selectionReady: true,
  }),
}));
jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () =>
    mockUseLiveScope
      ? jest.requireActual('../state/personalImportScope').usePersonalImportScope()
      : require('react').useContext(mockScopeContext),
}));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    pendingLogout: false,
    loading: mockVerifying,
    session: mockPlatformSession,
    signInGeneration: mockSignInGeneration,
  }),
}));
jest.mock('../services/publicCampusContent', () => ({
  loadCampusEvent: jest.fn(),
  loadCampusEventPage: jest.fn(),
}));
jest.mock('../hooks/useEventRegistrations', () => ({
  useEventRegistrations: () => ({ states: [] }),
}));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 60 }));
jest.mock('../services/personalEventReminders', () => ({
  listPersonalEventReminderEntries: async () => ({}),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const Stack = createNativeStackNavigator();
const activity = {
  schoolId: 'pu',
  id: 'outreach',
  source: 'school-events' as const,
  title: '夜間觀星',
  startsAt: '2030-11-24T15:30:00Z',
  endsAt: '2030-11-24T16:45:00Z',
  calendarTime: { startsAt: '2030-11-24T15:30:00Z', endsAt: '2030-11-24T16:45:00Z' },
  location: '天文台',
  description: '夜間天文觀測',
};
let mockScope: PersonalImportScope;
let mockVerifying: boolean;
let mockSignInGeneration: number;
let mockUseLiveScope: boolean;
let mockPlatformSession: { platformAccountId: string } | null;
let mockAuth: { user: { uid: string } | null; loading: boolean };
const mockAuthContext = React.createContext<typeof mockAuth | null>(null);
const mockScopeContext = React.createContext<PersonalImportScope | null>(null);

function Journey({ openOldDraft = false }: { openOldDraft?: boolean }) {
  return (
    <mockAuthContext.Provider value={mockAuth}>
      <PersonalImportAuthorityProvider>
        <JourneyStack key={String(openOldDraft)} openOldDraft={openOldDraft} />
      </PersonalImportAuthorityProvider>
    </mockAuthContext.Provider>
  );
}

function JourneyStack({ openOldDraft }: { openOldDraft: boolean }) {
  const initialDraft = openOldDraft ? campusEventCalendarDraft(activity, mockScope, Date.now()) : null;
  return (
    <mockScopeContext.Provider value={mockVerifying ? null : mockScope}>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={openOldDraft ? 'CampusEventCalendarDraft' : '活動總覽'}
          screenOptions={{ headerShown: false, animation: 'none' }}
        >
          <Stack.Screen name="活動總覽" component={EventsScreen} />
          <Stack.Screen name="活動詳情" component={EventScreen} />
          <Stack.Screen
            name="CampusEventCalendarDraft"
            component={CampusEventCalendarDraftScreen}
            initialParams={initialDraft ? { campusEvent: initialDraft } : undefined}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </mockScopeContext.Provider>
  );
}

beforeEach(async () => {
  mockScope = { owner: 'nuni:account-a', schoolId: 'pu' };
  mockVerifying = false;
  mockSignInGeneration = 1;
  mockUseLiveScope = false;
  mockPlatformSession = { platformAccountId: 'account-a' };
  mockAuth = { user: { uid: 'student' }, loading: false };
  await AsyncStorage.clear();
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValue({ items: [activity], source: activity.source, nextCursor: null });
  jest.mocked(loadCampusEvent).mockResolvedValue(activity);
});

async function openDraft() {
  const view = render(<Journey />);
  fireEvent.press(await view.findByText(activity.title));
  fireEvent.press(await view.findByRole('button', { name: '開啟行程草稿' }));
  await view.findByText('確認活動行程');
  return view;
}

test('選取活動後，nuni 直接打開可修改的跨日草稿，確認後才存入目前帳校', async () => {
  const view = await openDraft();
  expect(loadCampusEvent).toHaveBeenCalledWith('pu', activity.id, activity.source);
  expect(view.getByLabelText('標題').props.value).toBe(activity.title);
  expect(view.getByLabelText('日期（YYYY-MM-DD）').props.value).toBe('2030-11-24');
  expect(view.getByLabelText('開始時間（HH:MM）').props.value).toBe('23:30');
  expect(view.getByLabelText('結束日期（跨日才填）').props.value).toBe('2030-11-25');
  expect(view.getByLabelText('結束時間（HH:MM）').props.value).toBe('00:45');
  expect(view.getByLabelText('地點（選填）').props.value).toBe(activity.location);
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(0);
  fireEvent.changeText(view.getByLabelText('地點（選填）'), '天文台入口集合');
  fireEvent.press(await view.findByRole('button', { name: '儲存行程', disabled: false }));
  await waitFor(async () =>
    expect((await loadPersonalImports(mockScope)).records).toEqual([
      expect.objectContaining({
        title: activity.title,
        location: '天文台入口集合',
        endDate: '2030-11-25',
      }),
    ]),
  );
  await view.findByText(/已在這台裝置新增 1 筆/);
  mockVerifying = true;
  view.rerender(<Journey />);
  expect(view.getByText(/已在這台裝置新增 1 筆/)).toBeTruthy();
  mockVerifying = false;
  view.rerender(<Journey />);
  await view.findByText(/已在這台裝置新增 1 筆/);
  expect(view.queryByLabelText('標題')).toBeNull();
});

test.each([
  { owner: 'nuni:other', schoolId: 'pu' },
  { owner: 'nuni:account-a', schoolId: 'other' },
])('未儲存的活動切換至 %o 後失效，切回也不會重現', async (nextScope) => {
  const view = await openDraft();
  const original = mockScope;
  mockVerifying = true;
  view.rerender(<Journey />);
  await view.findByText('正在確認帳號與校園…');
  expect(view.queryByLabelText('標題')).toBeNull();
  mockVerifying = false;
  mockScope = nextScope;
  mockPlatformSession = { platformAccountId: nextScope.owner.slice(5) };
  view.rerender(<Journey />);
  await view.findByText('請回到目前校園的活動頁重新開啟草稿。');
  expect(view.queryByLabelText('標題')).toBeNull();
  expect((await loadPersonalImports(nextScope)).records).toHaveLength(0);
  mockScope = original;
  mockPlatformSession = { platformAccountId: original.owner.slice(5) };
  view.rerender(<Journey />);
  expect(view.queryByLabelText('標題')).toBeNull();
  expect((await loadPersonalImports(original)).records).toHaveLength(0);
});

test.each([
  ['firebase:student', '切換'],
  ['nuni:account-a', '切換'],
  ['firebase:student', '登出'],
  ['nuni:account-a', '登出'],
  ['nuni:account-a', '先於 Nuni 登出'],
  ['nuni:account-a', '範圍失效前登出'],
])('卸載 %s 的舊草稿並撤銷 Firebase %s 時未完成的寫入', async (owner, transition) => {
  if (owner === 'firebase:student') mockPlatformSession = null;
  const original = { owner, schoolId: 'pu' };
  mockScope = original;
  const view = await openDraft();
  const key = personalImportStorageKey(original);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const nativeSetItem = setItem.getMockImplementation()!;
  let finishWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
  setItem.mockImplementationOnce(async (storageKey, value) => {
    await pendingWrite;
    await nativeSetItem(storageKey, value);
  });
  setItem.mockClear();
  fireEvent.press(await view.findByRole('button', { name: '儲存行程', disabled: false }));
  await waitFor(() => expect(setItem).toHaveBeenCalledWith(key, expect.any(String)));

  if (transition === '登出') mockPlatformSession = null;
  mockAuth = transition !== '切換'
    ? { user: null, loading: false }
    : { user: { uid: 'another-student' }, loading: true };
  mockVerifying = transition !== '範圍失效前登出';
  view.rerender(<Journey />);

  await act(async () => {
    finishWrite();
    expect((await loadPersonalImports(original)).records).toEqual([]);
  });
  await view.findByText('請回到目前校園的活動頁重新開啟草稿。');
  expect(view.queryByLabelText('標題')).toBeNull();
  expect(await AsyncStorage.getItem(key)).toBeNull();

  mockAuth = { user: { uid: 'student' }, loading: false };
  mockVerifying = false;
  view.rerender(<Journey />);
  expect(view.getByText('請回到目前校園的活動頁重新開啟草稿。')).toBeTruthy();
  expect(view.queryByLabelText('標題')).toBeNull();
});

test.each([false, true])('Firebase 登出撤銷排隊的活動草稿寫入（同時登入 Nuni：%s）', async (signsInAgain) => {
  mockUseLiveScope = true;
  const view = await openDraft();
  const key = personalImportStorageKey(mockScope);
  const getItem = jest.mocked(AsyncStorage.getItem);
  const setItem = jest.mocked(AsyncStorage.setItem);
  let finishRead!: (raw: string | null) => void;
  const pendingRead = new Promise<string | null>((resolve) => { finishRead = resolve; });
  getItem.mockClear();
  getItem.mockImplementationOnce(() => pendingRead);
  setItem.mockClear();
  fireEvent.press(await view.findByRole('button', { name: '儲存行程', disabled: false }));
  await waitFor(() => expect(getItem).toHaveBeenCalledWith(key));

  mockAuth = { user: null, loading: false };
  if (signsInAgain) mockSignInGeneration += 1;
  view.rerender(<Journey />);
  await act(async () => {
    finishRead(null);
  });
  expect(setItem).not.toHaveBeenCalledWith(key, expect.any(String));
  expect(await getItem(key)).toBeNull();
  expect(view.queryByLabelText('標題')).toBeNull();
  expect(view.getByText('請回到目前校園的活動頁重新開啟草稿。')).toBeTruthy();

  mockVerifying = true;
  view.rerender(<Journey />);
  expect(view.queryByLabelText('標題')).toBeNull();
});

test('Firebase 先登出時，活動詳情與新掛載的舊路由都無法開啟舊 Nuni 草稿', async () => {
  mockUseLiveScope = true;
  const view = render(<Journey />);
  fireEvent.press(await view.findByText(activity.title));
  await view.findByRole('button', { name: '開啟行程草稿' });

  mockAuth = { user: null, loading: false };
  view.rerender(<Journey />);
  expect(view.queryByRole('button', { name: '開啟行程草稿' })).toBeNull();

  // Simulate an old route payload arriving after logout, with a newly mounted draft screen.
  view.rerender(<Journey openOldDraft />);
  await view.findByText('請回到目前校園的活動頁重新開啟草稿。');
  expect(view.queryByRole('button', { name: '儲存行程' })).toBeNull();
  expect((await loadPersonalImports(mockScope)).records).toEqual([]);
});

test('清除檢查點時 Firebase 已切換，還原舊帳本且不發出變更通知', async () => {
  const original = mockScope;
  const view = await openDraft();
  const key = personalImportStorageKey(original);
  const multiRemove = jest.mocked(AsyncStorage.multiRemove);
  const nativeMultiRemove = multiRemove.getMockImplementation()!;
  const clearing = jest.fn();
  let finishCleanup!: () => void;
  const pendingCleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
  multiRemove.mockImplementationOnce(async (keys) => {
    clearing(keys);
    await pendingCleanup;
    await nativeMultiRemove(keys);
  });
  const listener = jest.fn();
  const unsubscribe = subscribePersonalImports(listener);
  try {
    fireEvent.press(await view.findByRole('button', { name: '儲存行程', disabled: false }));
    await waitFor(() => expect(clearing).toHaveBeenCalledWith([key + ':checkpoint']));
    expect(JSON.parse((await AsyncStorage.getItem(key))!).records).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();

    mockAuth = { user: { uid: 'another-student' }, loading: true };
    mockVerifying = true;
    view.rerender(<Journey />);
    await view.findByText('請回到目前校園的活動頁重新開啟草稿。');
    expect(view.queryByLabelText('標題')).toBeNull();

    const read = loadPersonalImports(original);
    await act(async () => {
      finishCleanup();
      expect((await read).records).toEqual([]);
    });
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    finishCleanup();
    unsubscribe();
  }
});

test.each([true, false])('同帳校重驗期間保留編輯與取消狀態（暫無 Nuni session：%s）', async (sessionMissing) => {
  const view = await openDraft();
  fireEvent.changeText(view.getByLabelText('標題'), '與社團一起觀星');
  mockVerifying = true;
  if (sessionMissing) mockPlatformSession = null;
  view.rerender(<Journey />);
  await view.findByText('正在確認帳號與校園…');
  expect(view.queryByRole('button', { name: '儲存行程' })).toBeNull();
  expect(view.queryByLabelText('標題')).toBeNull();
  expect(view.queryByText('請回到目前校園的活動頁重新開啟草稿。')).toBeNull();
  mockVerifying = false;
  mockPlatformSession = { platformAccountId: 'account-a' };
  view.rerender(<Journey />);
  expect((await view.findByLabelText('標題')).props.value).toBe('與社團一起觀星');
  fireEvent.press(await view.findByRole('button', { name: '取消', disabled: false }));
  mockVerifying = true;
  if (sessionMissing) mockPlatformSession = null;
  view.rerender(<Journey />);
  mockVerifying = false;
  mockPlatformSession = { platformAccountId: 'account-a' };
  view.rerender(<Journey />);
  expect(view.queryByLabelText('標題')).toBeNull();
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(0);
});

test('未公布結束時刻時保留空欄，必須由使用者補上才能儲存', async () => {
  jest
    .mocked(loadCampusEvent)
    .mockResolvedValue({ ...activity, calendarTime: { startsAt: activity.startsAt } });
  const view = await openDraft();
  expect(view.getByLabelText('結束時間（HH:MM）').props.value).toBe('');
  expect(view.getByRole('button', { name: '儲存行程', disabled: true })).toBeTruthy();
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(0);
});
