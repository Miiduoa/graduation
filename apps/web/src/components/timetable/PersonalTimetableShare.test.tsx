import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta, shareCopiedCopy } from '@campus/shared';
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
    const owner = mocks.auth.user ? `school:${mocks.auth.user.uid}` : 'guest';
    return {
      scope: { owner, schoolId: 'pu' },
      scopeKey: JSON.stringify([owner, 'pu']),
      loading: mocks.auth.loading,
      schoolName: '靜宜大學',
    };
  },
  usePersonalImports: () => ({ records: [], error: '', loading: false }),
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
