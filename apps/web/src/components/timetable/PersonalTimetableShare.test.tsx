import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta, shareCopiedCopy, type PersonalImportRecord } from '@campus/shared';
import { PersonalTimetable } from './PersonalTimetable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/timetable',
}));

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null, loading: false },
  load: vi.fn(),
  save: vi.fn(),
  share: vi.fn(),
  friends: vi.fn(),
  invite: vi.fn(),
  friend: vi.fn(),
  meetup: vi.fn(),
  records: [] as PersonalImportRecord[],
  platformOwner: null as string | null,
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({ selectedSchoolId: 'pu', loading: false }),
  useOptionalSelectedSchool: () => ({
    selectedSchoolId: 'pu',
    selectedSchool: { id: 'pu', name: '靜宜大學' },
    loading: false,
    catalogStatus: 'ready',
  }),
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => {
    const owner =
      mocks.platformOwner ?? (mocks.auth.user ? `school:${mocks.auth.user.uid}` : 'guest');
    return {
      scope: { owner, schoolId: 'pu' },
      scopeKey: JSON.stringify([owner, 'pu']),
      loading: mocks.auth.loading,
      schoolName: '靜宜大學',
    };
  },
  usePersonalImports: () => ({ records: mocks.records, error: '', loading: false }),
}));
vi.mock('@/lib/timetable/store', () => ({
  CLOUD_NOT_READY_COPY: '這個功能還沒接通，雲端備份先不用。',
  TIMETABLE_DEVICE_ONLY_STORED_COPY: '已存在這台裝置',
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY: '存在這台裝置',
  TimetableCloudSaveError: class TimetableCloudSaveError extends Error {},
  loadPersonalTimetable: mocks.load,
  savePersonalTimetable: mocks.save,
  createServerShare: mocks.share,
  loadFriendTimetable: mocks.friend,
  listMyMeetups: mocks.invite,
  createMeetup: mocks.meetup,
  respondMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/friends', () => ({ listAcceptedFriends: mocks.friends }));
vi.mock('@/lib/useAcademicRecords', () => ({ useAcademicRecords: () => ({ state: null }) }));

const expiresAt = '2026-10-15T12:00:00.000Z';
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = { uid: 'alice' };
  mocks.auth.loading = false;
  mocks.records = [];
  mocks.platformOwner = null;
  mocks.load.mockResolvedValue({
    courses: [cleanCourse({ id: 'a', name: '資料庫', day: 1, start: 1, end: 2 })],
    meta: cleanMeta({ title: '我的課表' }),
    shareWithFriends: true,
    updatedAt: '2026-10-14T00:00:00.000Z',
    schoolId: 'pu',
  });
  mocks.save.mockResolvedValue({ stored: 'local' });
  mocks.share.mockResolvedValue({ path: '/timetable/s/test', expiresAt });
  mocks.friends.mockResolvedValue([]);
  mocks.invite.mockResolvedValue([]);
  mocks.friend.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

async function ready() {
  const view = render(<PersonalTimetable />);
  await screen.findByRole('button', { name: '新增課程' });
  return view;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

it.each(['denied', 'unavailable'])(
  'preserves manual copy and never reports copied if clipboard is %s',
  async (mode) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        mode === 'denied'
          ? { writeText: vi.fn().mockRejectedValue(new Error('blocked')) }
          : undefined,
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
    await screen.findByText(/瀏覽器(未完成|無法自動)複製/);
    const link = screen.getByRole('textbox', { name: '分享連結' }) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/timetable/s/test`);
    expect(link.readOnly).toBe(true);
    expect(screen.queryByText(shareCopiedCopy(expiresAt))).toBeNull();
  },
);

it('only reports clipboard success after write completes and blocks duplicate requests', async () => {
  const pending = deferred<void>();
  const writeText = vi.fn(() => pending.promise);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const busy = screen.getByRole('button', { name: '正在產生連結…' }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  fireEvent.click(busy);
  expect(mocks.share).toHaveBeenCalledOnce();
  expect(screen.queryByText(shareCopiedCopy(expiresAt))).toBeNull();
  await act(async () => pending.resolve());
  expect(screen.getByText(shareCopiedCopy(expiresAt))).toBeTruthy();
});

it('does not write the previous account share URL when account changes during creation', async () => {
  const pending = deferred<{ path: string; expiresAt: string }>();
  mocks.share.mockReturnValueOnce(pending.promise);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  mocks.auth.user = { uid: 'bob' };
  view.rerender(<PersonalTimetable />);
  await screen.findByRole('button', { name: '新增課程' });
  await act(async () => pending.resolve({ path: '/timetable/s/old', expiresAt }));
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '分享連結' })).toBeNull();
});

it('isolates school-account changes even when the platform account stays signed in', async () => {
  mocks.platformOwner = 'platform:unchanged-account';
  const pending = deferred<{ path: string; expiresAt: string }>();
  mocks.share.mockReturnValueOnce(pending.promise);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  const newAccount = deferred<ReturnType<typeof cleanMeta>>();
  mocks.load.mockReturnValueOnce(newAccount.promise);
  mocks.auth.user = { uid: 'different-school-account' };
  view.rerender(<PersonalTimetable />);
  expect(screen.queryByRole('button', { name: '複製分享連結' })).toBeNull();
  expect(screen.queryByText('資料庫')).toBeNull();
  await act(async () =>
    pending.resolve({ path: '/timetable/s/previous-school-account', expiresAt }),
  );
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '分享連結' })).toBeNull();
});

it('refuses an off-site or malformed share path from the backend', async () => {
  mocks.share.mockResolvedValueOnce({ path: 'https://other.invalid/private', expiresAt });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  await screen.findByText(/現在產生不了分享連結/);
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '分享連結' })).toBeNull();
});

it('shows the server reason when there is no shareable timetable', async () => {
  mocks.share.mockRejectedValueOnce(new Error('還沒有可分享的課表。'));
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  await screen.findByText('還沒有可分享的課表。');
  expect(screen.queryByText(/現在產生不了分享連結/)).toBeNull();
});

it('does not claim sharing is disconnected when a school account is signed in', async () => {
  await ready();
  expect(screen.getByRole('button', { name: '複製分享連結' })).toBeTruthy();
  expect(screen.queryByText(/這個功能還沒接通。分享連結/)).toBeNull();
  expect(screen.queryByText(/登入學校帳號後就能分享課表連結/)).toBeNull();
  expect(screen.queryByText(/網站的學校帳號登入還沒開放/)).toBeNull();
  expect(screen.queryByRole('link', { name: '登入學校帳號' })).toBeNull();
});

it('sends the on-screen timetable when creating a share link', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  await waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
  expect(mocks.share).toHaveBeenCalledWith(
    'pu',
    '我的課表',
    expect.objectContaining({
      courses: [expect.objectContaining({ name: '資料庫' })],
      meta: expect.objectContaining({ title: '我的課表' }),
    }),
  );
});

function importedCourse(overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord {
  return {
    id: 'current-import',
    kind: 'timetable',
    title: '匯入的網路通訊',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
    dayOfWeek: 2,
    startPeriod: 3,
    endPeriod: 4,
    batchId: 'test-import',
    importedAt: '2026-10-25T00:00:00Z',
    source: { type: 'paste', line: 1, rawText: '' },
    ...overrides,
  };
}

it('shares an imported-only semester with its own metadata and excludes other semesters', async () => {
  mocks.records = [
    importedCourse(),
    importedCourse({ id: 'previous', title: '上學期課程', academicYear: '114', semester: '2' }),
    importedCourse({ id: 'unplaced', title: '時間待確認', dayOfWeek: undefined }),
  ];
  mocks.load.mockResolvedValueOnce({
    courses: [],
    meta: cleanMeta({ title: '舊學期', year: '114', semester: '2' }),
    shareWithFriends: true,
    updatedAt: '',
    schoolId: 'pu',
  });
  await ready();
  const share = screen.getByRole('button', { name: '複製分享連結' });
  expect((share as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(share);
  await waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
  expect(mocks.share).toHaveBeenCalledWith('pu', '115 學年度第 1 學期課表', {
    courses: [
      expect.objectContaining({ name: '匯入的網路通訊', day: 2, start: 3, end: 4 }),
      expect.objectContaining({ name: '時間待確認', day: 0 }),
    ],
    meta: expect.objectContaining({ year: '115', semester: '1', school: '靜宜大學' }),
  });
});

it('does not copy or present a share link after the displayed semester changes', async () => {
  mocks.records = [importedCourse()];
  const pending = deferred<{ path: string; expiresAt: string }>();
  mocks.share.mockReturnValueOnce(pending.promise);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
  fireEvent.change(screen.getByLabelText('顯示自行匯入的學期'), { target: { value: 'manual' } });
  await act(async () => pending.resolve({ path: '/timetable/s/old-semester', expiresAt }));
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '分享連結' })).toBeNull();
  expect(screen.queryByText(shareCopiedCopy(expiresAt))).toBeNull();
});
