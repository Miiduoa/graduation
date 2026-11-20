import { beforeEach, expect, it, vi } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import {
  announcementPublicHref,
  listSchoolAnnouncementsForAdmin,
  upsertSchoolAnnouncement,
  validateSchoolAnnouncementDraft,
} from './schoolAnnouncementsAdmin';

const mockCall = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCall),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => args.join('/')),
  getDocsFromServer: (...args: unknown[]) => mockGetDocs(...args),
  limit: vi.fn((n: number) => ({ limit: n })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: field, dir })),
  query: vi.fn((...args: unknown[]) => args),
}));

vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => true,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCall.mockReset();
  mockGetDocs.mockReset();
});

it('rejects empty titles and trims fields for the mobile-compatible payload', () => {
  expect(validateSchoolAnnouncementDraft({ title: '  ', body: '', source: '', pinned: false })).toEqual(
    { ok: false, error: '請輸入標題' },
  );
  expect(
    validateSchoolAnnouncementDraft({
      title: '  週會通知  ',
      body: ' 請準時  ',
      source: ' 教務處 ',
      pinned: true,
    }),
  ).toEqual({
    ok: true,
    value: { title: '週會通知', body: '請準時', source: '教務處', pinned: true },
  });
});

it('calls upsertSchoolAnnouncement with the same fields as mobile AdminDashboard', async () => {
  mockCall.mockResolvedValue({ data: { success: true, announcementId: 'ann-1' } });
  await expect(
    upsertSchoolAnnouncement({
      schoolId: 'pu',
      announcementId: null,
      title: ' 開課公告 ',
      body: '詳見內文',
      source: '教務處',
      pinned: true,
    }),
  ).resolves.toEqual({ success: true, announcementId: 'ann-1' });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'upsertSchoolAnnouncement');
  expect(mockCall).toHaveBeenCalledWith({
    schoolId: 'pu',
    announcementId: null,
    title: '開課公告',
    body: '詳見內文',
    source: '教務處',
    pinned: true,
  });
});

it('updates an existing announcement when announcementId is provided', async () => {
  mockCall.mockResolvedValue({ data: { success: true, announcementId: 'ann-9' } });
  await upsertSchoolAnnouncement({
    schoolId: 'pu',
    announcementId: 'ann-9',
    title: '更新後標題',
    body: '',
    source: '',
    pinned: false,
  });
  expect(mockCall).toHaveBeenCalledWith({
    schoolId: 'pu',
    announcementId: 'ann-9',
    title: '更新後標題',
    body: '',
    source: undefined,
    pinned: false,
  });
});

it('lists school announcements for admin without public feed filters', async () => {
  mockGetDocs.mockResolvedValue({
    docs: [
      {
        id: 'a1',
        data: () => ({
          title: '置頂公告',
          body: '內容',
          publishedAt: '2026-11-01T00:00:00.000Z',
          pinned: true,
          source: '學務處',
        }),
      },
      {
        id: 'bad',
        data: () => ({ title: '', body: 'skip' }),
      },
    ],
  });
  await expect(listSchoolAnnouncementsForAdmin('pu')).resolves.toEqual([
    {
      id: 'a1',
      title: '置頂公告',
      body: '內容',
      summary: '內容',
      publishedAt: '2026-11-01T00:00:00.000Z',
      pinned: true,
      source: '學務處',
      schoolId: 'pu',
    },
  ]);
});

it('builds a public detail href with school context', () => {
  expect(announcementPublicHref('ann-1', 'pu')).toBe(
    '/announcements/ann-1?schoolId=pu&campus=pu',
  );
});
