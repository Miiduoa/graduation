import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreatorHighlight } from './CreatorHighlight';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  feature: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/community/creatorHighlight', () => ({
  readCreatorHighlight: mocks.read,
  featureCreatorPost: mocks.feature,
  removeCreatorHighlight: mocks.remove,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; className?: string }) =>
    <a href={href} {...props}>{children}</a>,
}));

const mine = {
  id: 'work-1', schoolId: 'pu', authorUid: 'alice', anonymous: false,
  boardId: 'life', title: '我的專題作品', content: '校園協作成果',
};
const hidden = { ...mine, id: 'anon', anonymous: true, title: '匿名心得' };
const foreign = { ...mine, id: 'foreign', authorUid: 'bob', title: '別人的貼文' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(null);
  mocks.feature.mockResolvedValue({ postId: 'work-1', post: mine });
  mocks.remove.mockResolvedValue(undefined);
});

it('lets the owner choose a genuine signed work and confirm it before showing success', async () => {
  render(<CreatorHighlight schoolId="pu" memberUid="alice" own candidates={[mine, hidden, foreign]} />);
  await screen.findByRole('combobox', { name: '挑選一篇署名貼文' });
  expect(screen.getByRole('option', { name: '我的專題作品' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: '匿名心得' })).toBeNull();
  expect(screen.queryByRole('option', { name: '別人的貼文' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'work-1' } });
  fireEvent.click(screen.getByRole('button', { name: '設為精選' }));
  await waitFor(() => expect(mocks.feature).toHaveBeenCalledExactlyOnceWith('pu', 'alice', 'work-1'));
  expect(await screen.findByRole('link', { name: /我的專題作品/ })).toHaveProperty(
    'href', expect.stringContaining('/community/post/work-1?schoolId=pu'),
  );
  expect(await screen.findByText('精選作品已更新。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消精選' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('pu', 'alice'));
});

it('shows the verified featured work to peers but never renders private editorial controls', async () => {
  mocks.read.mockResolvedValueOnce({ postId: 'work-1', post: mine });
  render(<CreatorHighlight schoolId="pu" memberUid="alice" own={false} candidates={[mine]} />);
  expect(await screen.findByText('我的專題作品')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '設為精選' })).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('does not display a deleted or anonymous featured post on another member profile', async () => {
  mocks.read.mockResolvedValueOnce({ postId: 'anon', post: null });
  render(<CreatorHighlight schoolId="pu" memberUid="alice" own={false} candidates={[mine]} />);
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(screen.queryByText('我的專題作品')).toBeNull();
  expect(screen.queryByRole('link', { name: /作品/ })).toBeNull();
});

it('read failures and uncertain writes remain retryable, not misreported as success', async () => {
  mocks.read.mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValueOnce(null);
  mocks.feature.mockRejectedValueOnce(new Error('unknown write status'));
  render(<CreatorHighlight schoolId="pu" memberUid="alice" own candidates={[mine]} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByRole('combobox');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'work-1' } });
  fireEvent.click(screen.getByRole('button', { name: '設為精選' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('精選作品已更新。')).toBeNull();
});
