import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import PostComposePage from './page';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' } as { uid: string } | null, loading: false, error: null },
  search: new URLSearchParams(),
  list: vi.fn(),
  getBoard: vi.fn(),
  publish: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({ selectedSchool: { id: 'ncku', name: '國立成功大學' } }),
}));
vi.mock('@/components/SiteShell', async () => {
  const { SchoolDataScope } = await import('@/components/SchoolDataScope');
  return {
    SiteShell: ({ children, schoolName }: { children: ReactNode; schoolName?: string }) => (
      <main>
        {schoolName && <SchoolDataScope schoolName={schoolName} />}
        {children}
      </main>
    ),
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/community/post/new',
  useSearchParams: () => mocks.search,
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/lib/community/media', () => ({ uploadCampusMedia: vi.fn() }));
vi.mock('@/lib/community/firestore', () => ({
  listBoards: mocks.list,
  getBoardById: mocks.getBoard,
  createCampusPost: mocks.publish,
  getOrCreateBoardAlias: vi.fn(),
  CAMPUS_BOARD_TYPE_LABEL: { topic: '主題' },
}));
beforeEach(() => {
  mocks.auth.user = { uid: 'student' };
  mocks.search = new URLSearchParams();
  mocks.list.mockReset();
  mocks.getBoard.mockReset().mockResolvedValue(null);
  mocks.publish.mockReset();
  mocks.push.mockReset();
  vi.stubGlobal('alert', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

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
  mocks.list
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<PostComposePage />);
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), {
    target: { value: '明天一起讀書' },
  });
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '發布' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByRole('combobox', { name: '發布看板' });
  expect((screen.getByPlaceholderText('一句話描述你的貼文') as HTMLInputElement).value).toBe(
    '明天一起讀書',
  );
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('refuses a removed board from the URL instead of accepting an arbitrary identifier', async () => {
  mocks.search = new URLSearchParams('boardId=removed');
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<PostComposePage />);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('這個看板已不存在'),
  );
  expect(mocks.getBoard).toHaveBeenCalledWith(expect.any(String), 'removed');
  expect((screen.getByRole('button', { name: '發布' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('explains the connected source and publishes under that school and signed-in author despite unrelated URL values', async () => {
  mocks.search = new URLSearchParams(
    'school=ncku&schoolId=ncku&campus=ncku&uid=other-student&boardId=science',
  );
  mocks.list.mockResolvedValue([
    { id: 'science', name: '科學討論', type: 'topic', defaultAnonymous: false },
  ]);
  mocks.publish.mockResolvedValue('published-post');
  render(<PostComposePage />);

  const source = screen.getByRole('complementary', { name: '目前校園資料範圍' });
  expect(source.textContent).toContain('此頁目前提供靜宜大學的資料');
  expect(source.textContent).toContain('尚未連結你選擇的國立成功大學');
  expect(
    screen.getByRole('link', { name: '查看國立成功大學的公開交流' }).getAttribute('href'),
  ).toBe('/social?campus=ncku');
  await screen.findByRole('combobox', { name: '發布看板' });
  expect(mocks.list).toHaveBeenCalledWith(PROVIDENCE_UNIVERSITY_SCHOOL_ID, 80);
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), {
    target: { value: '讀書會時間' },
  });
  fireEvent.change(screen.getByPlaceholderText('想分享什麼？'), {
    target: { value: '明天下午一起複習。' },
  });
  expect((screen.getByRole('checkbox', { name: '匿名貼文' }) as HTMLInputElement).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: '發布' }));

  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/community/post/published-post'));
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
    schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
    boardId: 'science',
    title: '讀書會時間',
    content: '明天下午一起複習。',
    anonymous: false,
    tags: [],
    mediaUrls: [],
    authorUid: 'student',
  });
});

it('keeps a visitor with school and author query values outside the private compose flow', () => {
  mocks.auth.user = null;
  mocks.search = new URLSearchParams('schoolId=ncku&uid=student&boardId=science');
  render(<PostComposePage />);
  expect(screen.getByRole('link', { name: '登入帳號' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '發布' })).toBeNull();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
