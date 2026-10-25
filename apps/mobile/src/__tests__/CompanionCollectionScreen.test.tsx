import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { doc, getDoc } from 'firebase/firestore';
import { ACHIEVEMENTS } from '@campus/shared';
import CompanionCollectionScreen from '../screens/CompanionCollectionScreen';
import { getLocalState } from '../services/companionLocalStore';
import { applyTheme } from '../ui/theme';

const auth = {
  user: null as { uid: string } | null,
  profile: null as { uid: string; schoolId: string } | null,
};
const local = jest.mocked(getLocalState);
const readDoc = jest.mocked(getDoc);
const buildDoc = jest.mocked(doc);

jest.mock('../state/auth', () => ({ useAuth: () => auth }));
jest.mock('../services/companionLocalStore', () => ({ getLocalState: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 84 }));
jest.mock('../firebase', () => ({ getFirebaseApp: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  doc: jest.fn((_db: unknown, ...segments: string[]) => segments.join('/')),
  getDoc: jest.fn(async () => ({ data: () => null })),
}));

function localData() {
  return { events: [], courses: [], lifetime: {}, unlocks: [] }
    as Awaited<ReturnType<typeof getLocalState>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
  auth.user = null;
  auth.profile = null;
  local.mockResolvedValue(localData());
});
afterEach(() => applyTheme('light'));

it('provides honest per-category progress and accessible category switching', async () => {
  const view = render(<CompanionCollectionScreen />);
  await waitFor(() => expect(view.getByTestId('companion-collection')).toBeTruthy());
  const study = ACHIEVEMENTS.filter((item) => item.unlock.domain === 'study').length;
  expect(view.getByText('學習 · 已解鎖 0 / ' + study)).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: '交通' }));
  const transit = ACHIEVEMENTS.filter((item) => item.unlock.domain === 'transport').length;
  expect(view.getByText('交通 · 已解鎖 0 / ' + transit)).toBeTruthy();
  expect(view.getByRole('tab', { name: '交通' }).props.accessibilityState.selected).toBe(true);
});

it('keeps an OLED background and never forces the old white palette', async () => {
  applyTheme('dark');
  const view = render(<CompanionCollectionScreen />);
  await waitFor(() => expect(view.getByTestId('companion-collection')).toBeTruthy());
  expect(view.getByTestId('companion-collection-screen').props.style.backgroundColor).toBe('#000000');
});

it('shows a retry action when device records cannot be read', async () => {
  local.mockRejectedValueOnce(new Error('storage failed')).mockResolvedValueOnce(localData());
  const view = render(<CompanionCollectionScreen />);
  await waitFor(() => expect(view.getByText('無法讀取收藏紀錄')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '重新讀取收藏' }));
  await waitFor(() => expect(view.getByTestId('companion-collection')).toBeTruthy());
  expect(local).toHaveBeenCalledTimes(2);
});

it('uses the signed-in uid for optional cloud records rather than app.auth', async () => {
  auth.user = { uid: 'student-123' };
  auth.profile = { uid: 'student-123', schoolId: 'pu' };
  readDoc.mockResolvedValue({ data: () => ({}) } as Awaited<ReturnType<typeof getDoc>>);
  const view = render(<CompanionCollectionScreen />);
  await waitFor(() => expect(view.getByTestId('companion-collection')).toBeTruthy());
  await waitFor(() => expect(buildDoc).toHaveBeenCalledWith(expect.anything(), 'users', 'student-123', 'companion', 'lifetime'));
  expect(buildDoc).toHaveBeenCalledWith(expect.anything(), 'users', 'student-123', 'companion', 'unlocks');
});
