import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { NuniError } from '@campus/shared/src/nuni';
import { FoodStorageRecovery, useFoodMutation } from '../screens/nuni/NuniFoodUi';
import { NuniDraftProvider } from '../state/nuniDrafts';

const mockLoad = jest.fn();
const mockSave = jest.fn();
const mockClear = jest.fn();
jest.mock('../state/foodPersistence', () => ({
  FoodStorageError: class FoodStorageError extends Error {},
  loadFoodPending: (...args: unknown[]) => mockLoad(...args),
  saveFoodPending: (...args: unknown[]) => mockSave(...args),
  clearFoodPending: (...args: unknown[]) => mockClear(...args),
}));
const mockRefresh = jest.fn();
let mockAccount = 'account-a';
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    session: { platformAccountId: mockAccount, context: `${mockAccount}-context` },
    refresh: mockRefresh,
  }),
}));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));

const scope = 'food:school:shop:intent';
const original = {
  kind: 'order',
  input: { quoteId: 'quote-one', idempotencyKey: 'food-original' },
};
const replacement = { ...original, input: { ...original.input, idempotencyKey: 'food-new' } };
const records = new Map<string, unknown>();
const recordKey = (account: string, key: string) => JSON.stringify([account, key]);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockAccount = 'account-a';
  records.clear();
  mockLoad
    .mockReset()
    .mockImplementation(
      async (account: string, key: string) => records.get(recordKey(account, key)) ?? null,
    );
  mockSave.mockReset().mockImplementation(async (account: string, key: string, value: unknown) => {
    records.set(recordKey(account, key), value);
  });
  mockClear.mockReset().mockImplementation(async (account: string, key: string) => {
    records.delete(recordKey(account, key));
  });
});

test.each(['confirmed', 'rejected'])(
  'a late %s cleanup cannot clear the departed form or deliver its receipt',
  async (outcome) => {
    const clearing = deferred();
    mockClear.mockImplementationOnce(() => clearing.promise);
    const execute = jest
      .fn()
      .mockImplementation(() =>
        outcome === 'confirmed'
          ? Promise.resolve({ orderId: 'order-one' })
          : Promise.reject(new NuniError(409, 'ORDER_CHANGED')),
      );
    const onReceipt = jest.fn();
    const cache = new Map<string, unknown>();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NuniDraftProvider cache={cache}>{children}</NuniDraftProvider>
    );
    const view = renderHook(() => useFoodMutation(scope, execute, onReceipt), { wrapper });
    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    let sending!: Promise<void>;
    act(() => {
      sending = view.result.current.send(original);
    });
    await waitFor(() => expect(mockClear).toHaveBeenCalled());
    expect(cache.get(scope)).toEqual(original);
    view.unmount();

    mockAccount = 'account-b';
    const nextReceipt = jest.fn();
    const next = renderHook(() => useFoodMutation(scope, execute, nextReceipt));
    await waitFor(() => expect(next.result.current.hydrated).toBe(true));
    await act(async () => {
      clearing.resolve();
      await sending;
    });
    expect(onReceipt).not.toHaveBeenCalled();
    expect(nextReceipt).not.toHaveBeenCalled();
    expect(cache.get(scope)).toEqual(original);
    expect(next.result.current.pending).toBeNull();
  },
);

test('safe storage recovery restores a partially saved intent before any new network operation', async () => {
  mockSave.mockImplementationOnce(async (account: string, key: string, value: unknown) => {
    records.set(recordKey(account, key), value);
    throw new Error('verification was interrupted');
  });
  const execute = jest.fn().mockResolvedValue({ orderId: 'order-one' });
  const view = renderHook(() => useFoodMutation(scope, execute, jest.fn()));
  await waitFor(() => expect(view.result.current.hydrated).toBe(true));
  await act(async () => view.result.current.send(original));
  expect(view.result.current.storageBlocked).toBe(true);
  expect(execute).not.toHaveBeenCalled();
  await act(async () => view.result.current.send(replacement));
  expect(execute).not.toHaveBeenCalled();

  act(() => view.result.current.recoverStorage());
  await waitFor(() => expect(view.result.current.storageBlocked).toBe(false));
  expect(view.result.current.pending).toEqual(original);
  expect(execute).not.toHaveBeenCalled();
  await act(async () => view.result.current.send(replacement));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledWith(original);
});

test('recovery remains blocked on another read failure and preserves the stored operation', async () => {
  records.set(recordKey('account-a', scope), original);
  mockLoad.mockRejectedValueOnce(new Error('locked')).mockRejectedValueOnce(new Error('locked'));
  const execute = jest.fn();
  const view = renderHook(() => useFoodMutation(scope, execute, jest.fn()));
  await waitFor(() => expect(view.result.current.storageBlocked).toBe(true));
  act(() => view.result.current.recoverStorage());
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.hydrated).toBe(true));
  expect(view.result.current.storageBlocked).toBe(true);
  expect(view.result.current.locked).toBe(true);
  expect(records.get(recordKey('account-a', scope))).toEqual(original);
  expect(execute).not.toHaveBeenCalled();
  act(() => view.result.current.recoverStorage());
  await waitFor(() => expect(view.result.current.storageBlocked).toBe(false));
  expect(view.result.current.pending).toEqual(original);
});

test('a recovery read that finishes after account leave cannot hydrate the replacement form', async () => {
  mockLoad.mockRejectedValueOnce(new Error('locked'));
  const view = renderHook(() => useFoodMutation(scope, jest.fn(), jest.fn()));
  await waitFor(() => expect(view.result.current.storageBlocked).toBe(true));
  let finish!: (value: unknown) => void;
  mockLoad.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => view.result.current.recoverStorage());
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  view.unmount();
  mockAccount = 'account-b';
  const next = renderHook(() => useFoodMutation(scope, jest.fn(), jest.fn()));
  await waitFor(() => expect(next.result.current.hydrated).toBe(true));
  await act(async () => finish(original));
  expect(next.result.current.pending).toBeNull();
  expect(next.result.current.storageBlocked).toBe(false);
});

test('the storage recovery control rereads storage without sending an order', async () => {
  mockLoad.mockRejectedValueOnce(new Error('locked'));
  const execute = jest.fn();
  function Recovery() {
    const mutation = useFoodMutation(scope, execute, jest.fn());
    return <FoodStorageRecovery mutation={mutation} />;
  }
  const view = render(<Recovery />);
  fireEvent.press(await view.findByRole('button', { name: '重新確認裝置儲存' }));
  await waitFor(() => expect(view.queryByRole('button', { name: '重新確認裝置儲存' })).toBeNull());
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(execute).not.toHaveBeenCalled();
});
