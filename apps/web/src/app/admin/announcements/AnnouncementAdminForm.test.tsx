import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnnouncementAdminForm } from './AnnouncementAdminForm';
import { upsertSchoolAnnouncement } from '@/lib/schoolAnnouncementsAdmin';

vi.mock('@/lib/schoolAnnouncementsAdmin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/schoolAnnouncementsAdmin')>();
  return {
    ...actual,
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
});

it('blocks submit without a title and does not call the API', async () => {
  const onSaved = vi.fn();
  render(
    <AnnouncementAdminForm
      schoolId="pu"
      schoolName="靜宜大學"
      editing={null}
      onCancelEdit={() => undefined}
      onSaved={onSaved}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '發布公告' }));
  expect((await screen.findByRole('alert')).textContent).toBe('請輸入標題');
  expect(upsertSchoolAnnouncement).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});

it('creates an announcement and shows the public detail link', async () => {
  vi.mocked(upsertSchoolAnnouncement).mockResolvedValue({
    success: true,
    announcementId: 'ann-new',
  });
  const onSaved = vi.fn();
  render(
    <AnnouncementAdminForm
      schoolId="pu"
      schoolName="靜宜大學"
      editing={null}
      onCancelEdit={() => undefined}
      onSaved={onSaved}
    />,
  );
  fireEvent.change(screen.getByLabelText('標題 *'), { target: { value: '週會改期' } });
  fireEvent.change(screen.getByLabelText('內容'), { target: { value: '改到週三' } });
  fireEvent.change(screen.getByLabelText('來源'), { target: { value: '教務處' } });
  fireEvent.click(screen.getByLabelText('置頂公告'));
  fireEvent.click(screen.getByRole('button', { name: '發布公告' }));
  expect((screen.getByRole('button', { name: '儲存中…' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await waitFor(() =>
    expect(upsertSchoolAnnouncement).toHaveBeenCalledWith({
      schoolId: 'pu',
      announcementId: null,
      title: '週會改期',
      body: '改到週三',
      source: '教務處',
      pinned: true,
    }),
  );
  expect((await screen.findByRole('status')).textContent).toContain('公告已發布');
  expect(
    screen.getByRole('link', { name: /前往 \/announcements\/ann-new/ }).getAttribute('href'),
  ).toBe('/announcements/ann-new?schoolId=pu&campus=pu');
  expect(onSaved).toHaveBeenCalledWith('ann-new', 'create');
});

it('edits an existing announcement and surfaces API failures', async () => {
  vi.mocked(upsertSchoolAnnouncement).mockRejectedValueOnce(new Error('網路中斷'));
  const onCancelEdit = vi.fn();
  render(
    <AnnouncementAdminForm
      schoolId="pu"
      schoolName="靜宜大學"
      editing={{
        id: 'ann-9',
        title: '舊標題',
        body: '舊內容',
        publishedAt: '2026-11-01T00:00:00.000Z',
        source: '學務處',
        pinned: false,
        schoolId: 'pu',
      }}
      onCancelEdit={onCancelEdit}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByDisplayValue('舊標題')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('標題 *'), { target: { value: '新標題' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));
  expect((await screen.findByRole('alert')).textContent).toBe('網路中斷');
  expect(upsertSchoolAnnouncement).toHaveBeenCalledWith(
    expect.objectContaining({ schoolId: 'pu', announcementId: 'ann-9', title: '新標題' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '取消編輯' }));
  expect(onCancelEdit).toHaveBeenCalled();
});
