import React from 'react';
import * as Native from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { HeaderDrawerHost, headerDrawer } from '../components/HeaderDrawer';
import {
  rootNavigate,
  rootNavigateCampusCommunity,
  rootNavigateMeScreen,
  rootNavigateNested,
} from '../app/rootNavigation';

const mockSignOut = jest.fn();
let mockAuth = {
  user: { uid: 'student-one', email: 'student@example.test' },
  profile: {
    role: 'student',
    schoolId: 'pu',
    displayName: '測試同學',
    postLoginRoles: ['student'],
  },
  signOut: mockSignOut,
};
let mockReduceMotion = false;
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/notifications', () => ({ useNotifications: () => ({ unreadCount: 3 }) }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduceMotion }));
jest.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    displayName: '學生',
    badgeColor: '#333333',
    can: () => true,
    isTeacher: false,
    isStaff: false,
    isDepartmentHead: false,
    isAdmin: false,
  }),
}));
jest.mock('../app/rootNavigation', () => ({
  rootNavigate: jest.fn(),
  rootNavigateNested: jest.fn(),
  rootNavigateMeScreen: jest.fn(),
  rootNavigateCampusCommunity: jest.fn(),
}));
jest.mock('../ui/AppActionIcon', () => ({ AppActionIcon: () => null }));
jest.mock('../ui/BrandFluxImageHeader', () => ({
  BrandFluxImageHeader: ({ children }: { children: React.ReactNode }) => children,
}));

type Transition = {
  complete: (finished?: boolean) => void;
  stop: jest.Mock;
};
let transitions: Transition[];
let dimensions: { width: number; height: number; scale: number; fontScale: number };

beforeEach(() => {
  jest.clearAllMocks();
  headerDrawer.close();
  mockReduceMotion = false;
  mockAuth = {
    user: { uid: 'student-one', email: 'student@example.test' },
    profile: {
      role: 'student',
      schoolId: 'pu',
      displayName: '測試同學',
      postLoginRoles: ['student'],
    },
    signOut: mockSignOut,
  };
  dimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => dimensions);
  transitions = [];
  jest.spyOn(Native.Animated, 'parallel').mockImplementation(() => {
    let callback: ((result: { finished: boolean }) => void) | undefined;
    const transition: Transition = {
      complete: (finished = true) => callback?.({ finished }),
      stop: jest.fn(() => callback?.({ finished: false })),
    };
    transitions.push(transition);
    return {
      start: (complete) => {
        callback = complete;
      },
      stop: transition.stop,
      reset: jest.fn(),
    };
  });
});

afterEach(() => {
  cleanup();
  headerDrawer.close();
  jest.restoreAllMocks();
});

function openDrawer() {
  const view = render(<HeaderDrawerHost />);
  act(() => headerDrawer.open());
  return view;
}

function latestTransition() {
  return transitions[transitions.length - 1];
}

function expectNoNavigation() {
  for (const navigate of [
    rootNavigate,
    rootNavigateNested,
    rootNavigateMeScreen,
    rootNavigateCampusCommunity,
  ]) {
    expect(navigate).not.toHaveBeenCalled();
  }
}

test('waits for the close animation, then performs only the first selected destination once', () => {
  const view = openDrawer();
  expect(view.getByTestId('header-drawer-panel')).toBeTruthy();
  const identity = view.getByTestId('header-drawer-identity');
  expect(identity.props.accessible).toBe(true);
  expect(identity.props.accessibilityLabel).toBe('測試同學');
  expect(view.getByLabelText('測試同學')).toBe(identity);
  const personalSection = view.getByTestId('drawer-section-個人');
  expect(personalSection.props.accessible).toBe(true);
  expect(personalSection.props.accessibilityLabel).toBe('個人');
  expect(view.getByLabelText('個人')).toBe(personalSection);
  const profile = view.getByRole('button', { name: '個人資料' });
  const timetable = view.getByRole('button', { name: '我的課表' });
  act(() => {
    fireEvent.press(profile);
    fireEvent.press(timetable);
  });
  expect(profile).toBeDisabled();
  expect(timetable).toBeDisabled();
  for (const button of view.getAllByRole('button')) {
    if (button.props.accessibilityLabel === '關閉抽屜') continue;
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibilityState({ disabled: true });
  }
  expect(headerDrawer.isOpen()).toBe(true);
  expectNoNavigation();
  const exit = latestTransition();
  act(() => exit.complete());
  expect(headerDrawer.isOpen()).toBe(false);
  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
  expect(rootNavigateMeScreen).toHaveBeenCalledWith('ProfileEdit', undefined);
  expect(rootNavigateNested).not.toHaveBeenCalled();
  act(() => exit.complete());
  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
});

test.each([
  ['通知中心，3 則未讀通知', rootNavigateNested, ['訊息', 'Notifications']],
  ['我的課表', rootNavigateNested, ['學習', 'PersonalTimetable']],
  ['找人', rootNavigateNested, ['訊息', 'FriendSearch']],
  ['訊息', rootNavigate, ['訊息']],
  ['校園社群 · 動態／看板／即時／學伴', rootNavigateCampusCommunity, []],
] as const)('keeps the exact destination for %s after closing', (label, navigate, args) => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: label }));
  expectNoNavigation();
  act(() => latestTransition().complete());
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(...args);
  expect(headerDrawer.isOpen()).toBe(false);
});

test('an explicit open cancels the old selection even while the drawer is still visible', () => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '個人資料' }));
  const staleExit = latestTransition();
  act(() => headerDrawer.open());
  expect(staleExit.stop).toHaveBeenCalledTimes(1);
  act(() => staleExit.complete());
  expectNoNavigation();
  expect(headerDrawer.isOpen()).toBe(true);
  expect(view.getByRole('button', { name: '我的課表' })).toBeEnabled();
  fireEvent.press(view.getByRole('button', { name: '我的課表' }));
  act(() => latestTransition().complete());
  expect(rootNavigateNested).toHaveBeenCalledWith('學習', 'PersonalTimetable');
});

test('an external close cancels pending navigation immediately, including before the next render', () => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  const staleExit = latestTransition();
  act(() => {
    headerDrawer.close();
    staleExit.complete();
  });
  expectNoNavigation();
  expect(headerDrawer.isOpen()).toBe(false);
});

test('system back dismisses the drawer and cancels a previously selected destination', () => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  fireEvent(view.UNSAFE_getByType(Native.Modal), 'requestClose');
  act(() => latestTransition().complete());
  expectNoNavigation();
  expect(headerDrawer.isOpen()).toBe(false);
});

test('unmount stops the animation and makes late completion inert', () => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  const staleExit = latestTransition();
  view.unmount();
  expect(staleExit.stop).toHaveBeenCalledTimes(1);
  act(() => staleExit.complete());
  expectNoNavigation();
});

test('account or permission scope changes close the drawer and discard the old selection', () => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  const staleExit = latestTransition();
  mockAuth = { ...mockAuth, user: { ...mockAuth.user, uid: 'student-two' } };
  view.rerender(<HeaderDrawerHost />);
  act(() => staleExit.complete());
  expectNoNavigation();
  expect(headerDrawer.isOpen()).toBe(false);
  act(() => headerDrawer.open());
  mockAuth = { ...mockAuth, profile: { ...mockAuth.profile, role: 'teacher' } };
  view.rerender(<HeaderDrawerHost />);
  expect(headerDrawer.isOpen()).toBe(false);
});

test('reduced motion opens and closes without scheduling a spatial animation or delayed navigation', () => {
  mockReduceMotion = true;
  const view = openDrawer();
  expect(transitions).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  expect(transitions).toHaveLength(0);
  expect(headerDrawer.isOpen()).toBe(false);
  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
  expect(rootNavigateMeScreen).toHaveBeenCalledWith('Settings', undefined);
});

test('enabling reduced motion during a close settles the selected action once and stops the old animation', () => {
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  const staleExit = latestTransition();
  mockReduceMotion = true;
  view.rerender(<HeaderDrawerHost />);
  expect(staleExit.stop).toHaveBeenCalledTimes(1);
  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
  expect(headerDrawer.isOpen()).toBe(false);
  act(() => staleExit.complete());
  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
});

test('rotation and split view resize the drawer and preserve exactly one pending destination', () => {
  const view = openDrawer();
  expect(view.getByTestId('header-drawer-panel')).toHaveStyle({ width: 331.5 });
  dimensions = { ...dimensions, width: 320, fontScale: 2 };
  view.rerender(<HeaderDrawerHost />);
  expect(view.getByTestId('header-drawer-panel')).toHaveStyle({ width: 272 });
  fireEvent.press(view.getByRole('button', { name: '一般設定' }));
  const staleExit = latestTransition();
  dimensions = { ...dimensions, width: 844, height: 390 };
  view.rerender(<HeaderDrawerHost />);
  expect(view.getByTestId('header-drawer-panel')).toHaveStyle({ width: 360 });
  act(() => staleExit.complete());
  expectNoNavigation();
  act(() => latestTransition().complete());
  expect(rootNavigateMeScreen).toHaveBeenCalledTimes(1);
});

test('every entry exposes its full name and the close and avatar controls have useful labels', () => {
  dimensions = { ...dimensions, width: 320, fontScale: 2 };
  const view = openDrawer();
  expect(view.getByRole('button', { name: '編輯個人資料' })).toBeTruthy();
  expect(view.getByRole('button', { name: '關閉抽屜' })).toHaveStyle({
    minWidth: 44,
    minHeight: 44,
  });
  expect(view.getByRole('button', { name: '通知中心，3 則未讀通知' })).toBeTruthy();
  expect(view.getByText('校園社群 · 動態／看板／即時／學伴').props.numberOfLines).toBeUndefined();
  expect(view.getByText('測試同學').props.numberOfLines).toBeUndefined();
  expect(view.getByTestId('header-drawer-identity').props.accessibilityLabel).toBe('測試同學');
  expect(view.queryByText(/Claims|後端／帳號系統/)).toBeNull();
});

test('an old sign-out confirmation cannot sign out a different account', async () => {
  const alert = jest.spyOn(Native.Alert, 'alert');
  const view = openDrawer();
  fireEvent.press(view.getByRole('button', { name: '登出' }));
  const confirm = alert.mock.calls[0][2]?.find((button) => button.text === '登出');
  expect(confirm?.onPress).toBeDefined();
  mockAuth = { ...mockAuth, user: { ...mockAuth.user, uid: 'student-two' } };
  view.rerender(<HeaderDrawerHost />);
  await act(async () => {
    await confirm?.onPress?.();
  });
  expect(mockSignOut).not.toHaveBeenCalled();
});
