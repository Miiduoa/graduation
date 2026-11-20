import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanCourse, cleanMeta, type PersonalImportRecord } from '@campus/shared';
import { PersonalTimetable } from './PersonalTimetable';
import TimetablePage from '@/app/timetable/page';

const state = vi.hoisted(() => ({
  schoolId: 'pu',
  owner: 'guest',
  records: [] as PersonalImportRecord[],
  loading: false,
  error: '',
  load: vi.fn(),
  academic: null as null | { status: 'loading' | 'ready' | 'error'; reason?: 'unconfigured' },
  user: null as null | { uid: string },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/timetable',
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    loading: false,
    catalogStatus: 'ready',
    selectedSchool: state.schoolId === 'personal' ? null : { id: state.schoolId },
  }),
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: { owner: state.owner, schoolId: state.schoolId },
    scopeKey: `${state.owner}:${state.schoolId}`,
    loading: false,
    schoolName: '測試校園',
  }),
  usePersonalImports: () => ({ records: state.records, loading: state.loading, error: state.error }),
}));
vi.mock('@/lib/timetable/store', () => ({
  TIMETABLE_DEVICE_ONLY_STORED_COPY: '已存在這台裝置',
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY: '存在這台裝置',
  TimetableCloudSaveError: class TimetableCloudSaveError extends Error {},
  loadPersonalTimetable: state.load,
  savePersonalTimetable: vi.fn(async () => ({ stored: 'local' })),
  loadFriendTimetable: vi.fn(async () => null),
  listMyMeetups: vi.fn(async () => []),
  createMeetup: vi.fn(),
  createServerShare: vi.fn(),
  respondMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/friends', () => ({ listAcceptedFriends: vi.fn(async () => []) }));
vi.mock('@/lib/useAcademicRecords', () => ({ useAcademicRecords: () => ({ state: state.academic }) }));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ loading: false, error: false, studentId: false }),
}));

function timetable(empty = false) {
  return {
    courses: empty ? [] : [cleanCourse({ id: 'one', name: '資料庫', day: 1, start: 1, end: 2 })],
    meta: cleanMeta({ year: '115', semester: '1' }),
    schoolId: state.schoolId,
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-01T04:00:00Z'), toFake: ['Date'] });
  vi.clearAllMocks();
  state.schoolId = 'pu';
  state.owner = 'guest';
  state.records = [];
  state.loading = false;
  state.error = '';
  state.academic = null;
  state.user = null;
  state.load.mockReset().mockResolvedValue(timetable());
  window.history.replaceState({}, '', '/timetable?campus=pu');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('puts the weekly courses before optional export and adjustment forms', async () => {
  render(<TimetablePage />);
  const week = await screen.findByRole('region', { name: '一週課程' });
  const exporter = screen.getByLabelText('匯出課表快照');
  expect(week.compareDocumentPosition(exporter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(exporter.querySelector('details')?.open).toBe(false);
  expect(screen.getByText('調課與停課').closest('details')?.open).toBe(false);
  expect(within(week).getByRole('button', { name: /資料庫/ })).toBeTruthy();
  const classroom = screen.getByRole('link', { name: '課程教材與作業' });
  expect(new URL(classroom.getAttribute('href')!, 'https://campus.local').searchParams.get('campus')).toBe('pu');
  expect(week.compareDocumentPosition(classroom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('offers importing as the first clear action when there are no courses', async () => {
  state.load.mockResolvedValue(timetable(true));
  render(<PersonalTimetable />);
  const empty = await screen.findByRole('region', { name: '還沒有課表' });
  expect(within(empty).getByRole('link', { name: '匯入我的課表' }).getAttribute('href')).toBe('/import?kind=timetable&campus=pu');
  expect(within(empty).getByRole('button', { name: '手動新增課程' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: '一週課程' })).toBeNull();
});

it.each([{ loading: true, error: '' }, { loading: false, error: '匯入紀錄讀取失敗' }])(
  'does not call an incomplete timetable empty (%j)', async (read) => {
    state.load.mockResolvedValue(timetable(true));
    Object.assign(state, read);
    render(<PersonalTimetable />);
    await screen.findByRole('button', { name: '新增課程' });
    expect(screen.queryByRole('region', { name: '還沒有課表' })).toBeNull();
    if (read.loading) expect(screen.getByText('正在讀取匯入課表…').getAttribute('role')).toBe('status');
    expect((screen.getByRole('button', { name: '下載課表 ICS' }) as HTMLButtonElement).disabled).toBe(true);
  },
);

it('waits for an in-flight school timetable before showing an empty state', async () => {
  state.load.mockResolvedValue(timetable(true));
  state.user = { uid: 'fixture-user' };
  state.owner = 'school:fixture-user';
  state.academic = { status: 'loading' };
  const view = render(<PersonalTimetable />);
  await screen.findByRole('button', { name: '新增課程' });
  expect(screen.queryByRole('region', { name: '還沒有課表' })).toBeNull();
  expect(screen.getByText('正在讀取學校課表…').getAttribute('role')).toBe('status');
  state.academic = { status: 'error', reason: 'unconfigured' };
  view.rerender(<PersonalTimetable />);
  expect(screen.getByRole('region', { name: '還沒有課表' })).toBeTruthy();
  expect(screen.queryByText('正在讀取學校課表…')).toBeNull();
});

it('keeps manual courses readable while school courses load', async () => {
  state.user = { uid: 'fixture-user' };
  state.academic = { status: 'loading' };
  render(<PersonalTimetable />);
  const week = await screen.findByRole('region', { name: '一週課程' });
  expect(within(week).getByRole('button', { name: /資料庫/ })).toBeTruthy();
  expect(screen.getByText('正在讀取學校課表…')).toBeTruthy();
});

it.each(['nthu', 'personal'])('keeps the course entry available without a supported timetable (%s)', async (schoolId) => {
  state.schoolId = schoolId;
  render(<TimetablePage />);
  if (schoolId === 'nthu') await screen.findByText(/尚未取得這所學校的節次時間/);
  else await screen.findByText(/請先選擇一所學校/);
  const href = screen.getByRole('link', { name: '課程教材與作業' }).getAttribute('href')!;
  const url = new URL(href, 'https://campus.local');
  expect(url.pathname).toBe('/classroom');
  expect(url.searchParams.get('campus')).toBe(schoolId === 'personal' ? 'all' : schoolId);
});

it('keeps the course entry available during and after a failed timetable read', async () => {
  let reject!: (reason: Error) => void;
  state.load.mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
  render(<TimetablePage />);
  expect(screen.getByText('正在讀取你的課表…')).toBeTruthy();
  const entry = screen.getByRole('link', { name: '課程教材與作業' });
  expect(new URL(entry.getAttribute('href')!, 'https://campus.local').searchParams.get('campus')).toBe('pu');
  reject(new Error('fixture-read-failed'));
  await screen.findByRole('region', { name: '課表讀取失敗' });
  expect(screen.getByRole('link', { name: '課程教材與作業' })).toBe(entry);
});

it('closes export and adjustment inputs when the selected semester changes', async () => {
  state.records = ['114', '115'].map((academicYear) => ({
    id: academicYear, kind: 'timetable', title: `課程 ${academicYear}`, schoolId: 'pu',
    academicYear, semester: '1', dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
    source: { type: 'paste', line: 1, rawText: '' }, batchId: 'fixture', importedAt: '',
  }));
  render(<PersonalTimetable />);
  await screen.findByRole('region', { name: '一週課程' });
  const oldExport = screen.getByLabelText('匯出課表快照').querySelector('details')!;
  const oldAdjustment = screen.getByText('調課與停課').closest('details')!;
  fireEvent.click(oldExport.querySelector('summary')!);
  fireEvent.click(oldAdjustment.querySelector('summary')!);
  fireEvent.change(screen.getByLabelText('匯出開始日期'), { target: { value: '2026-12-01' } });
  expect(oldExport.open).toBe(true);
  expect(oldAdjustment.open).toBe(true);
  fireEvent.change(screen.getByLabelText('顯示自行匯入的學期'), { target: { value: '114|1' } });
  expect(screen.getByLabelText('匯出課表快照').querySelector('details')?.open).toBe(false);
  expect(screen.getByText('調課與停課').closest('details')?.open).toBe(false);
  expect((screen.getByLabelText('匯出開始日期') as HTMLInputElement).value).toBe('2026-11-01');
});

it('does not retain the open utility forms after account or campus changes', async () => {
  const view = render(<PersonalTimetable />);
  await screen.findByRole('region', { name: '一週課程' });
  fireEvent.click(screen.getByText('調課與停課'));
  state.owner = 'nuni:another-account';
  state.schoolId = 'ncku';
  state.load.mockResolvedValue(timetable());
  view.rerender(<PersonalTimetable />);
  await screen.findByRole('region', { name: '一週課程' });
  expect(screen.getByText('調課與停課').closest('details')?.open).toBe(false);
  expect(screen.getByLabelText('匯出課表快照').querySelector('details')?.open).toBe(false);
});
