import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import CompanionScreen from '../screens/CompanionScreen';
import { applyTheme, getCurrentTheme } from '../ui/theme';
import { computeLocalCompanion } from '../services/companionLocalStore';

const auth = {
  user: null as { uid: string } | null,
  profile: null as { uid: string; schoolId: string } | null,
};
const navigation = { navigate: jest.fn(), getState: () => ({ routeNames: ['Companion', 'CompanionCollection', 'Constellation'] }) };
const local = jest.mocked(computeLocalCompanion);

jest.mock('../state/auth', () => ({ useAuth: () => auth }));
jest.mock('../services/companionLocalStore', () => ({ computeLocalCompanion: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 84 }));
jest.mock('../firebase', () => ({ getFirebaseApp: () => ({}), getCloudFunctionRegion: () => 'asia-east1' }));
jest.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => async () => { throw new Error('not configured'); },
}));

function example(message = '今天有新進度') {
  return {
    sprite: {
      evolutionStage: 'sprout',
      vitality: 68,
      message,
      appearance: { weatherMood: 'sunny', season: '秋季', seasonalAccessory: '' },
      careHint: { kind: 'meal', text: '記得吃午餐', ctaTarget: 'cafeteria' },
      needs: { study: 70, move: 20, nourish: 42, social: 30 },
    },
    garden: {
      plants: [{
        courseId: 'course-a', courseName: '資料庫系統', stage: 'sprout',
        emoji: '🌿', growth: 62, health: 90,
      }],
    },
    unlocks: [],
  } as Awaited<ReturnType<typeof computeLocalCompanion>>;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
  auth.user = null;
  auth.profile = null;
  local.mockResolvedValue(example());
});
afterEach(() => applyTheme('light'));

it('shows useful local information and routes cross-tab actions through the registered tabs', async () => {
  const view = render(<CompanionScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('資料庫系統')).toBeTruthy());
  expect(view.getByText('活力 68 / 100')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '依建議前往相關服務' }));
  expect(navigation.navigate).toHaveBeenCalledWith('校園', { screen: 'Cafeteria', params: undefined });
  fireEvent.press(view.getByRole('button', { name: '開啟課程 資料庫系統' }));
  expect(navigation.navigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
  fireEvent.press(view.getByRole('button', { name: '我的收藏' }));
  expect(navigation.navigate).toHaveBeenCalledWith('CompanionCollection', undefined);
});

it('uses OLED background rather than a hardcoded bright layout', async () => {
  applyTheme('dark');
  const view = render(<CompanionScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByTestId('companion-screen')).toBeTruthy());
  expect(view.getByTestId('companion-screen').props.style.backgroundColor).toBe('#000000');
  expect(getCurrentTheme().colors.bg).toBe('#000000');
});

it('offers retry instead of spinning forever when local records fail', async () => {
  local.mockRejectedValueOnce(new Error('storage error')).mockResolvedValueOnce(example());
  const view = render(<CompanionScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('暫時無法讀取校園精靈')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '重試讀取校園精靈' }));
  await waitFor(() => expect(view.getByText('資料庫系統')).toBeTruthy());
  expect(local).toHaveBeenCalledTimes(2);
});

it('does not show the previous account response after switching users', async () => {
  const first = deferred<Awaited<ReturnType<typeof computeLocalCompanion>>>();
  auth.user = { uid: 'user-a' };
  auth.profile = { uid: 'user-a', schoolId: 'pu' };
  local.mockReturnValueOnce(first.promise).mockResolvedValueOnce(example('目前帳號的新資料'));
  const view = render(<CompanionScreen navigation={navigation} />);
  auth.user = { uid: 'user-b' };
  auth.profile = { uid: 'user-b', schoolId: 'ncku' };
  view.rerender(<CompanionScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('目前帳號的新資料')).toBeTruthy());
  await act(async () => first.resolve(example('上一個帳號的舊資料')));
  expect(view.queryByText('上一個帳號的舊資料')).toBeNull();
  expect(local).toHaveBeenLastCalledWith({ schoolId: 'ncku' });
});

it('does not render a fake action for an unsupported hint', async () => {
  const value = example();
  (value.sprite.careHint as { ctaTarget?: string }).ctaTarget = 'unknown';
  local.mockResolvedValue(value);
  const view = render(<CompanionScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('記得吃午餐')).toBeTruthy());
  expect(view.queryByRole('button', { name: '依建議前往相關服務' })).toBeNull();
});
