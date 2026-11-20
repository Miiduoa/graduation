import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FoodMutationStatus, useFoodMutation, type FoodIntent } from './foodState';
import { foodPendingStorageKey, loadFoodPending, saveFoodPending } from './foodPersistence';

const scope = 'food:cart:school:shop';
const original: FoodIntent = {
  action: 'order',
  input: { quoteId: 'quote-one', idempotencyKey: 'food-original' },
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

function options() {
  return {
    cache: new Map<string, unknown>(),
    scope,
    accountId: 'account-a',
    enabled: true,
    execute: vi.fn().mockResolvedValue({ orderId: 'order-one' }),
    onSuccess: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
  };
}

it('reconciles a partially saved intent before permitting a replacement operation', async () => {
  const config = options();
  const view = renderHook(() => useFoodMutation(config));
  const set = Storage.prototype.setItem;
  const failed = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    set.call(this, key, value);
    if (key === foodPendingStorageKey('account-a', scope)) throw new Error('write interrupted');
  });
  await act(async () => view.result.current.send(original));
  failed.mockRestore();
  expect(view.result.current.storageBlocked).toBe(true);
  expect(config.execute).not.toHaveBeenCalled();

  act(() => view.result.current.recoverStorage());
  expect(view.result.current.storageBlocked).toBe(false);
  expect(view.result.current.pending).toEqual(original);
  expect(config.execute).not.toHaveBeenCalled();
  await act(async () =>
    view.result.current.send({
      action: 'order',
      input: { quoteId: 'quote-two', idempotencyKey: 'food-new' },
    }),
  );
  expect(config.execute).not.toHaveBeenCalled();
  await act(async () => view.result.current.retry());
  await waitFor(() => expect(config.onSuccess).toHaveBeenCalled());
  expect(config.execute).toHaveBeenCalledTimes(1);
  expect(config.execute).toHaveBeenCalledWith(original);
});

it('exposes safe recovery after a read failure and keeps another account isolated', async () => {
  saveFoodPending('account-a', scope, original);
  saveFoodPending('account-b', scope, { ...original, input: { idempotencyKey: 'other-account' } });
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('temporarily unavailable');
  });
  const config = options();
  function Status() {
    return <FoodMutationStatus task={useFoodMutation(config)} />;
  }
  render(<Status />);
  const recover = await screen.findByRole('button', { name: '重新確認分頁儲存' });
  fireEvent.click(recover);
  expect(screen.getByRole('button', { name: '重新確認分頁儲存' })).toBeTruthy();
  expect(config.execute).not.toHaveBeenCalled();
  get.mockRestore();
  fireEvent.click(recover);
  expect(screen.queryByRole('button', { name: '重新確認分頁儲存' })).toBeNull();
  expect(screen.getByRole('button', { name: '重試同一份操作' })).toBeTruthy();
  expect(config.execute).not.toHaveBeenCalled();
  expect(loadFoodPending('account-b', scope)?.input.idempotencyKey).toBe('other-account');
});

it('ignores a completed order from an account whose form has left', async () => {
  let finish!: (value: unknown) => void;
  const config = options();
  config.execute.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = renderHook(() => useFoodMutation(config));
  let sending!: Promise<void>;
  act(() => {
    sending = first.result.current.send(original);
  });
  await waitFor(() => expect(config.execute).toHaveBeenCalled());
  first.unmount();
  const replacement = { ...options(), accountId: 'account-b' };
  const next = renderHook(() => useFoodMutation(replacement));
  await act(async () => {
    finish({ orderId: 'order-one' });
    await sending;
  });
  expect(config.onSuccess).not.toHaveBeenCalled();
  expect(replacement.onSuccess).not.toHaveBeenCalled();
  expect(next.result.current.pending).toBeNull();
  expect(loadFoodPending('account-a', scope)).toEqual(original);
});
