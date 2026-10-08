import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BoardsTab } from './BoardsTab';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' } },
  list: vi.fn(),
  subscriptions: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/community/firestore', () => ({
  listBoards: mocks.list,
  listSubscribedBoardIds: mocks.subscriptions,
  groupBoardsByType: (boards: unknown[]) => ({ topic: boards }),
  CAMPUS_BOARD_TYPE_LABEL: { topic: '主題' },
  subscribeToBoard: vi.fn(),
  unsubscribeFromBoard: vi.fn(),
  createBoard: vi.fn(),
}));
beforeEach(() => {
  mocks.list.mockReset();
  mocks.subscriptions.mockReset().mockResolvedValue([]);
});
it('replaces a failed initial read with a retry state, then shows the actual board', async () => {
  mocks.list.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('尚無任何看板')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(await screen.findByText('科學討論')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it('treats a failed subscription read as unavailable, not an empty subscription list', async () => {
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  mocks.subscriptions.mockRejectedValue(new Error('offline'));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '訂閱' })).toBeNull();
});
