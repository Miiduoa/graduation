import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  rootNavigationRef,
  markSchoolNavigationReady,
  markSchoolNavigationUnready,
  type RootTabParamList,
} from '../app/rootNavigation';
import {
  publicNavigationRef,
  markPublicNavigationReady,
  markPublicNavigationUnready,
} from '../app/publicNavigation';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
let mockRealNavigation = false;
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DormNotificationHandoff } from '../app/DormNotificationHandoff';
import { getLastNotificationResponseAsync } from '../services/notifications';

const mockNavigate = jest.fn(() => true);
const mockPublicNavigate = jest.fn();
const mockSelection = jest.fn();
const mockRead = jest.fn();
const mockDoc = jest.fn((_db, ...path: string[]) => path.join('/'));
const mockClear = jest.fn();
const mockReceiptId = 'dorm_' + 'a'.repeat(64);
const mockDeliveryKey = '00000000-0000-4000-8000-000000000001';
const mockEnvelope = {
  type: 'announcement',
  channel: 'dormitory',
  schoolId: 'pu',
  dormAnnouncementId: 'water',
  inboxNotificationId: mockReceiptId,
  deliveryKey: mockDeliveryKey,
};
type Tap = {
  notification: { request: { identifier: string; content: { data: Record<string, unknown> } } };
};
function tap(data: Record<string, unknown> = mockEnvelope, identifier = 'device-event'): Tap {
  return { notification: { request: { identifier, content: { data } } } };
}
let mockStored: Tap | null;
let mockListener: ((event: Tap) => void) | null;
let mockReady: boolean;
let mockUid: string | null;
let mockSchool: string;
let mockFirebaseUid: string | null;
let mockLoading: boolean;
const mockReadyListeners = new Set<() => void>();
jest.mock('../state/school', () => ({
  useSchool: () => ({
    selectionReady: true,
    schoolId: mockSchool,
    school: { id: mockSchool },
    setSelection: mockSelection,
  }),
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: mockUid ? { uid: mockUid } : null,
    profile: mockUid ? { uid: mockUid, schoolId: 'pu', role: 'student' } : null,
    loading: mockLoading,
    profileLoading: false,
    tokenExpired: false,
  }),
}));
jest.mock('../services/schoolLoginAvailability', () => ({
  isStudentIdLoginAvailable: (school: string) => school === 'pu',
}));
jest.mock('../app/rootNavigation', () => {
  const actual = jest.requireActual('../app/rootNavigation');
  return {
    ...actual,
    isSchoolNavigationReady: () =>
      mockRealNavigation ? actual.isSchoolNavigationReady() : mockReady,
    rootNavigateNested: (...args: []) =>
      mockRealNavigation ? actual.rootNavigateNested(...args) : mockNavigate(...args),
    subscribeSchoolNavigationReady: (cb: () => void) => {
      if (mockRealNavigation) return actual.subscribeSchoolNavigationReady(cb);
      mockReadyListeners.add(cb);
      return () => mockReadyListeners.delete(cb);
    },
  };
});
jest.mock('../app/publicNavigation', () => {
  const actual = jest.requireActual('../app/publicNavigation');
  return {
    ...actual,
    publicNavigateSchoolLogin: () => mockRealNavigation ? actual.publicNavigateSchoolLogin() : mockPublicNavigate('SSOLogin'),
    isPublicNavigationReady: () => (mockRealNavigation ? actual.isPublicNavigationReady() : true),
    subscribePublicNavigationReady: (cb: () => void) =>
      mockRealNavigation ? actual.subscribePublicNavigationReady(cb) : () => {},
  };
});
jest.mock('../firebase', () => ({
  isFirebaseMockMode: () => false,
  getDb: () => ({}),
  getAuthInstance: () => ({ currentUser: mockFirebaseUid ? { uid: mockFirebaseUid } : null }),
}));
jest.mock('firebase/firestore', () => ({
  doc: (...args: [unknown, ...string[]]) => mockDoc(...args),
  getDocFromServer: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('../services/inboxActions', () => ({ navigateFromInboxTask: jest.fn() }));
jest.mock('../services/notifications', () => ({
  addNotificationResponseReceivedListener: (cb: (event: Tap) => void) => {
    mockListener = cb;
    return {
      remove: () => {
        if (mockListener === cb) mockListener = null;
      },
    };
  },
  syncPushTokenForUser: jest.fn(async () => null),
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: () => mockClear(),
}));
const root = () => (
  <DormNotificationHandoff publicContent={<Text>公開導覽</Text>}>
    <Text>校園導覽</Text>
  </DormNotificationHandoff>
);
const snapshot = (data: Record<string, unknown> = mockEnvelope) => ({
  data: () => ({ type: 'announcement', schoolId: 'pu', data }),
});
const missing = { data: () => undefined };
const detail = [
  '校園',
  'Dormitory',
  { notificationView: 'announcements', sourceSchoolId: 'pu', dormAnnouncementId: 'water' },
];
function account(uid: string | null) {
  mockUid = uid;
  mockFirebaseUid = uid;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRealNavigation = false;
  mockSchool = 'pu';
  account('alice');
  mockLoading = false;
  mockReady = true;
  mockListener = null;
  mockReadyListeners.clear();
  mockStored = tap();
  mockRead.mockReset().mockResolvedValue(snapshot());
  jest
    .mocked(getLastNotificationResponseAsync)
    .mockReset()
    .mockImplementation(async () => mockStored as never);
  mockClear.mockReset().mockImplementation(async () => {
    mockStored = null;
  });
});
test('a cold tap survives auth loading, explicit school selection, and the public login form until the school navigator is ready', async () => {
  mockSchool = 'nthu';
  account(null);
  mockLoading = true;
  mockReady = false;
  const view = render(root());
  await act(async () => {});
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  mockLoading = false;
  view.rerender(root());
  expect(await view.findByText('公開導覽')).toBeTruthy();
  fireEvent.press(await view.findByText('切換至靜宜大學'));
  expect(mockSelection).toHaveBeenCalledWith({ schoolId: 'pu', code: '', schoolName: '靜宜大學' });
  expect(mockPublicNavigate).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  mockSchool = 'tw-pu';
  view.rerender(root());
  fireEvent.press(await view.findByText('登入學校帳號'));
  expect(mockPublicNavigate).toHaveBeenCalledWith('SSOLogin');
  account('alice');
  view.rerender(root());
  expect(view.getByText('校園導覽')).toBeTruthy();
  expect(mockRead).not.toHaveBeenCalled();
  mockReady = true;
  await act(async () => mockReadyListeners.forEach((cb) => cb()));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(...detail));
  expect(mockRead).toHaveBeenCalledWith('users/alice/notifications/' + mockReceiptId);
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
});
test('the next signed-in account only reads its own inbox and does not open the former recipient’s announcement', async () => {
  account(null);
  mockRead.mockResolvedValue(missing);
  const view = render(root());
  await view.findByText('登入學校帳號');
  account('bob');
  view.rerender(root());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('訊息', 'Notifications'));
  expect(mockRead.mock.calls).toEqual([['users/bob/notifications/' + mockReceiptId]]);
  expect(mockNavigate).not.toHaveBeenCalledWith(...detail);
});
test.each([
  { deliveryKey: '00000000-0000-4000-8000-000000000002' },
  { schoolId: 'tw-pu' },
  { dormAnnouncementId: 'other' },
  { channel: 'events' },
  { inboxNotificationId: 'dorm_' + 'b'.repeat(64) },
])('a server envelope mismatch opens the owner’s inbox', async (different) => {
  mockRead.mockResolvedValue(snapshot({ ...mockEnvelope, ...different }));
  render(root());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('訊息', 'Notifications'));
  expect(mockNavigate).not.toHaveBeenCalledWith(...detail);
});
test.each([
  { deliveryKey: undefined },
  { inboxNotificationId: 'unsafe/path' },
  { dormAnnouncementId: undefined },
])(
  'legacy or malformed pushes open the current inbox without reading an unverified path',
  async (change) => {
    mockStored = tap({ ...mockEnvelope, ...change });
    render(root());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('訊息', 'Notifications'));
    expect(mockRead).not.toHaveBeenCalled();
  },
);
test('a late Alice read cannot navigate after Bob takes over', async () => {
  let resolve!: (value: unknown) => void;
  mockRead
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(missing);
  const view = render(root());
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  account('bob');
  view.rerender(root());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('訊息', 'Notifications'));
  await act(async () => resolve(snapshot()));
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockRead.mock.calls).toEqual([
    ['users/alice/notifications/' + mockReceiptId],
    ['users/bob/notifications/' + mockReceiptId],
  ]);
});
test('Firebase changing before React updates discards a completed read and permits retry', async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(root());
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  mockFirebaseUid = 'bob';
  await act(async () => resolve(snapshot()));
  expect(await view.findByText('重試')).toBeTruthy();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  mockFirebaseUid = 'alice';
  fireEvent.press(view.getByText('重試'));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(...detail));
});
test('an offline verification keeps the OS tap available until the user retries', async () => {
  mockRead.mockRejectedValueOnce(new Error('offline'));
  const view = render(root());
  await view.findByText('重試');
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('重試'));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(...detail));
});
test('a new unrelated tap supersedes a pending dorm lookup and is left to its handler', async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(root());
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  const other = tap({ category: 'nuni_assignment_due', lookupToken: 'personal' }, 'personal');
  mockStored = other;
  await act(async () => {
    mockListener!(other);
    resolve(snapshot());
  });
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});
test('cancelling a wrong-campus prompt clears only its exact tap', async () => {
  mockSchool = 'nthu';
  const view = render(root());
  const cancel = await view.findByText('取消開啟');
  mockStored = tap({ category: 'personal_class_occurrence' }, 'new');
  fireEvent.press(cancel);
  await act(async () => {});
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockRead).not.toHaveBeenCalled();
});
test('switching campus during verification conceals the old result and keeps the tap for return', async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(root());
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  mockSchool = 'nthu';
  view.rerender(root());
  await act(async () => resolve(snapshot()));
  expect(await view.findByText('切換至靜宜大學')).toBeTruthy();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
  mockSchool = 'pu';
  view.rerender(root());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(...detail));
});
test('a cold response and duplicate live tap open the verified destination once', async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(root());
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  await act(async () => {
    mockListener!(tap());
    resolve(snapshot());
  });
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
  await act(async () => mockListener!(tap()));
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledTimes(1);
});

const PublicStack = createNativeStackNavigator<PreAuthStackParamList, undefined>();
const CampusStack = createNativeStackNavigator<
  { CampusHome: undefined; Dormitory: { sourceSchoolId: string; dormAnnouncementId: string } },
  undefined
>();
const Tabs = createBottomTabNavigator<RootTabParamList, undefined>();
function ScreenName({ route }: { route: { name: string } }) {
  return <Text>{route.name}</Text>;
}
function PublicRoutes() {
  return (
    <NavigationContainer ref={publicNavigationRef} onReady={markPublicNavigationReady}>
      <PublicStack.Navigator id={undefined} screenOptions={{ headerShown: false }}>
        <PublicStack.Screen name="LoginLanding" component={ScreenName} />
        <PublicStack.Screen name="SSOLogin" component={ScreenName} />
      </PublicStack.Navigator>
    </NavigationContainer>
  );
}
function CampusRoutes() {
  return (
    <CampusStack.Navigator id={undefined} screenOptions={{ headerShown: false }}>
      <CampusStack.Screen name="CampusHome" component={ScreenName} />
      <CampusStack.Screen name="Dormitory" component={ScreenName} />
    </CampusStack.Navigator>
  );
}
function SchoolRoutes() {
  return (
    <NavigationContainer ref={rootNavigationRef} onReady={markSchoolNavigationReady}>
      <Tabs.Navigator id={undefined} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="Today" component={ScreenName} />
        <Tabs.Screen name="校園" component={CampusRoutes} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
test('the public and authenticated navigation containers hand off from SSOLogin into the nested dorm detail', async () => {
  mockRealNavigation = true;
  account(null);
  const app = () => (
    <DormNotificationHandoff publicContent={<PublicRoutes />}>
      <SchoolRoutes />
    </DormNotificationHandoff>
  );
  const view = render(app());
  try {
    fireEvent.press(await view.findByText('登入學校帳號'));
    await waitFor(() => expect(publicNavigationRef.getCurrentRoute()?.name).toBe('SSOLogin'));
    account('alice');
    view.rerender(app());
    await waitFor(() =>
      expect(rootNavigationRef.getCurrentRoute()).toMatchObject({
        name: 'Dormitory',
        params: detail[2],
      }),
    );
    expect(
      rootNavigationRef.getRootState().routes[rootNavigationRef.getRootState().index].name,
    ).toBe('校園');
    expect(mockRead).toHaveBeenCalledWith('users/alice/notifications/' + mockReceiptId);
  } finally {
    view.unmount();
    markSchoolNavigationUnready();
    markPublicNavigationUnready();
    mockRealNavigation = false;
  }
});
