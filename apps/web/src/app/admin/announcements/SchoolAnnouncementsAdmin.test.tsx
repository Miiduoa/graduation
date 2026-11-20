import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SchoolAnnouncementsAdmin } from './SchoolAnnouncementsAdmin';
import type { Announcement } from '@/lib/firebase';
import {
  listSchoolAnnouncementsForAdmin,
  upsertSchoolAnnouncement,
} from '@/lib/schoolAnnouncementsAdmin';

const mocks = vi.hoisted(() => ({
  user: null as null | { uid: string },
  loading: false,
  role: null as string | null,
  roleStatus: 'ready' as 'loading' | 'ready' | 'error',
  retry: vi.fn(),
  campus: {
    status: 'ready' as 'ready' | 'loading' | 'error' | 'unselected',
    schoolId: 'pu' as string | null,
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu&campus=pu',
  },
}));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: mocks.user, loading: mocks.loading }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => mocks.campus,
}));
vi.mock('@/lib/useSchoolRole', () => ({
  useSchoolRoleState: () => ({ status: mocks.roleStatus, role: mocks.role, retry: mocks.retry }),
}));
vi.mock('@/lib/schoolAnnouncementsAdmin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/schoolAnnouncementsAdmin')>();
  return {
    ...actual,
    listSchoolAnnouncementsForAdmin: vi.fn(),
    upsertSchoolAnnouncement: vi.fn(),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function announcement(id: string, title: string, schoolId = 'pu'): Announcement {
  return { id, title, body: '內容', publishedAt: '2026-11-01T08:00:00.000Z', schoolId };
}

function selectSchool(schoolId: string) {
  mocks.campus = {
    status: 'ready',
    schoolId,
    schoolName: schoolId === 'pu' ? '靜宜大學' : '清華大學',
    schoolSearch: `?schoolId=${schoolId}&campus=${schoolId}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { uid: 'admin-1' };
  mocks.loading = false;
  mocks.role = 'admin';
  mocks.roleStatus = 'ready';
  mocks.retry.mockReset();
  mocks.campus = {
    status: 'ready',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu&campus=pu',
  };
  vi.mocked(upsertSchoolAnnouncement).mockReset();
  vi.mocked(listSchoolAnnouncementsForAdmin)
    .mockReset()
    .mockResolvedValue([
      {
        id: 'ann-1',
        title: '既有公告',
        body: '內容',
        publishedAt: '2026-11-01T08:00:00.000Z',
        source: '教務處',
        pinned: true,
        schoolId: 'pu',
      },
    ]);
});

it('lists school announcements for an admin and allows editing', async () => {
  render(<SchoolAnnouncementsAdmin />);
  expect(screen.getByRole('heading', { name: '校園公告' })).toBeTruthy();
  await waitFor(() => expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledWith('pu'));
  expect(await screen.findByText('置頂 · 既有公告')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  expect(screen.getByRole('heading', { name: '編輯公告' })).toBeTruthy();
  expect(screen.getByDisplayValue('既有公告')).toBeTruthy();
});

it('hides the editor when the existing role flag is not admin or editor', async () => {
  mocks.role = 'student';
  render(<SchoolAnnouncementsAdmin />);
  expect(await screen.findByText('目前帳號無法管理公告')).toBeTruthy();
  expect(listSchoolAnnouncementsForAdmin).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '發布公告' })).toBeNull();
});

it('asks guests to sign in before managing announcements', () => {
  mocks.user = null;
  render(<SchoolAnnouncementsAdmin />);
  expect(screen.getByRole('heading', { name: '請先登入' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fadmin%2Fannouncements%3FschoolId%3Dpu%26campus%3Dpu',
  );
});

it.each(['pu', 'nthu'])(
  'opens the public list and announcement in the managed school %s',
  async (schoolId) => {
    selectSchool(schoolId);
    render(<SchoolAnnouncementsAdmin />);
    expect(await screen.findByText('置頂 · 既有公告')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看公開公告列表' }).getAttribute('href')).toBe(
      `/announcements?schoolId=${schoolId}&campus=${schoolId}`,
    );
    expect(screen.getByRole('link', { name: '查看公開頁' }).getAttribute('href')).toBe(
      `/announcements/ann-1?schoolId=${schoolId}&campus=${schoolId}`,
    );
  },
);

it('keeps the public list reachable before the first announcement is published', async () => {
  vi.mocked(listSchoolAnnouncementsForAdmin).mockResolvedValue([]);
  render(<SchoolAnnouncementsAdmin />);
  expect(await screen.findByText('尚無公告。可在左側表單發布第一則。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看公開公告列表' })).toBeTruthy();
});

it('shows a confirmed missing membership as no access with recovery and a same-school public exit', () => {
  mocks.role = null;
  render(<SchoolAnnouncementsAdmin />);
  expect(screen.getByRole('heading', { name: '目前帳號無法管理公告' })).toBeTruthy();
  expect(screen.queryByText('正在確認校管權限…')).toBeNull();
  expect(screen.getByRole('link', { name: '查看公開公告' }).getAttribute('href')).toBe(
    '/announcements?schoolId=pu&campus=pu',
  );
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
  expect(listSchoolAnnouncementsForAdmin).not.toHaveBeenCalled();
});

it('keeps a public exit and retry available while only unconfirmed membership is available', () => {
  mocks.roleStatus = 'loading';
  selectSchool('nthu');
  render(<SchoolAnnouncementsAdmin />);
  expect(screen.getByRole('status').textContent).toContain('正在確認校管權限');
  expect(screen.getByRole('link', { name: '查看公開公告' }).getAttribute('href')).toBe(
    '/announcements?schoolId=nthu&campus=nthu',
  );
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '發布公告' })).toBeNull();
  expect(listSchoolAnnouncementsForAdmin).not.toHaveBeenCalled();
});

it('recovers from a membership read failure only after retry confirms the current role', async () => {
  mocks.roleStatus = 'error';
  mocks.role = null;
  mocks.retry.mockImplementation(() => {
    mocks.roleStatus = 'loading';
  });
  const { rerender } = render(<SchoolAnnouncementsAdmin />);
  expect(screen.getByRole('heading', { name: '暫時無法確認校管權限' })).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.retry).toHaveBeenCalledOnce();
  rerender(<SchoolAnnouncementsAdmin />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('正在確認校管權限');
  expect(listSchoolAnnouncementsForAdmin).not.toHaveBeenCalled();
  mocks.roleStatus = 'ready';
  mocks.role = 'admin';
  rerender(<SchoolAnnouncementsAdmin />);
  expect(await screen.findByText('置頂 · 既有公告')).toBeTruthy();
  expect(screen.getByRole('button', { name: '發布公告' })).toBeTruthy();
  expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledExactlyOnceWith('pu');
});

it.each(['school', 'account'] as const)(
  'clears the previous draft and list on %s changes and ignores its pending save completion',
  async (change) => {
    const save = deferred<{ success: true; announcementId: string }>();
    vi.mocked(upsertSchoolAnnouncement).mockReturnValueOnce(save.promise);
    const { rerender } = render(<SchoolAnnouncementsAdmin />);
    await screen.findByText('置頂 · 既有公告');
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.change(screen.getByLabelText('標題 *'), { target: { value: '前一範圍的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
    await waitFor(() => expect(upsertSchoolAnnouncement).toHaveBeenCalledOnce());
    expect(upsertSchoolAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'pu', announcementId: 'ann-1', title: '前一範圍的草稿' }),
    );

    const nextList = deferred<Announcement[]>();
    vi.mocked(listSchoolAnnouncementsForAdmin).mockReturnValueOnce(nextList.promise);
    if (change === 'school') selectSchool('nthu');
    else mocks.user = { uid: 'admin-2' };
    rerender(<SchoolAnnouncementsAdmin />);
    expect((screen.getByLabelText('標題 *') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('置頂 · 既有公告')).toBeNull();
    await waitFor(() => expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledTimes(2));
    await act(async () =>
      nextList.resolve([announcement('ann-2', '目前範圍的公告', mocks.campus.schoolId!)]),
    );
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.change(screen.getByLabelText('標題 *'), { target: { value: '目前範圍的新草稿' } });

    await act(async () => save.resolve({ success: true, announcementId: 'ann-1' }));
    expect(screen.getByRole('heading', { name: '編輯公告' })).toBeTruthy();
    expect((screen.getByLabelText('標題 *') as HTMLInputElement).value).toBe('目前範圍的新草稿');
    expect(screen.getByText('目前範圍的公告')).toBeTruthy();
    expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledTimes(2);
    expect(upsertSchoolAnnouncement).toHaveBeenCalledOnce();
  },
);

it('ignores old list results and failures after an A to B to A campus change', async () => {
  const oldA = deferred<Announcement[]>();
  const oldB = deferred<Announcement[]>();
  const currentA = deferred<Announcement[]>();
  vi.mocked(listSchoolAnnouncementsForAdmin)
    .mockReturnValueOnce(oldA.promise)
    .mockReturnValueOnce(oldB.promise)
    .mockReturnValueOnce(currentA.promise);
  const { rerender } = render(<SchoolAnnouncementsAdmin />);
  await waitFor(() => expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledTimes(1));
  selectSchool('nthu');
  rerender(<SchoolAnnouncementsAdmin />);
  await waitFor(() => expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledTimes(2));
  selectSchool('pu');
  rerender(<SchoolAnnouncementsAdmin />);
  await waitFor(() => expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledTimes(3));
  await act(async () => currentA.resolve([announcement('current', '目前公告')]));
  expect(screen.getByText('目前公告')).toBeTruthy();
  await act(async () => {
    oldA.resolve([announcement('old', '過期公告')]);
    oldB.reject(new Error('另一校的過期查詢失敗'));
  });
  expect(screen.getByText('目前公告')).toBeTruthy();
  expect(screen.queryByText('過期公告')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('discards private editing state after access is revoked and starts fresh when it returns', async () => {
  const { rerender } = render(<SchoolAnnouncementsAdmin />);
  await screen.findByText('置頂 · 既有公告');
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText('標題 *'), { target: { value: '撤銷前的未存草稿' } });
  mocks.role = null;
  rerender(<SchoolAnnouncementsAdmin />);
  expect(screen.getByRole('heading', { name: '目前帳號無法管理公告' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '標題 *' })).toBeNull();
  expect(screen.queryByText('置頂 · 既有公告')).toBeNull();
  mocks.role = 'admin';
  rerender(<SchoolAnnouncementsAdmin />);
  await waitFor(() => expect(listSchoolAnnouncementsForAdmin).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('heading', { name: '發布公告' })).toBeTruthy();
  expect((screen.getByLabelText('標題 *') as HTMLInputElement).value).toBe('');
});
