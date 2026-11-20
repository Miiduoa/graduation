import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  expect(screen.getByRole('link', { name: '連線學校帳號' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往公開交流' }).getAttribute('href')).toBe('/social?schoolId=ncku');
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

it('keeps the confirmed empty section and focused retry button through loading and failure', async () => {
  let rejectRetry!: (error: Error) => void;
  mocks.list.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise((_resolve, reject) => {
    rejectRetry = reject;
  }));
  render(<PostComposePage />);
  const heading = await screen.findByRole('heading', { name: '目前沒有可發布的看板' });
  const section = heading.closest('section');
  const retry = screen.getByRole('button', { name: '重新讀取看板' });
  retry.focus();
  fireEvent.click(retry);

  expect(screen.getByRole('heading', { name: '目前沒有可發布的看板' })).toBe(heading);
  expect(heading.closest('section')).toBe(section);
  expect(screen.getByRole('button', { name: '重新讀取看板' })).toBe(retry);
  expect(retry.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(retry);
  expect(screen.queryByPlaceholderText('一句話描述你的貼文')).toBeNull();
  expect(screen.getByRole('link', { name: '回校園交流' }).getAttribute('href')).toBe('/community?schoolId=ncku');
  fireEvent.click(retry);
  expect(mocks.list).toHaveBeenCalledTimes(2);

  await act(async () => rejectRetry(new Error('offline')));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('暫時無法讀取看板'));
  expect(screen.getByRole('button', { name: '重新讀取看板' })).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute('aria-disabled')).toBe('false');
  expect(screen.queryByPlaceholderText('一句話描述你的貼文')).toBeNull();

  mocks.list.mockResolvedValueOnce([]);
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: '重新讀取看板' })).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('moves the empty retry focus to the restored board picker and preserves the draft', async () => {
  let finishInitial!: (rows: unknown[]) => void;
  let finishRetry!: (rows: unknown[]) => void;
  mocks.list
    .mockReturnValueOnce(new Promise((resolve) => { finishInitial = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { finishRetry = resolve; }));
  render(<PostComposePage />);
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), { target: { value: '保留標題' } });
  fireEvent.change(screen.getByPlaceholderText('想分享什麼？'), { target: { value: '保留內文' } });
  await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
  await act(async () => finishInitial([]));
  const retry = screen.getByRole('button', { name: '重新讀取看板' });
  retry.focus();
  fireEvent.click(retry);
  await act(async () => finishRetry([{ id: 'science', name: '科學討論', type: 'topic' }]));

  const picker = await screen.findByRole('combobox', { name: '發布看板' });
  expect(document.activeElement).toBe(picker);
  expect((screen.getByPlaceholderText('一句話描述你的貼文') as HTMLInputElement).value).toBe('保留標題');
  expect((screen.getByPlaceholderText('想分享什麼？') as HTMLTextAreaElement).value).toBe('保留內文');
  expect(screen.queryByRole('heading', { name: '目前沒有可發布的看板' })).toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('does not steal focus after the user leaves an empty retry for another control', async () => {
  let finishRetry!: (rows: unknown[]) => void;
  mocks.list.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise((resolve) => { finishRetry = resolve; }));
  render(<><button type="button">外部操作</button><PostComposePage /></>);
  await screen.findByRole('heading', { name: '目前沒有可發布的看板' });
  const retry = screen.getByRole('button', { name: '重新讀取看板' });
  retry.focus();
  fireEvent.click(retry);
  const external = screen.getByRole('button', { name: '外部操作' });
  external.focus();
  await act(async () => finishRetry([{ id: 'science', name: '科學討論', type: 'topic' }]));

  await screen.findByRole('combobox', { name: '發布看板' });
  expect(document.activeElement).toBe(external);
});

it('moves to the title after retry restores a fixed board whose picker is disabled', async () => {
  let finishRetry!: (rows: unknown[]) => void;
  mocks.search = new URLSearchParams('schoolId=ncku&boardId=science');
  mocks.list.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise((resolve) => { finishRetry = resolve; }));
  render(<PostComposePage />);
  await screen.findByRole('heading', { name: '目前沒有可發布的看板' });
  const retry = screen.getByRole('button', { name: '重新讀取看板' });
  retry.focus();
  fireEvent.click(retry);
  await act(async () => finishRetry([{ id: 'science', name: '科學討論', type: 'topic' }]));

  expect((await screen.findByRole('combobox', { name: '發布看板' }) as HTMLSelectElement).disabled).toBe(true);
  expect(document.activeElement).toBe(screen.getByPlaceholderText('一句話描述你的貼文'));
});

it('starts a creator-profile post as attributed, even in a board that normally defaults anonymous', async () => {
  mocks.search = new URLSearchParams('schoolId=ncku&source=profile&boardId=science');
  mocks.list.mockResolvedValue([
    { id: 'science', name: '科學討論', type: 'topic', defaultAnonymous: true },
  ]);
  mocks.publish.mockResolvedValue('creator-post');
  render(<PostComposePage />);
  await screen.findByRole('combobox', { name: '發布看板' });
  const anonymous = screen.getByRole('checkbox', { name: '匿名貼文' }) as HTMLInputElement;
  expect(anonymous.checked).toBe(false);
  expect(screen.getByText(/將以你的帳號署名發表/)).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), { target: { value: '第一則作品' } });
  fireEvent.change(screen.getByPlaceholderText('想分享什麼？'), { target: { value: '校園成果' } });
  fireEvent.click(screen.getByRole('button', { name: '發布' }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
    authorUid: 'student', anonymous: false, schoolId: 'ncku',
  })));
});

it('still lets the creator explicitly choose anonymity without attributing the post', async () => {
  mocks.search = new URLSearchParams('source=profile&boardId=science');
  mocks.list.mockResolvedValue([
    { id: 'science', name: '科學討論', type: 'topic', defaultAnonymous: true },
  ]);
  mocks.publish.mockResolvedValue('anonymous-post');
  render(<PostComposePage />);
  await screen.findByRole('combobox', { name: '發布看板' });
  fireEvent.click(screen.getByRole('checkbox', { name: '匿名貼文' }));
  expect(screen.getByText(/匿名貼文不會出現在個人作品中/)).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('一句話描述你的貼文'), { target: { value: '匿名問題' } });
  fireEvent.change(screen.getByPlaceholderText('想分享什麼？'), { target: { value: '還是保持匿名' } });
  fireEvent.click(screen.getByRole('button', { name: '發布' }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
    anonymous: true,
  })));
  expect(mocks.publish.mock.calls[0][0]).not.toHaveProperty('authorUid');
});
