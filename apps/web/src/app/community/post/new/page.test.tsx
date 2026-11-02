import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import PostComposePage from './page';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' } as { uid: string } | null, loading: false, error: null },
  search: new URLSearchParams(),
  school: { id: 'ncku', name: '國立成功大學' },
  list: vi.fn(),
  getBoard: vi.fn(),
  publish: vi.fn(),
  push: vi.fn(),
  access: { status: 'denied' as 'loading' | 'allowed' | 'denied' | 'error', authorizationEpoch: 1, isAuthorized: vi.fn(), retry: vi.fn() },
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../_components/useBoardCreationAccess', () => ({ useBoardCreationAccess: () => mocks.access }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({ selectedSchool: mocks.school }),
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
  mocks.access = { status: 'denied', authorizationEpoch: 1, isAuthorized: vi.fn(() => false), retry: vi.fn() };
  mocks.search = new URLSearchParams();
  mocks.school = { id: 'ncku', name: '國立成功大學' };
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

it('publishes into the selected school despite unrelated URL author values', async () => {
  mocks.search = new URLSearchParams(
    'school=ncku&schoolId=ncku&campus=ncku&uid=other-student&boardId=science',
  );
  mocks.list.mockResolvedValue([
    { id: 'science', name: '科學討論', type: 'topic', defaultAnonymous: false },
  ]);
  mocks.publish.mockResolvedValue('published-post');
  render(<PostComposePage />);

  expect(screen.queryByText('此頁目前提供靜宜大學的資料')).toBeNull();
  await screen.findByRole('combobox', { name: '發布看板' });
  expect(mocks.list).toHaveBeenCalledWith('ncku', 80);
  expect(mocks.list).not.toHaveBeenCalledWith(PROVIDENCE_UNIVERSITY_SCHOOL_ID, 80);
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

  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/community/post/published-post?schoolId=ncku'));
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
    schoolId: 'ncku',
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

it('does not direct an ordinary member with no boards to create a board', async () => {
  mocks.list.mockResolvedValue([]);
  render(<PostComposePage />);
  await screen.findByText(/目前沒有可發布的看板/);
  expect(screen.queryByRole('link', { name: '前往建立看板' })).toBeNull();
});

it('offers verified managers a board creation link for the selected school', async () => {
  mocks.access.status = 'allowed';
  mocks.search = new URLSearchParams('schoolId=nthu');
  mocks.school = { id: 'nthu', name: '國立清華大學' };
  mocks.list.mockResolvedValue([]);
  render(<PostComposePage />);
  expect((await screen.findByRole('link', { name: '前往建立看板' })).getAttribute('href')).toBe('/community?schoolId=nthu&tab=boards');
});

it('keeps a member in the selected school when returning from an empty composer', async () => {
  mocks.search = new URLSearchParams('schoolId=ncku');
  mocks.list.mockResolvedValue([]);
  render(<PostComposePage />);
  expect((await screen.findByRole('link', { name: '回校園交流' })).getAttribute('href')).toBe('/community?schoolId=ncku');
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('does not offer creation while permission is pending or unavailable, and allows rechecking', async () => {
  mocks.access.status = 'loading';
  mocks.list.mockResolvedValue([]);
  const view = render(<PostComposePage />);
  await screen.findByText('正在確認看板管理權限…');
  expect(screen.queryByRole('link', { name: '前往建立看板' })).toBeNull();
  mocks.access.status = 'error';
  view.rerender(<PostComposePage />);
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.access.retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '發布' })).toBeNull();
});

it('does not ask members to fill an unusable post form when there are no boards', async () => {
  mocks.list.mockResolvedValue([]);
  render(<PostComposePage />);
  await screen.findByRole('heading', { name: '目前沒有可發布的看板' });
  expect(screen.queryByPlaceholderText('一句話描述你的貼文')).toBeNull();
  expect(screen.queryByPlaceholderText('想分享什麼？')).toBeNull();
  expect(screen.queryByRole('button', { name: '發布' })).toBeNull();
  expect(screen.getByRole('button', { name: '重新讀取看板' })).toBeTruthy();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('keeps a draft in state while an empty board result hides the form, then restores it on retry', async () => {
  let finish!: (rows: unknown[]) => void;
  mocks.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<PostComposePage />);
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), { target: { value: '先保留的草稿' } });
  finish([]);
  await screen.findByRole('heading', { name: '目前沒有可發布的看板' });
  expect(screen.queryByPlaceholderText('一句話描述你的貼文')).toBeNull();
  mocks.list.mockResolvedValueOnce([{ id: 'science', name: '科學討論', type: 'topic' }]);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取看板' }));
  await screen.findByRole('combobox', { name: '發布看板' });
  expect((screen.getByPlaceholderText('一句話描述你的貼文') as HTMLInputElement).value).toBe('先保留的草稿');
  expect(mocks.publish).not.toHaveBeenCalled();
});
