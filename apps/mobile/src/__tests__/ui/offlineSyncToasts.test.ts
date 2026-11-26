import { act, renderHook } from '@testing-library/react-native';
import { useOfflineSyncToasts } from '../../app/useOfflineSyncToasts';
import { subscribeToSyncEvents } from '../../services/offline';

jest.mock('../../services/offline', () => ({ subscribeToSyncEvents: jest.fn() }));
const mockToast = { show: jest.fn() };
jest.mock('../../ui/Toast', () => ({ useToast: () => mockToast }));

test('the global notification only reports successfully synced items', () => {
  let notify!: Parameters<typeof subscribeToSyncEvents>[0];
  const unsubscribe = jest.fn();
  jest.mocked(subscribeToSyncEvents).mockImplementation((listener) => {
    notify = listener;
    return unsubscribe;
  });
  const view = renderHook(useOfflineSyncToasts);
  act(() => {
    notify({ type: 'sync_complete', processed: 2, success: 0 });
    notify({ type: 'sync_complete', processed: 2 });
  });
  expect(mockToast.show).not.toHaveBeenCalled();
  act(() => notify({ type: 'sync_complete', processed: 3, success: 1 }));
  expect(mockToast.show).toHaveBeenCalledWith(
    expect.objectContaining({ message: '已同步 1 筆資料', type: 'success' }),
  );
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
