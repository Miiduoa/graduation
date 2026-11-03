import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { PreAuthStack } from '../screens/PreAuthStack';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
import type { NativeNuniState } from '../services/nuniSessionController';

type SessionFixture = NativeNuniState & {
  refresh: jest.Mock;
  signIn: jest.Mock;
  logout: jest.Mock;
  request: jest.Mock;
};

const mockSessionContext = React.createContext<SessionFixture | null>(null);
let mockSession: SessionFixture;

jest.unmock('@react-navigation/native');
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => require('react').useContext(mockSessionContext),
  useOptionalNuniSession: () => require('react').useContext(mockSessionContext),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }),
}));
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({
    mode: 'light',
    theme: require('../ui/theme').getCurrentTheme(),
  }),
  useTheme: () => require('../ui/theme').getCurrentTheme(),
}));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => null }));
jest.mock('../services/schoolLoginAvailability', () => ({
  isSchoolLoginEntryAvailable: () => false,
  loadSchoolLoginProviderKinds: async () => [],
}));
jest.mock('../services/nuniGoogle', () => ({
  getGoogleCredentialCapability: () => ({ available: true }),
}));
jest.mock('../state/foodPersistence', () => ({
  clearAllFoodPendingForAccount: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// Keep the real guest navigator and both ends of the account journey. Other
// destinations and signed-in data panels are outside this guest-only contract.
jest.mock('../screens/nuni/NuniCourses', () => ({ NuniCourses: () => null }));
jest.mock('../screens/nuni/NuniFood', () => ({ NuniFood: () => null }));
jest.mock('../screens/nuni/NuniMerchant', () => ({ NuniMerchant: () => null }));
jest.mock('../screens/GoogleMapsLikeScreen', () => ({ GoogleMapsLikeScreen: () => null }));
jest.mock('../screens/BusAiFirstScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/LibraryAiFirstScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/LibraryCatalogScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/SchoolInfoScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/CampusContentScreens', () => ({
  CampusAnnouncementsScreen: () => null,
  CampusAnnouncementDetailScreen: () => null,
}));
jest.mock('../screens/SSOLoginScreen', () => ({ SSOLoginScreen: () => null }));
jest.mock('../screens/PersonalImportScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/PersonalTimetableScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/PersonalCalendarScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/CourseCatalogScreen', () => ({ CourseCatalogScreen: () => null }));
jest.mock('../screens/HealthScreen', () => ({ HealthScreen: () => null }));
jest.mock('../screens/DormitoryScreen', () => ({ DormitoryScreen: () => null }));
jest.mock('../screens/UnavailableFeatureScreen', () => ({ UnavailableFeatureScreen: () => null }));

beforeEach(() => {
  mockSession = {
    session: null,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: jest.fn().mockResolvedValue(undefined),
    signIn: jest.fn().mockResolvedValue('cancelled'),
    logout: jest.fn().mockResolvedValue(undefined),
    request: jest.fn().mockResolvedValue({ memberships: [] }),
  };
});

function guestJourney() {
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const onUnhandledAction = jest.fn();
  const ui = () => (
    <mockSessionContext.Provider value={mockSession}>
      <NavigationContainer ref={navigation} onUnhandledAction={onUnhandledAction}>
        <PreAuthStack />
      </NavigationContainer>
    </mockSessionContext.Provider>
  );
  const view = render(ui());
  return { navigation, onUnhandledAction, ui, view };
}

async function expectWorkspace(journey: ReturnType<typeof guestJourney>) {
  const { navigation, onUnhandledAction, view } = journey;
  const screen = await view.findByTestId('nuni-workspace');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
  expect(navigation.getRootState().routes.map((route) => route.name)).toEqual([
    'LoginLanding',
    'NuniWorkspace',
  ]);
  expect(view.queryByTestId('login-landing')).toBeNull();
  expect(onUnhandledAction).not.toHaveBeenCalled();
  expect(mockSession.signIn).not.toHaveBeenCalled();
  expect(mockSession.logout).not.toHaveBeenCalled();
  expect(mockSession.request).not.toHaveBeenCalled();
  return within(screen);
}

// fireEvent exercises JS handlers and the real router. Native responder delivery
// and iOS transition rendering remain covered by the unchanged Maestro smoke.
test('登入確認失敗仍能進入真正的復原畫面，重新 render 不會退回入口', async () => {
  mockSession.error = '無法確認登入狀態，請重新連線後再試。';
  const journey = guestJourney();
  const { navigation, ui, view } = journey;
  fireEvent.press(await view.findByRole('button', { name: '查看登入問題' }));
  let workspace = await expectWorkspace(journey);
  expect(workspace.getByRole('header', { name: '目前無法確認登入狀態' })).toBeTruthy();
  expect(workspace.getByRole('alert')).toHaveTextContent(mockSession.error);
  expect(workspace.getByRole('button', { name: '重新確認登入狀態' })).toBeEnabled();
  expect(workspace.getByRole('button', { name: '開啟網頁版登入' })).toBeEnabled();
  expect(workspace.queryByText('申請學校資格')).toBeNull();
  const routeKey = navigation.getCurrentRoute()?.key;

  mockSession = { ...mockSession };
  view.rerender(ui());
  workspace = await expectWorkspace(journey);
  expect(navigation.getCurrentRoute()?.key).toBe(routeKey);
  expect(workspace.getByRole('button', { name: '重新確認登入狀態' })).toBeEnabled();
});

test('復原畫面返回後能重新進入，連續點擊不增加重複工作區', async () => {
  mockSession.error = '無法確認登入狀態，請重新連線後再試。';
  const journey = guestJourney();
  const { navigation, view } = journey;
  const entry = await view.findByTestId('login-start');
  act(() => {
    fireEvent.press(entry);
    fireEvent.press(entry);
  });
  await expectWorkspace(journey);

  act(() => navigation.goBack());
  await view.findByTestId('login-landing');
  expect(navigation.getCurrentRoute()?.name).toBe('LoginLanding');
  expect(navigation.getRootState().routes).toHaveLength(1);
  fireEvent.press(view.getByRole('button', { name: '查看登入問題' }));
  const workspace = await expectWorkspace(journey);
  expect(workspace.getByRole('header', { name: '目前無法確認登入狀態' })).toBeTruthy();
});

test.each([
  { state: 'loading', label: '確認 Google 帳號', patch: { loading: true } },
  { state: 'signed-out', label: '登入或建立帳號', patch: {} },
  { state: 'pending-logout', label: '處理未完成的登出', patch: { pendingLogout: true } },
])('$state 保留合法的下一步，不將進入工作區當成登入成功', async ({ state, label, patch }) => {
  mockSession = { ...mockSession, ...patch };
  const journey = guestJourney();
  fireEvent.press(await journey.view.findByRole('button', { name: label }));
  const workspace = await expectWorkspace(journey);
  if (state === 'loading') {
    const loading = journey.view.getByLabelText('正在確認 Google 帳號');
    expect(loading).toBeVisible();
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(workspace.getByText('正在確認 Google 帳號…')).toBeVisible();
    expect(workspace.queryByText('登入或建立帳號')).toBeNull();
  } else if (state === 'pending-logout') {
    expect(workspace.getByRole('header', { name: '登出尚未完成' })).toBeTruthy();
    expect(workspace.getByRole('button', { name: '重試登出' })).toBeEnabled();
  } else {
    expect(workspace.getByRole('header', { name: '登入或建立帳號' })).toBeTruthy();
    expect(workspace.getByRole('button', { name: '使用 Google 繼續' })).toBeEnabled();
  }
  expect(workspace.queryByText('登出 Google 帳號')).toBeNull();
  expect(workspace.queryByText('申請學校資格')).toBeNull();
});

test('等待登入狀態的工作區在確認失敗後留在原路由並提供重試', async () => {
  mockSession.loading = true;
  const journey = guestJourney();
  fireEvent.press(await journey.view.findByTestId('login-start'));
  await expectWorkspace(journey);
  const routeKey = journey.navigation.getCurrentRoute()?.key;

  mockSession = { ...mockSession, loading: false, error: '無法確認登入狀態，請重新連線後再試。' };
  journey.view.rerender(journey.ui());
  const workspace = await expectWorkspace(journey);
  expect(journey.navigation.getCurrentRoute()?.key).toBe(routeKey);
  expect(workspace.getByRole('header', { name: '目前無法確認登入狀態' })).toBeTruthy();
  await act(async () =>
    fireEvent.press(workspace.getByRole('button', { name: '重新確認登入狀態' })),
  );
  await waitFor(() => expect(mockSession.refresh).toHaveBeenCalledTimes(1));
  expect(journey.navigation.getCurrentRoute()?.key).toBe(routeKey);
});
