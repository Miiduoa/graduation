import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import PostComposePage from './page';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' }, loading: false, error: null },
  search: new URLSearchParams(),
  list: vi.fn(),
  getBoard: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/community/post/new', useSearchParams: () => mocks.search, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/community/media', () => ({ uploadCampusMedia: vi.fn() }));
vi.mock('@/lib/community/firestore', () => ({
  listBoards: mocks.list,
  getBoardById: mocks.getBoard,
  createCampusPost: mocks.publish,
  getOrCreateBoardAlias: vi.fn(),
  CAMPUS_BOARD_TYPE_LABEL: { topic: '主題' },
}));
beforeEach(() => {
  mocks.search = new URLSearchParams();
  mocks.list.mockReset();
  mocks.getBoard.mockReset().mockResolvedValue(null);
  mocks.publish.mockReset();
});

it('lets members select a named board and prevents publishing until a valid board is selected', async () => {
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<PostComposePage />);
  const picker = await screen.findByRole('combobox', { name: '發布看板' });
  expect(screen.queryByPlaceholderText(/看板編號/)).toBeNull();
  expect((screen.getByRole('button', { name: '發布' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(picker, { target: { value: 'science' } });
  expect((screen.getByRole('button', { name: '發布' }) as HTMLButtonElement).disabled).toBe(false);
});

it('shows a retry state when board loading fails and preserves the typed draft', async () => {
  mocks.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<PostComposePage />);
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), { target: { value: '明天一起讀書' } });
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '發布' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByRole('combobox', { name: '發布看板' });
  expect((screen.getByPlaceholderText('一句話描述你的貼文') as HTMLInputElement).value).toBe('明天一起讀書');
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('refuses a removed board from the URL instead of accepting an arbitrary identifier', async () => {
  mocks.search = new URLSearchParams('boardId=removed');
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<PostComposePage />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('這個看板已不存在'));
  expect(mocks.getBoard).toHaveBeenCalledWith(expect.any(String), 'removed');
  expect((screen.getByRole('button', { name: '發布' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.publish).not.toHaveBeenCalled();
});
