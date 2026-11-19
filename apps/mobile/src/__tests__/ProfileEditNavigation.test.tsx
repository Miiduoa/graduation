import React from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileEditAiFirstScreen from '../screens/ProfileEditAiFirstScreen';
import { firebaseSource } from '../data/firebaseSource';
import type { User } from '../data/types';
import type { UserProfile } from '../state/auth';

jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
jest.mock('../state/auth', () => ({
  useAuth: () => require('react').useContext(mockAuthContext),
}));
jest.mock('../data/firebaseSource', () => ({ firebaseSource: { updateUser: jest.fn() } }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

type ProfileAuth = {
  user: { uid: string; email: string };
  profile: UserProfile;
  profileLoading: boolean;
  error: string | null;
  refreshProfile: jest.Mock;
};
type Routes = { MeHome: undefined; ProfileEdit: undefined; Settings: undefined };
const Stack = createNativeStackNavigator<Routes>();
const mockAuthContext = React.createContext<ProfileAuth | null>(null);
const MeHome = () => <Text>我的首頁</Text>;
const Settings = () => <Text>設定內容</Text>;
let auth: ProfileAuth;

function saved(patch: Partial<User> = {}): User {
  return {
    id: 'user-a',
    email: 'a@example.edu',
    role: 'student',
    schoolId: 'school-a',
    createdAt: '2026-10-08T00:00:00Z',
    displayName: '原本名字',
    bio: '原本簡介',
    phone: '0900000000',
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function confirmButton(label: string): NonNullable<AlertButton['onPress']> {
  const call = jest
    .mocked(Alert.alert)
    .mock.calls.findLast((entry) => entry[0] === '尚有未儲存的內容');
  const action = call?.[2]?.find((entry) => entry.text === label)?.onPress;
  if (!action) throw new Error(`Missing profile confirmation: ${label}`);
  return action;
}

function mountProfile() {
  const ref = createNavigationContainerRef<Routes>();
  const screen = () => (
    <mockAuthContext.Provider value={auth}>
      <NavigationContainer ref={ref}>
        <Stack.Navigator id={undefined} screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="MeHome" component={MeHome} />
          <Stack.Screen name="ProfileEdit" component={ProfileEditAiFirstScreen} />
          <Stack.Screen name="Settings" component={Settings} />
        </Stack.Navigator>
      </NavigationContainer>
    </mockAuthContext.Provider>
  );
  const view = render(screen());
  act(() => ref.navigate('ProfileEdit'));
  expect(ref.getRootState().routes.map((route) => route.name)).toEqual(['MeHome', 'ProfileEdit']);
  return { ...view, ref, refreshAuth: () => view.rerender(screen()) };
}

beforeEach(() => {
  jest.clearAllMocks();
  auth = {
    user: { uid: 'user-a', email: 'a@example.edu' },
    profile: {
      uid: 'user-a',
      schoolId: 'school-a',
      role: 'student',
      displayName: '原本名字',
      bio: '原本簡介',
      phone: '0911111111',
    },
    profileLoading: false,
    error: null,
    refreshProfile: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(firebaseSource.updateUser).mockReset().mockResolvedValue(saved());
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each(['header', 'system'] as const)(
  '%s back preserves edits until the user explicitly discards them',
  async (source) => {
    const view = mountProfile();
    const route = view.ref.getCurrentRoute();
    fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
    const back = () =>
      source === 'header'
        ? fireEvent.press(view.getByRole('button', { name: '返回' }))
        : act(() => view.ref.goBack());
    back();
    expect(view.ref.getCurrentRoute()).toEqual(route);
    act(() => confirmButton('繼續編輯')());
    expect(view.getByLabelText('電話').props.value).toBe('0900000000');
    back();
    const discard = confirmButton('捨棄並離開');
    act(() => {
      discard();
      discard();
    });
    await waitFor(() => expect(view.ref.getCurrentRoute()?.name).toBe('MeHome'));
    act(() => view.ref.navigate('ProfileEdit'));
    expect(view.getByLabelText('電話').props.value).toBe('0911111111');
    expect(firebaseSource.updateUser).not.toHaveBeenCalled();
  },
);

test('unchanged and reverted profile fields can return without a warning', () => {
  const view = mountProfile();
  act(() => view.ref.goBack());
  expect(view.ref.getCurrentRoute()?.name).toBe('MeHome');
  act(() => view.ref.navigate('ProfileEdit'));
  fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
  fireEvent.changeText(view.getByLabelText('電話'), '0911111111');
  fireEvent.press(view.getByRole('button', { name: '返回' }));
  expect(view.ref.getCurrentRoute()?.name).toBe('MeHome');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a pending save blocks header and system removal; a confirmed save permits return', async () => {
  const pending = deferred<User>();
  jest.mocked(firebaseSource.updateUser).mockReturnValueOnce(pending.promise);
  const view = mountProfile();
  const route = view.ref.getCurrentRoute();
  fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
  fireEvent.press(view.getByText('儲存'));
  fireEvent.press(view.getByRole('button', { name: '返回' }));
  act(() => view.ref.goBack());
  expect(view.ref.getCurrentRoute()).toEqual(route);
  expect(Alert.alert).not.toHaveBeenCalledWith(
    '尚有未儲存的內容',
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
  expect(firebaseSource.updateUser).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(saved()));
  expect(Alert.alert).toHaveBeenCalledWith('已儲存', '個人資料已更新。');
  fireEvent.press(view.getByRole('button', { name: '返回' }));
  expect(view.ref.getCurrentRoute()?.name).toBe('MeHome');
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

test.each(['failed', 'unconfirmed'] as const)(
  'a %s save keeps the edited fields protected',
  async (result) => {
    if (result === 'failed')
      jest.mocked(firebaseSource.updateUser).mockRejectedValueOnce(new Error('offline'));
    else
      jest.mocked(firebaseSource.updateUser).mockResolvedValueOnce(saved({ phone: '0911111111' }));
    const view = mountProfile();
    fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
    fireEvent.press(view.getByText('儲存'));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('無法確認儲存結果', expect.any(String)),
    );
    act(() => view.ref.goBack());
    expect(view.ref.getCurrentRoute()?.name).toBe('ProfileEdit');
    act(() => confirmButton('繼續編輯')());
    expect(view.getByLabelText('電話').props.value).toBe('0900000000');
    expect(auth.refreshProfile).not.toHaveBeenCalled();
  },
);

test('back attempts share one prompt and an old decision cannot discard newer input', () => {
  const view = mountProfile();
  fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
  act(() => view.ref.goBack());
  const discard = confirmButton('捨棄並離開');
  act(() => view.ref.goBack());
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  fireEvent.changeText(view.getByLabelText('個人簡介'), '新的尚未儲存簡介');
  act(() => discard());
  expect(view.ref.getCurrentRoute()?.name).toBe('ProfileEdit');
  expect(view.getByLabelText('個人簡介').props.value).toBe('新的尚未儲存簡介');
  act(() => view.ref.goBack());
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  act(() => confirmButton('繼續編輯')());
});

test('starting a save invalidates an earlier discard callback, including after the save settles', async () => {
  const pending = deferred<User>();
  jest.mocked(firebaseSource.updateUser).mockReturnValueOnce(pending.promise);
  const view = mountProfile();
  fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
  act(() => view.ref.goBack());
  const discard = confirmButton('捨棄並離開');
  fireEvent.press(view.getByText('儲存'));
  act(() => discard());
  expect(view.ref.getCurrentRoute()?.name).toBe('ProfileEdit');
  await act(async () => pending.resolve(saved()));
  act(() => discard());
  expect(view.ref.getCurrentRoute()?.name).toBe('ProfileEdit');
  act(() => view.ref.goBack());
  expect(view.ref.getCurrentRoute()?.name).toBe('MeHome');
});

test('an old confirmation cannot pop a subsequently opened page', () => {
  const view = mountProfile();
  fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
  act(() => view.ref.goBack());
  const discard = confirmButton('捨棄並離開');
  act(() => view.ref.navigate('Settings'));
  const settingsRoute = view.ref.getCurrentRoute();
  act(() => discard());
  expect(view.ref.getCurrentRoute()).toEqual(settingsRoute);
  act(() => view.ref.goBack());
  expect(view.ref.getCurrentRoute()?.name).toBe('ProfileEdit');
  expect(view.getByLabelText('電話').props.value).toBe('0900000000');
});

test.each(['account', 'school'] as const)(
  'a previous %s confirmation cannot remove the current profile',
  (scope) => {
    const view = mountProfile();
    const route = view.ref.getCurrentRoute();
    fireEvent.changeText(view.getByLabelText('電話'), '0900000000');
    act(() => view.ref.goBack());
    const discard = confirmButton('捨棄並離開');
    auth = {
      ...auth,
      user: { uid: scope === 'account' ? 'user-b' : 'user-a', email: 'new@example.edu' },
      profile: {
        ...auth.profile,
        uid: scope === 'account' ? 'user-b' : 'user-a',
        schoolId: 'school-b',
        phone: '0922222222',
      },
    };
    view.refreshAuth();
    expect(view.getByLabelText('電話').props.value).toBe('0922222222');
    act(() => discard());
    expect(view.ref.getCurrentRoute()).toEqual(route);
    act(() => view.ref.goBack());
    expect(view.ref.getCurrentRoute()?.name).toBe('MeHome');
    expect(firebaseSource.updateUser).not.toHaveBeenCalled();
  },
);
