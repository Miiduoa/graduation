import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import type { TodayClass } from '@campus/shared/src/pickNextAction';
import { TODAY_FLOW_CLASS_TITLE } from '@/lib/todayCourseWork';
import { TeacherToday, TeacherTodayPage, isTeachingCourse } from './TeacherToday';

const state = vi.hoisted(() => ({
  scope: {
    loading: false,
    scope: { owner: 'platform:teacher', schoolId: 'ntu' },
  },
  records: {
    schoolId: 'ntu',
    scopeKey: 'platform:teacher:ntu',
    loaded: true,
    error: '',
    imported: { records: [] as PersonalImportRecord[] },
    manual: [] as PersonalImportRecord[] | null,
    retry: vi.fn(),
  },
}));

vi.mock('@/lib/usePersonalImports', () => ({ usePersonalImportScope: () => state.scope }));
vi.mock('@/lib/usePersonalTodayRecords', () => ({ usePersonalTodayRecords: () => state.records }));

const now = new Date('2026-11-02T09:50:00+08:00');
const klass: TodayClass = {
  id: 'class-1',
  title: '教學實習',
  location: '教育館 101',
  startAt: Date.parse('2026-11-02T10:10:00+08:00'),
  endAt: Date.parse('2026-11-02T12:00:00+08:00'),
  courseId: 'teach-1',
};
const course = { id: 'teach-1', name: '教學實習', role: 'owner-teacher', unreadCount: 0 };

const importedClass: PersonalImportRecord = {
  id: 'imported-class',
  kind: 'timetable',
  title: '已匯入授課',
  schoolId: 'ntu',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startTime: '10:10',
  endTime: '12:00',
  location: '教育館 101',
  batchId: 'batch-a',
  importedAt: now.toISOString(),
  source: { type: 'paste', line: 1, rawText: '' },
};

function today(overrides: Partial<ComponentProps<typeof TeacherToday>> = {}) {
  return (
    <TeacherToday
      now={now}
      unsigned={false}
      classes={[]}
      timetableStatus="ready"
      timetableSchoolId="ntu"
      onRetryTimetable={vi.fn()}
      teachingCourses={[course]}
      coursesLoading={false}
      coursesError=""
      onRetryCourses={vi.fn()}
      timetableHref="/timetable?campus=ntu"
      importHref="/import?kind=timetable&campus=ntu"
      {...overrides}
    />
  );
}

function boundToday() {
  return (
    <TeacherTodayPage
      now={now}
      unsigned={false}
      teachingCourses={[course]}
      coursesLoading={false}
      coursesError=""
      onRetryCourses={vi.fn()}
    />
  );
}

beforeEach(() => {
  state.scope = { loading: false, scope: { owner: 'platform:teacher', schoolId: 'ntu' } };
  state.records = {
    schoolId: 'ntu',
    scopeKey: 'platform:teacher:ntu',
    loaded: true,
    error: '',
    imported: { records: [] },
    manual: [],
    retry: vi.fn(),
  };
});

it('recognizes confirmed teaching roles and does not present a student membership as teaching', () => {
  expect(isTeachingCourse(course)).toBe(true);
  expect(isTeachingCourse({ role: 'student' })).toBe(false);
  render(
    today({
      teachingCourses: [
        course,
        { ...course, id: 'student-course', name: '修習課程', role: 'student' },
      ],
    }),
  );
  expect(screen.getByRole('link', { name: /教學實習/ })).toBeTruthy();
  expect(screen.queryByText('修習課程')).toBeNull();
});

it('offers actual course workspaces without inventing grading or deadline summaries', () => {
  render(today({ classes: [klass] }));
  expect(screen.getByRole('heading', { name: TODAY_FLOW_CLASS_TITLE })).toBeTruthy();
  const work = screen.getByRole('region', { name: '授課課程' });
  expect(
    within(work)
      .getByRole('link', { name: /教學實習/ })
      .getAttribute('href'),
  ).toBe('/teacher/course/teach-1');
  expect(screen.queryByText('目前沒有即將到期的學生作業。')).toBeNull();
  expect(screen.queryByText(/目前沒有待批改項目/)).toBeNull();
  expect(screen.queryByRole('heading', { name: '即將到期作業' })).toBeNull();
});

it('opens the teacher workspace with the existing school query and keeps nuni course links', () => {
  render(
    today({
      teachingCourses: [
        {
          id: 'course a',
          name: '資料結構',
          role: 'instructor',
          unreadCount: 0,
          href: '/course/course%20a?schoolId=pu',
        },
        {
          id: 'cw-school',
          name: 'nuni 課程',
          role: 'co-teacher',
          unreadCount: 0,
          href: '/classroom/course/cw-school?school=pu',
        },
      ],
    }),
  );
  expect(screen.getByRole('link', { name: /資料結構.*開啟課程工作台/ }).getAttribute('href')).toBe(
    '/teacher/course/course%20a?schoolId=pu',
  );
  expect(screen.getByRole('link', { name: /nuni 課程/ }).getAttribute('href')).toBe(
    '/classroom/course/cw-school?school=pu',
  );
});

it.each([
  ['loading', '正在確認今天的課表…'],
  ['unsigned-scope', '先選擇校園'],
  ['empty', '還沒有課表'],
] as const)('does not claim there are no classes while the timetable is %s', (status, message) => {
  render(today({ timetableStatus: status, classes: [klass] }));
  const timetable = screen.getByRole('region', { name: TODAY_FLOW_CLASS_TITLE });
  expect(within(timetable).getByText(new RegExp(message))).toBeTruthy();
  expect(within(timetable).queryByText(/今天沒有排課/)).toBeNull();
  expect(within(timetable).queryByRole('link', { name: /教學實習/ })).toBeNull();
});

it('shows a confirmed free day only after the timetable is ready', () => {
  render(today({ timetableStatus: 'ready', classes: [] }));
  expect(screen.getByText(/今天沒有排課/)).toBeTruthy();
  expect(screen.queryByText('正在確認今天的課表…')).toBeNull();
});

it('retries timetable failure separately from course failure and retains available workspaces', () => {
  const retryTimetable = vi.fn();
  const retryCourses = vi.fn();
  render(
    today({
      timetableStatus: 'error',
      coursesError: '部分課程資料尚未讀到，請重試。',
      onRetryTimetable: retryTimetable,
      onRetryCourses: retryCourses,
    }),
  );
  expect(screen.getByRole('link', { name: /教學實習/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課表' }));
  expect(retryTimetable).toHaveBeenCalledTimes(1);
  expect(retryCourses).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取授課課程' }));
  expect(retryCourses).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/目前沒有已確認的授課課程/)).toBeNull();
});

it('separates pending and failed course reads from confirmed empty membership', () => {
  const view = render(today({ teachingCourses: [], coursesLoading: true }));
  expect(screen.getByText('正在確認授課課程…')).toBeTruthy();
  expect(screen.queryByText(/目前沒有已確認的授課課程/)).toBeNull();
  view.rerender(today({ teachingCourses: [], coursesError: '授課資料暫時讀不到。' }));
  expect(screen.getByRole('alert').textContent).toBe('授課資料暫時讀不到。');
  expect(screen.queryByText(/目前沒有已確認的授課課程/)).toBeNull();
  view.rerender(today({ teachingCourses: [] }));
  expect(screen.getByText(/目前沒有已確認的授課課程/)).toBeTruthy();
  expect(screen.queryByText(/目前沒有待批改項目/)).toBeNull();
});

it('keeps retries disabled while the course sources are already loading', () => {
  render(today({ coursesLoading: true, coursesError: '部分課程還沒讀到。' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新讀取中…' }).disabled).toBe(
    true,
  );
});

it('hides private work and schedule when the account is not signed in', () => {
  render(today({ unsigned: true, classes: [klass], assistant: <button>開啟助理</button> }));
  expect(screen.getByText('登入後，接續你的課表與已獲授權的授課課程。')).toBeTruthy();
  expect(screen.queryByText('教學實習')).toBeNull();
  expect(screen.getByRole('button', { name: '開啟助理' })).toBeTruthy();
});

it('maps real loading, failure, missing timetable and unselected campus into distinct recovery states', () => {
  state.records.loaded = false;
  const view = render(boundToday());
  expect(screen.getByText('正在確認今天的課表…')).toBeTruthy();

  state.records.loaded = true;
  state.records.error = 'storage unavailable';
  view.rerender(boundToday());
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課表' }));
  expect(state.records.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/今天沒有排課/)).toBeNull();

  state.records.error = '';
  view.rerender(boundToday());
  expect(screen.getByRole('link', { name: '匯入我的課表' }).getAttribute('href')).toBe(
    '/import?kind=timetable&campus=ntu',
  );

  state.scope.scope.schoolId = 'personal';
  state.records.schoolId = 'personal';
  view.rerender(boundToday());
  expect(screen.getByRole('link', { name: '選校園、整理課表' }).getAttribute('href')).toBe(
    '/timetable?campus=all',
  );
});

it('shows imported classes and retries when the manual timetable fails', () => {
  state.records.imported.records = [importedClass];
  state.records.manual = null;
  state.records.error = '手動課表暫時讀不到。';

  render(boundToday());

  const timetable = within(screen.getByRole('region', { name: TODAY_FLOW_CLASS_TITLE }));
  expect(timetable.getByText('已匯入授課')).toBeTruthy();
  expect(timetable.getByRole('alert').textContent).toBe('暫時讀不到課表');
  expect(timetable.queryByText(/今天沒有排課/)).toBeNull();
  fireEvent.click(timetable.getByRole('button', { name: '重新讀取課表' }));
  expect(state.records.retry).toHaveBeenCalledTimes(1);
});

it('keeps classroom navigation scoped to the actual timetable and hides it during a campus change', () => {
  state.records.imported.records = [importedClass];
  const view = render(boundToday());
  const destination = new URL(
    screen.getByRole('link', { name: '找教室：教育館 101' }).getAttribute('href')!,
    'https://fixture.invalid',
  );
  expect(destination.pathname).toBe('/map');
  expect(destination.searchParams.get('schoolId')).toBe('ntu');
  expect(destination.searchParams.get('query')).toBe('教育館 101');

  state.scope.loading = true;
  state.scope.scope.schoolId = 'ncku';
  view.rerender(boundToday());
  expect(screen.getByText('正在確認今天的課表…')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /^找教室/ })).toBeNull();
  expect(screen.queryByText('已匯入授課')).toBeNull();
});
