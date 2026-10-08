import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { DemoStoreProvider, useDemoStore } from '../state/demoStore';
import { getDemoStore, hydrateDemoStore, subscribeDemoStore } from '../services/demoStore';
let mockUid = 'demo_student';
const mockUnsubscribe = jest.fn();
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../services/demoStore', () => ({
  getDemoStore: jest.fn(() => ({ dynamicMessages: [{ title: '示範訊息' }] })),
  hydrateDemoStore: jest.fn().mockResolvedValue(undefined),
  subscribeDemoStore: jest.fn(() => mockUnsubscribe),
}));
function Consumer() {
  const store = useDemoStore();
  return <Text>{store.dynamicMessages[0]?.title ?? '沒有示範資料'}</Text>;
}
function App() {
  return (
    <DemoStoreProvider>
      <Consumer />
    </DemoStoreProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'demo_student';
});
test.each(['production', 'preview'])(
  '%s neither reads persisted demo data nor falls back to the singleton',
  (appEnv) => {
    Object.assign(Constants.expoConfig!, { extra: { appEnv, enableUniversalDevAccounts: true } });
    const view = render(<App />);
    expect(view.getByText('沒有示範資料')).toBeTruthy();
    view.unmount();
    const fallback = render(<Consumer />);
    expect(fallback.getByText('沒有示範資料')).toBeTruthy();
    expect(getDemoStore).not.toHaveBeenCalled();
    expect(hydrateDemoStore).not.toHaveBeenCalled();
    expect(subscribeDemoStore).not.toHaveBeenCalled();
  },
);
test('switching to a real session synchronously hides demo state and ignores late hydration', async () => {
  Object.assign(Constants.expoConfig!, {
    extra: { appEnv: 'development', enableUniversalDevAccounts: true },
  });
  let resolve!: () => void;
  (hydrateDemoStore as jest.Mock).mockReturnValueOnce(
    new Promise<void>((yes) => {
      resolve = yes;
    }),
  );
  const view = render(<App />);
  expect(view.getByText('示範訊息')).toBeTruthy();
  mockUid = 'real';
  view.rerender(<App />);
  expect(view.getByText('沒有示範資料')).toBeTruthy();
  const reads = (getDemoStore as jest.Mock).mock.calls.length;
  await act(async () => resolve());
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  expect(getDemoStore).toHaveBeenCalledTimes(reads);
  expect(view.queryByText('示範訊息')).toBeNull();
});
