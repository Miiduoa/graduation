import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanMeta } from '@campus/shared';
import { PersonalTimetable } from './PersonalTimetable';

const context = vi.hoisted(() => ({
  schoolId: 'nthu',
  owner: 'guest',
  records: [] as Array<Record<string, unknown>>,
  load: vi.fn(),
  academic: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/timetable',
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: { owner: context.owner, schoolId: context.schoolId },
    scopeKey: context.owner + ':' + context.schoolId,
    loading: false,
    schoolName: context.schoolId === 'nthu' ? '國立清華大學' : '靜宜大學',
  }),
  usePersonalImports: () => ({
    records: context.records,
    error: '',
    loading: false,
  }),
}));
vi.mock('@/lib/timetable/store', () => ({
  CLOUD_NOT_READY_COPY: '目前只能儲存在這台裝置',
  TIMETABLE_DEVICE_ONLY_STORED_COPY: '已存在這台裝置',
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY: '存在這台裝置',
  TimetableCloudSaveError: class TimetableCloudSaveError extends Error {},
  loadPersonalTimetable: context.load,
  savePersonalTimetable: vi.fn(async () => ({ stored: 'local' })),
  loadFriendTimetable: vi.fn(async () => null),
  listMyMeetups: vi.fn(async () => []),
  listAcceptedFriends: vi.fn(async () => []),
  createMeetup: vi.fn(),
  createServerShare: vi.fn(),
  respondMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/friends', () => ({
  listAcceptedFriends: vi.fn(async () => []),
}));
vi.mock('@/lib/useAcademicRecords', () => ({
  useAcademicRecords: (kind: string, enabled: boolean) => {
    context.academic(kind, enabled);
    return { state: null, refresh: vi.fn() };
  },
}));
vi.mock('@/components/SchoolAccountRequired', () => ({
  SchoolAccountRequired: () => null,
}));

const record = (schoolId: string, id: string, title: string) => ({
  id, batchId: 'batch', kind: 'timetable', schoolId,
  title, academicYear: '115', semester: '1',
  dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
  teacher: '', location: '', importedAt: '2026-10-14T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/timetable');
  context.schoolId = 'nthu';
  context.owner = 'guest';
  context.records = [];
  context.load.mockImplementation(async (_uid: string | null, schoolId: string) => ({
    schoolId, courses: [], meta: cleanMeta({}), shareWithFriends: false,
    updatedAt: '2026-10-14T00:00:00Z',
  }));
});
afterEach(cleanup);

it('shows only imported courses belonging to the selected university', async () => {
  context.records = [
    record('pu', 'pu-course', '靜宜舊課表'),
    record('nthu', 'nthu-course', '清大新課表'),
  ];
  render(<PersonalTimetable />);
  await waitFor(() => expect(context.load).toHaveBeenCalledWith(null, 'nthu', 'guest'));
  expect(await screen.findByText(/自行匯入 1 筆/)).toBeTruthy();
  expect(screen.getAllByText('清大新課表').length).toBeGreaterThan(0);
  expect(screen.queryByText('靜宜舊課表')).toBeNull();
  expect(context.academic).toHaveBeenCalledWith('courses', false);
});

it('does not show a manual and imported copy of the same class as conflicting courses', async () => {
  context.schoolId = 'pu';
  context.records = [record('pu', 'imported', '同一門課')];
  context.load.mockResolvedValue({
    schoolId: 'pu',
    courses: [{ id: 'manual', name: '同一門課', day: 1, start: 3, end: 4, teacher: '', room: '', color: 'blue' }],
    meta: cleanMeta({ year: '115', semester: '1' }),
    shareWithFriends: false,
    updatedAt: '2026-10-20T00:00:00Z',
  });
  render(<PersonalTimetable />);
  await screen.findAllByText('同一門課');
  fireEvent.click(screen.getByRole('button', { name: '一週' }));
  expect(screen.getAllByText('同一門課')).toHaveLength(1);
  expect(screen.queryByRole('region', { name: '衝堂' })).toBeNull();
});

it('resets the timetable and importer when the browsing school changes', async () => {
  context.records = [
    record('pu', 'pu-course', '靜宜舊課表'),
    record('nthu', 'nthu-course', '清大新課表'),
  ];
  const view = render(<PersonalTimetable />);
  expect(await screen.findByText(/自行匯入 1 筆/)).toBeTruthy();
  context.schoolId = 'pu';
  view.rerender(<PersonalTimetable />);
  await waitFor(() => expect(context.load).toHaveBeenCalledWith(null, 'pu', 'guest'));
  expect(screen.getAllByText('靜宜舊課表').length).toBeGreaterThan(0);
  expect(screen.queryByText('清大新課表')).toBeNull();
  expect(context.academic).toHaveBeenCalledWith('courses', true);
});

it('does not silently load Providence data when no campus is selected', () => {
  context.schoolId = 'personal';
  render(<PersonalTimetable />);
  expect(screen.getByRole('status').textContent).toContain('請先選擇一所學校');
  expect(context.load).not.toHaveBeenCalled();
});

it('shows the newest academic term even when an older term was imported later', async () => {
  context.records = [record('nthu', 'new', '本學期課程'), {
    ...record('nthu', 'old', '舊學期課程'), academicYear: '114', semester: '2',
  }];
  render(<PersonalTimetable />);
  expect((await screen.findAllByText('本學期課程')).length).toBeGreaterThan(0);
  expect(screen.queryByText('舊學期課程')).toBeNull();
});

it('keeps the academic term selected on Today when opening the full timetable', async () => {
  window.history.replaceState({}, '', '/timetable?term=114%7C2');
  context.records = [record('nthu', 'new', '本學期課程'), {
    ...record('nthu', 'old', '舊學期課程'), academicYear: '114', semester: '2',
  }];
  render(<PersonalTimetable />);
  expect((await screen.findAllByText('舊學期課程')).length).toBeGreaterThan(0);
  expect(screen.queryByText('本學期課程')).toBeNull();
});
