import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SchoolAnnouncementsAdmin } from './SchoolAnnouncementsAdmin';
import { listSchoolAnnouncementsForAdmin } from '@/lib/schoolAnnouncementsAdmin';

const mocks = vi.hoisted(() => ({
  user: null as null | { uid: string },
  loading: false,
  role: null as string | null,
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
  useSchoolRole: () => mocks.role,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { uid: 'admin-1' };
  mocks.loading = false;
  mocks.role = 'admin';
  mocks.campus = {
    status: 'ready',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu&campus=pu',
  };
  vi.mocked(listSchoolAnnouncementsForAdmin).mockResolvedValue([
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
    '/login?returnUrl=%2Fadmin%2Fannouncements',
  );
});
