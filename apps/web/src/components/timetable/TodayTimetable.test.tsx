import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanMeta, cleanCourse, type PersonalImportRecord } from '@campus/shared';
import { TodayTimetable } from './TodayTimetable';
import { loadPersonalTimetable, type StoredTimetable } from '@/lib/timetable/store';

const state = vi.hoisted(() => ({
  owner: 'guest',
  schoolId: 'ncku',
  loading: false,
  pendingLogout: false,
  error: '',
  uid: null as string | null,
  records: [] as PersonalImportRecord[],
  importError: '',
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: { owner: state.owner, schoolId: state.schoolId },
    scopeKey: `${state.owner}:${state.schoolId}`,
    loading: state.loading,
    schoolName: state.schoolId,
  }),
  usePersonalImports: () => ({ records: state.records, error: state.importError, loading: false }),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: () => ({}) }));
vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => <button>選擇校園</button> }));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => ({ pendingLogout: state.pendingLogout, error: state.error }),
}));
vi.mock('@/lib/timetable/store', () => ({ loadPersonalTimetable: vi.fn() }));
const now = new Date('2026-10-19T00:30:00Z');
const saved = (name?: string): StoredTimetable => ({
  schoolId: 'ncku',
  courses: name ? [cleanCourse({ id: name, name, day: 1, start: 2, end: 3, room: '資工101' })] : [],
  meta: cleanMeta({ year: '115', semester: '1' }),
  updatedAt: now.toISOString(),
  shareWithFriends: false,
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    owner: 'guest',
    schoolId: 'ncku',
    loading: false,
    pendingLogout: false,
    error: '',
    uid: null,
    records: [],
    importError: '',
  });
  vi.mocked(loadPersonalTimetable).mockResolvedValue(saved());
});
it('offers local import without a school login and keeps selected campus in its destination', async () => {
  render(<TodayTimetable now={now} />);
  expect((await screen.findByRole('link', { name: '匯入我的課表' })).getAttribute('href')).toBe(
    '/import?kind=timetable&campus=ncku',
  );
  expect(loadPersonalTimetable).toHaveBeenCalledWith(null, 'ncku', 'guest');
});
it('shows hand-entered classes with actual time and room, including after focus refresh', async () => {
  vi.mocked(loadPersonalTimetable).mockResolvedValue(saved('資料庫'));
  render(<TodayTimetable now={now} />);
  expect(await screen.findByText('資料庫')).toBeTruthy();
  expect(screen.getByText('資工101')).toBeTruthy();
  expect(screen.getByText('上課時段')).toBeTruthy();
  vi.mocked(loadPersonalTimetable).mockResolvedValue(saved('已修改課程'));
  fireEvent.focus(window);
  expect(await screen.findByText('已修改課程')).toBeTruthy();
  expect(screen.queryByText('資料庫')).toBeNull();
});
it('clears old account immediately and ignores its delayed read after switching', async () => {
  let old!: (value: StoredTimetable) => void;
  vi.mocked(loadPersonalTimetable).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        old = resolve;
      }),
  );
  const view = render(<TodayTimetable now={now} />);
  await waitFor(() => expect(loadPersonalTimetable).toHaveBeenCalledTimes(1));
  state.owner = 'platform:bob';
  view.rerender(<TodayTimetable now={now} />);
  await screen.findByRole('link', { name: '匯入我的課表' });
  await act(async () => old(saved('舊帳號私人課程')));
  expect(screen.queryByText('舊帳號私人課程')).toBeNull();
  expect(loadPersonalTimetable).toHaveBeenCalledWith(null, 'ncku', 'platform:bob');
});
it('hides personal data during logout, identity errors and school changes', async () => {
  vi.mocked(loadPersonalTimetable).mockResolvedValue(saved('私人課表'));
  const view = render(<TodayTimetable now={now} />);
  await screen.findByText('私人課表');
  state.pendingLogout = true;
  view.rerender(<TodayTimetable now={now} />);
  expect(screen.queryByText('私人課表')).toBeNull();
  state.pendingLogout = false;
  state.error = 'offline';
  view.rerender(<TodayTimetable now={now} />);
  expect(screen.queryByText('私人課表')).toBeNull();
  state.error = '';
  state.schoolId = 'personal';
  view.rerender(<TodayTimetable now={now} />);
  expect(screen.getByRole('button', { name: '選擇校園' })).toBeTruthy();
  expect(screen.queryByText('私人課表')).toBeNull();
});
it('withdraws the school account timetable while the platform owner stays the same', async () => {
  state.owner = 'platform:alice';
  state.uid = 'school-a';
  vi.mocked(loadPersonalTimetable).mockResolvedValueOnce(saved('學校A的課表'));
  const view = render(<TodayTimetable now={now} />);
  await screen.findByText('學校A的課表');
  let next!: (value: StoredTimetable) => void;
  vi.mocked(loadPersonalTimetable).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        next = resolve;
      }),
  );
  state.uid = 'school-b';
  view.rerender(<TodayTimetable now={now} />);
  expect(screen.queryByText('學校A的課表')).toBeNull();
  await act(async () => next(saved('學校B的課表')));
  expect(screen.getByText('學校B的課表')).toBeTruthy();
});
it('does not call a failed read an empty schedule and recovers via retry', async () => {
  vi.mocked(loadPersonalTimetable).mockRejectedValueOnce(new Error('storage blocked'));
  render(<TodayTimetable now={now} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('這份週課表今天沒有排課。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課表' }));
  expect(await screen.findByRole('link', { name: '匯入我的課表' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('takes the selected term into the full timetable instead of whichever term was imported last', async () => {
  const imported = (academicYear: string): PersonalImportRecord => ({
    id: academicYear, academicYear, semester: '1', kind: 'timetable', schoolId: 'ncku',
    title: `${academicYear}的課程`, dayOfWeek: 1, startPeriod: 2, endPeriod: 3,
    batchId: 'batch', importedAt: now.toISOString(), source: { type: 'paste', line: 1, rawText: '' },
  });
  state.records = [imported('115'), imported('114')];
  render(<TodayTimetable now={now} />);
  await screen.findByText('115的課程');
  expect(screen.getByRole('link', { name: '完整課表' }).getAttribute('href')).toBe('/timetable?campus=ncku&term=115%7C1');
  fireEvent.change(screen.getByRole('combobox', { name: '查看學期' }), { target: { value: '114|1' } });
  expect(screen.getByText('114的課程')).toBeTruthy();
  expect(screen.getByRole('link', { name: '完整課表' }).getAttribute('href')).toBe('/timetable?campus=ncku&term=114%7C1');
});

it('does not present an incomplete combined read as a complete day', async () => {
  state.importError = '匯入紀錄讀取失敗';
  vi.mocked(loadPersonalTimetable).mockResolvedValue(saved('手動課程'));
  render(<TodayTimetable now={now} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('手動課程')).toBeNull();
  expect(screen.queryByText('這份週課表今天沒有排課。')).toBeNull();
});
