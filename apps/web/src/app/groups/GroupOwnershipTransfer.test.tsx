import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { GroupOwnershipTransfer } from './GroupOwnershipTransfer';
import {
  loadEligibleOwnershipMembers,
  transferGroupOwnership,
  confirmActorNoLongerOwner,
} from './groupOwnershipService';

vi.mock('./groupOwnershipService', async () => {
  const actual = await vi.importActual<typeof import('./groupOwnershipService')>(
    './groupOwnershipService',
  );
  return {
    ...actual,
    loadEligibleOwnershipMembers: vi.fn(),
    transferGroupOwnership: vi.fn(),
    confirmActorNoLongerOwner: vi.fn(),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadEligibleOwnershipMembers).mockResolvedValue({
    members: [{ uid: 'bob', role: 'member', displayName: '王小明' }],
    cursor: null,
    hasMore: false,
  });
  vi.mocked(transferGroupOwnership).mockResolvedValue({
    success: true,
    reused: false,
    groupId: 'g1',
    schoolId: 'pu',
    fromUid: 'alice',
    toUid: 'bob',
    actorNewRole: 'member',
    operationId: 'op-1',
  });
  vi.mocked(confirmActorNoLongerOwner).mockResolvedValue('member');
});

it('requires confirmation naming the recipient before calling the server', async () => {
  render(
    <GroupOwnershipTransfer uid="alice" schoolId="pu" groupId="g1" groupName="讀書會" />,
  );
  fireEvent.click(screen.getByRole('button', { name: '轉讓擁有權' }));
  await screen.findByRole('button', { name: '王小明' });
  fireEvent.click(screen.getByRole('button', { name: '王小明' }));
  expect(transferGroupOwnership).not.toHaveBeenCalled();
  expect(screen.getByText(/確定將擁有權轉給「王小明」/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認轉讓' }));
  await screen.findByText(/已將「讀書會」的擁有權轉給「王小明」/);
  expect(transferGroupOwnership).toHaveBeenCalledTimes(1);
  expect(vi.mocked(transferGroupOwnership).mock.calls[0][1]).toMatchObject({
    groupId: 'g1',
    targetUid: 'bob',
    expectedCurrentOwnerUid: 'alice',
  });
});

it('keeps the same operation id on retry after failure', async () => {
  vi.mocked(transferGroupOwnership)
    .mockRejectedValueOnce(new Error('暫時無法完成轉讓'))
    .mockResolvedValueOnce({
      success: true,
      reused: true,
      groupId: 'g1',
      schoolId: 'pu',
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
      operationId: 'op-kept',
    });
  render(
    <GroupOwnershipTransfer uid="alice" schoolId="pu" groupId="g1" groupName="讀書會" />,
  );
  fireEvent.click(screen.getByRole('button', { name: '轉讓擁有權' }));
  await screen.findByRole('button', { name: '王小明' });
  fireEvent.click(screen.getByRole('button', { name: '王小明' }));
  fireEvent.click(screen.getByRole('button', { name: '確認轉讓' }));
  await screen.findByRole('alert');
  const firstId = vi.mocked(transferGroupOwnership).mock.calls[0][1].operationId;
  fireEvent.click(screen.getByRole('button', { name: '用同一操作重試' }));
  await screen.findByText(/已將「讀書會」的擁有權轉給「王小明」/);
  expect(vi.mocked(transferGroupOwnership).mock.calls[1][1].operationId).toBe(firstId);
});

it('ignores a late transfer result after the account identity changes', async () => {
  const pending = deferred<Awaited<ReturnType<typeof transferGroupOwnership>>>();
  vi.mocked(transferGroupOwnership).mockReturnValueOnce(pending.promise);
  const onTransferred = vi.fn();
  const view = render(
    <GroupOwnershipTransfer
      uid="alice"
      schoolId="pu"
      groupId="g1"
      groupName="讀書會"
      onTransferred={onTransferred}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '轉讓擁有權' }));
  await screen.findByRole('button', { name: '王小明' });
  fireEvent.click(screen.getByRole('button', { name: '王小明' }));
  fireEvent.click(screen.getByRole('button', { name: '確認轉讓' }));
  view.rerender(
    <GroupOwnershipTransfer
      uid="carol"
      schoolId="pu"
      groupId="g1"
      groupName="讀書會"
      onTransferred={onTransferred}
    />,
  );
  await act(async () =>
    pending.resolve({
      success: true,
      reused: false,
      groupId: 'g1',
      schoolId: 'pu',
      fromUid: 'alice',
      toUid: 'bob',
      actorNewRole: 'member',
      operationId: 'op-stale',
    }),
  );
  expect(onTransferred).not.toHaveBeenCalled();
  expect(screen.queryByText(/已將「讀書會」的擁有權轉給/)).toBeNull();
});
