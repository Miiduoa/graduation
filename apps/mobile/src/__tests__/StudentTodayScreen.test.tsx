import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { askCampusAssistant } from '../features/campusAssistant';
import StudentTodayScreen from '../screens/StudentTodayScreen';
import { loadStudentHome } from '../data/studentHome';
import type { CourseSpace, InboxTask } from '../data/types';
import {
  formatUpcomingDueLine,
  TODAY_COPY,
  type TodayClass,
} from '@campus/shared/src/pickNextAction';
import { rootNavigateNested } from '../app/rootNavigation';
import { hasTCSession } from '../services/tronClassClient';
import { SENSE_EMPTY_TEXT, SENSE_SECTION_TITLE } from '@campus/shared/src/todaySense';
import { applyTheme, clearSchoolTheme, createDarkTheme } from '../ui/theme';

let mockAuth = {
  user: { uid: 'student-a' } as { uid: string } | null,
  profile: { uid: 'student-a', schoolId: 'school-a', role: 'student' } as { uid: string; schoolId: string; role: string } | null,
};
const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
const mockTimetable = {
  status: 'ready' as 'loading' | 'ready' | 'error' | 'empty',
  classes: [] as TodayClass[],
  termKey: '115-1',
  retry: jest.fn(),
};

jest.mock('../features/campusAssistant', () => ({ askCampusAssistant: jest.fn(), OnDeviceAssistantError: class extends Error {} }));
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../data/studentHome', () => ({ loadStudentHome: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('../services/companionSignalRecorder', () => ({ recordCompanionEvent: jest.fn() }));
jest.mock('../app/useAIOverlay', () => ({ aiOverlay: { open: jest.fn() } }));
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('../services/tronClassClient', () => ({ hasTCSession: jest.fn(async () => true) }));
jest.mock('../hooks/useTodayTimetableData', () => ({
  useTodayTimetableData: () => mockTimetable,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

function result(name = '資料結構'): Awaited<ReturnType<typeof loadStudentHome>> {
  const course: CourseSpace = {
    id: 'course-a',
    groupId: 'course-a',
    name,
    unreadCount: 0,
    assignmentCount: 1,
    dueSoonCount: 1,
    quizCount: 1,
    moduleCount: 0,
    activeSessionId: null,
    latestDueAt: null,
  };
  const task: InboxTask = {
    id: 'assignment-a',
    kind: 'assignment',
    groupId: course.groupId,
    groupName: name,
    title: '繳交期末報告',
    subtitle: '報告尚未繳交',
    assignmentId: 'homework-a',
    priority: 1,
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  };
  return { courses: [course], tasks: [task] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  // Keep todayClass()'s one-hour offset on the same Taipei day, even in late-night CI runs.
  // Freeze Date while preserving async rendering and animation scheduling.
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'hrtime',
    ],
  });
  jest.setSystemTime(new Date('2026-11-03T08:00:00+08:00'));
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'student-a' }, profile: { uid: 'student-a', schoolId: 'school-a', role: 'student' } };
  mockTimetable.status = 'ready';
  mockTimetable.classes = [];
  mockTimetable.termKey = '115-1';
  mockTimetable.retry.mockReset().mockResolvedValue(undefined);
  clearSchoolTheme();
  applyTheme('light');
  jest.mocked(loadStudentHome).mockResolvedValue(result());
  jest.mocked(hasTCSession).mockResolvedValue(true);
});

afterEach(() => {
  act(() => applyTheme('light'));
  jest.useRealTimers();
});

test('opens timetable import from the empty timetable state', async () => {
  mockTimetable.status = 'empty';
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.noTimetable);
  expect(loadStudentHome).toHaveBeenCalledWith('student-a', 'school-a', 'today');
  fireEvent.press(view.getByText(TODAY_COPY.importTimetable));
  expect(rootNavigateNested).toHaveBeenCalledWith('學習', 'PersonalImport', { kind: 'timetable' });
});

test.each(['assignment', 'quiz'] as const)('opens the course from a %s todo row', async (kind) => {
  const data = result();
  data.tasks[0].kind = kind;
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByLabelText('繳交期末報告，資料結構'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
});

test('a todo without a course ID carries the course name to Classroom search', async () => {
  const data = result();
  data.tasks[0].groupId = '  ';
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByLabelText('繳交期末報告，資料結構'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'Classroom', params: { q: '資料結構', from: 'timetable' },
  });
});

test('a failed refresh hides old records and never turns the failure into an empty inbox', async () => {
  const view = render(<StudentTodayScreen />);
  await view.findAllByText('繳交期末報告');
  jest.mocked(loadStudentHome).mockRejectedValueOnce(new Error('permission-denied'));
  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  await view.findByText('無法讀取校務課程。請確認登入狀態與網路連線後重試。');
  expect(view.queryByText('繳交期末報告')).toBeNull();
  expect(view.queryByText(/目前沒有校務待辦/)).toBeNull();
  expect(view.queryByText(SENSE_EMPTY_TEXT)).toBeNull();
  expect(view.queryByText(SENSE_SECTION_TITLE)).toBeNull();
  fireEvent.press(view.getByText(TODAY_COPY.retry));
  await view.findAllByText('繳交期末報告');
});

test.each(['account', 'school'])(
  'changing the %s immediately masks old records and ignores late responses',
  async (change) => {
    const old = deferred<ReturnType<typeof result>>();
    const next = deferred<ReturnType<typeof result>>();
    const view = render(<StudentTodayScreen />);
    await view.findAllByText('繳交期末報告');
    jest.mocked(loadStudentHome).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
    mockAuth =
      change === 'account'
        ? { user: { uid: 'student-b' }, profile: { ...mockAuth.profile!, uid: 'student-b' } }
        : { ...mockAuth, profile: { ...mockAuth.profile!, schoolId: 'school-b' } };
    view.rerender(<StudentTodayScreen />);
    expect(view.queryByText('繳交期末報告')).toBeNull();
    expect(view.getByTestId('today-skeleton')).toBeTruthy();
    await act(async () => old.resolve(result('過期課程')));
    expect(view.queryByText('過期課程')).toBeNull();
    await act(async () => next.resolve({ ...result('新課程'), tasks: [] }));
    expect(view.queryByText('過期課程')).toBeNull();
    expect(view.getByText('今天')).toBeTruthy();
  },
);

test.each(['account', 'school'])('drops assistant replies and in-flight dictation when the %s changes', async change => {
  const ask = jest.mocked(askCampusAssistant);
  const late = deferred<Awaited<ReturnType<typeof askCampusAssistant>>>();
  ask.mockResolvedValueOnce({ content: '上一個身分的課表', source: 'device', hasActions: false });
  ask.mockResolvedValueOnce({ content: '上一個身分的教室', source: 'device', hasActions: false });
  ask.mockReturnValueOnce(late.promise);
  const view = render(<StudentTodayScreen />);
  const input = await view.findByLabelText('說出或輸入想做的事');
  fireEvent.changeText(input, '下一堂是什麼？');
  await act(async () => fireEvent(input, 'submitEditing'));
  expect(view.getByText('上一個身分的課表')).toBeTruthy();
  fireEvent.changeText(input, '在哪裡？');
  await act(async () => fireEvent(input, 'submitEditing'));
  fireEvent.press(view.getByRole('button', { name: '查看前 1 組問答' }));
  expect(view.getByText('上一個身分的課表')).toBeTruthy();
  fireEvent.changeText(input, '幾點結束？');
  fireEvent.press(view.getByLabelText('詢問手機助理'));
  const request = ask.mock.lastCall![0];
  mockAuth = change === 'account'
    ? { user: { uid: 'student-b' }, profile: { ...mockAuth.profile!, uid: 'student-b' } }
    : { ...mockAuth, profile: { ...mockAuth.profile!, schoolId: 'school-b' } };
  view.rerender(<StudentTodayScreen />);
  await view.findByLabelText('說出或輸入想做的事');
  expect(request.signal?.aborted).toBe(true);
  expect(view.queryByText('上一個身分的課表')).toBeNull();
  expect(view.queryByText('上一個身分的教室')).toBeNull();
  expect(view.queryByRole('button', { name: '收合先前問答' })).toBeNull();
  await act(async () => late.resolve({ content: '逾期的回答', source: 'device', hasActions: false }));
  expect(view.queryByText('逾期的回答')).toBeNull();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('a profile from the previous account cannot supply the school for coursework', async () => {
  mockAuth = { ...mockAuth, user: { uid: 'student-b' } };
  jest.mocked(loadStudentHome).mockRejectedValueOnce(new Error('school missing'));
  const view = render(<StudentTodayScreen />);
  await view.findByText('無法讀取校務課程。請確認登入狀態與網路連線後重試。');
  expect(loadStudentHome).toHaveBeenCalledWith('student-b', undefined, 'today');
});

test('shows the unsigned sentence when nobody is signed in', async () => {
  mockAuth = { user: null, profile: null };
  const view = render(<StudentTodayScreen />);
  expect((await view.findAllByText(TODAY_COPY.unsigned)).length).toBeGreaterThan(0);
  expect(loadStudentHome).not.toHaveBeenCalled();
});

test('shows the LMS-unconnected sentence instead of an empty homework list', async () => {
  jest.mocked(hasTCSession).mockResolvedValue(false);
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText(TODAY_COPY.lmsUnconnected)).toBeTruthy();
});

test('keeps other blocks when the timetable cannot be read', async () => {
  mockTimetable.status = 'error';
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.timetableUnavailable);
  fireEvent.press(view.getByText(TODAY_COPY.retry));
  expect(mockTimetable.retry).toHaveBeenCalled();
  expect((await view.findAllByText('繳交期末報告')).length).toBeGreaterThan(0);
});

test('does not keep sense cards or sample recommendations on today', async () => {
  const view = render(<StudentTodayScreen />);
  await view.findAllByText('繳交期末報告');
  expect(view.queryByText(SENSE_SECTION_TITLE)).toBeNull();
  expect(view.queryByText(/為你推薦|智慧|AI 幫你/)).toBeNull();
});

test('shows upcoming work due after 24 hours as the next assignment, not due today', async () => {
  const data = result();
  const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  data.tasks[0].dueAt = dueAt;
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText(TODAY_COPY.nextAssignment)).toBeTruthy();
  expect(
    view.getByText(
      formatUpcomingDueLine({
        id: data.tasks[0].id,
        title: data.tasks[0].title,
        courseName: data.tasks[0].groupName,
        dueAt: dueAt.getTime(),
      }),
    ),
  ).toBeTruthy();
  expect(view.queryByText(TODAY_COPY.dueToday)).toBeNull();
  expect(view.getByText(TODAY_COPY.goSubmit)).toBeTruthy();
});

test('shows the earliest overdue item instead of the empty-day sentence', async () => {
  const data = result();
  data.tasks[0].dueAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText(TODAY_COPY.overdue)).toBeTruthy();
  expect(view.getByText(TODAY_COPY.goSubmit)).toBeTruthy();
  expect(view.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  expect(view.getAllByText(/已逾期/).length).toBeGreaterThan(0);
});

test('reveals the remaining work inline and lets the student collapse the list', async () => {
  const data = result();
  data.tasks = [0, 1, 2, 3].map((index) => ({
    ...data.tasks[0],
    id: `assignment-${index}`,
    assignmentId: `homework-${index}`,
    title: `作業 ${index}`,
  }));
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  const more = await view.findByText(TODAY_COPY.moreTodos(1));
  expect(view.queryByLabelText('作業 3，資料結構')).toBeNull();
  fireEvent.press(more);
  expect(view.getByLabelText('作業 3，資料結構')).toBeTruthy();
  expect(view.getByText('收合待辦')).toBeTruthy();
  expect(rootNavigateNested).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('作業 3，資料結構'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
  fireEvent.press(view.getByText('收合待辦'));
  expect(view.queryByLabelText('作業 3，資料結構')).toBeNull();
  expect(view.getByText(TODAY_COPY.moreTodos(1))).toBeTruthy();
});

test('switching schools hides a previously expanded list', async () => {
  const data = result();
  data.tasks = [0, 1, 2, 3].map((index) => ({
    ...data.tasks[0],
    id: `assignment-${index}`,
    assignmentId: `homework-${index}`,
    title: `作業 ${index}`,
  }));
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByText(TODAY_COPY.moreTodos(1)));
  expect(view.getByLabelText('作業 3，資料結構')).toBeTruthy();
  mockAuth = { ...mockAuth, profile: { ...mockAuth.profile!, schoolId: 'school-b' } };
  view.rerender(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.moreTodos(1));
  expect(view.queryByLabelText('作業 3，資料結構')).toBeNull();
});

test('a malformed deadline stays visible as undated instead of disappearing', async () => {
  const data = result();
  data.tasks[0].dueAt = new Date(Number.NaN);
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect((await view.findAllByText('繳交期末報告')).length).toBeGreaterThan(0);
  expect(view.getAllByText(/未設截止時間/).length).toBeGreaterThan(0);
  fireEvent.press(view.getByLabelText('繳交期末報告，資料結構'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
});

test('an empty loaded task list says so instead of leaving a blank section', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText('已載入的課程目前沒有待處理的作業或測驗。')).toBeTruthy();
});

test('keeps an assignment without a deadline visible and actionable', async () => {
  const data = result();
  data.tasks[0].dueAt = undefined;
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect((await view.findAllByText('繳交期末報告')).length).toBeGreaterThan(0);
  expect(view.getAllByText(/未設截止時間/).length).toBeGreaterThan(0);
  expect(view.queryByText(TODAY_COPY.emptyDay)).toBeNull();
});

test('pull-to-refresh keeps current records visible and stays active until both sources finish', async () => {
  const view = render(<StudentTodayScreen />);
  await view.findAllByText('繳交期末報告');
  const home = deferred<ReturnType<typeof result>>();
  const timetable = deferred<void>();
  jest.mocked(loadStudentHome).mockReturnValueOnce(home.promise);
  mockTimetable.retry.mockReturnValueOnce(timetable.promise);

  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
  expect(view.getAllByText('繳交期末報告').length).toBeGreaterThan(0);
  await act(async () => home.resolve(result()));
  expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
  await act(async () => timetable.resolve());
  expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
});

test('the explicit submit button opens the real assignment', async () => {
  const data = result();
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.nextAssignment);
  const submit = view.getByRole('button', { name: TODAY_COPY.goSubmit });
  expect(view.getByTestId('next-action')).not.toContainElement(submit);
  fireEvent.press(submit);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'HomeworkSubmit',
    params: {
      courseId: 'course-a',
      hwId: 'homework-a',
      hwTitle: '繳交期末報告',
      dueAt: data.tasks[0].dueAt?.toISOString(),
      scrollToSubmit: true,
    },
  });
});

test.each(['error', 'empty'] as const)(
  'an %s timetable never tells the student the day is free',
  async (status) => {
    mockTimetable.status = status;
    jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
    const view = render(<StudentTodayScreen />);
    await view.findByText(
      status === 'error' ? TODAY_COPY.timetableUnavailable : TODAY_COPY.noTimetable,
    );
    expect(view.queryByText(TODAY_COPY.emptyDay)).toBeNull();
  },
);

test('the empty-day card follows OLED mode without leaving light text on a cream surface', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.emptyDay);
  act(() => applyTheme('dark'));
  expect(view.getByTestId('next-action')).toHaveStyle({
    backgroundColor: createDarkTheme().colors.surface2,
  });
  expect(view.getByText(TODAY_COPY.emptyDay)).toHaveStyle({ color: createDarkTheme().colors.text });
});

test('one-tap homework uses the real current inbox task instead of a guessed target', async () => {
  const view = render(<StudentTodayScreen />);
  await view.findAllByText('繳交期末報告');
  fireEvent.press(view.getByLabelText('直接前往交作業'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'HomeworkSubmit',
    params: expect.objectContaining({ courseId: 'course-a', hwId: 'homework-a' }),
  });
});

test('a natural-language location query opens the registered campus map without any write', async () => {
  const view = render(<StudentTodayScreen />);
  fireEvent.changeText(await view.findByLabelText('說出或輸入想做的事'), '圖書館怎麼走');
  fireEvent.press(view.getByLabelText('前往校園地圖'));
  expect(mockNavigate).toHaveBeenCalledWith('校園', {
    screen: 'MapV2',
    params: undefined,
  });
});

function todayClass(
  overrides: {
    id?: string;
    title?: string;
    location?: string;
    startAt?: number;
    endAt?: number;
    courseId?: string;
    courseCode?: string;
    courseWorkNav?: import('../hooks/timetableClassroomNav').TimetableClassroomDestination | false;
  } = {},
) {
  const startAt = overrides.startAt ?? Date.now() + 60 * 60 * 1000;
  const endAt = overrides.endAt ?? startAt + 50 * 60 * 1000;
  const title = overrides.title ?? '資料結構';
  const courseId = overrides.courseId;
  const courseCode = overrides.courseCode;
  const courseWorkNav =
    overrides.courseWorkNav === false
      ? undefined
      : (overrides.courseWorkNav ??
        (courseId
          ? { kind: 'linked' as const, screen: 'CourseHub' as const, params: { courseId } }
          : title.trim()
            ? {
                kind: 'search' as const,
                screen: 'Classroom' as const,
                params: {
                  q: title.trim(),
                  from: 'timetable' as const,
                  ...(courseCode ? { code: courseCode } : {}),
                },
              }
            : undefined));
  return {
    id: overrides.id ?? 'class-a',
    title,
    location: overrides.location ?? '主顧 303',
    startAt,
    endAt,
    courseId,
    courseCode,
    ...(courseWorkNav ? { courseWorkNav } : {}),
  };
}

test('today class without linkedCourseId opens Classroom with timetable search params', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  mockTimetable.classes = [todayClass({ courseCode: 'CS301' })];
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.findCourse);
  fireEvent.press(view.getByTestId('next-action'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'Classroom',
    params: { q: '資料結構', from: 'timetable', code: 'CS301' },
  });
});

test('today class with linkedCourseId still opens CourseHub', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  mockTimetable.classes = [
    todayClass({
      courseId: 'cw_11111111-1111-4111-8111-111111111111',
      courseCode: 'CS301',
    }),
  ];
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.viewCourse);
  fireEvent.press(view.getByTestId('next-action'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: {
      courseSpaceId: 'cw_11111111-1111-4111-8111-111111111111',
      groupId: 'cw_11111111-1111-4111-8111-111111111111',
      section: 'week',
    },
  });
});

test('today class with blank course name resolves via courseWorkNavForClass to Classroom home', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  mockTimetable.classes = [
    todayClass({
      title: '   ',
      location: '',
      courseWorkNav: false,
    }),
  ];
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByText('教室未填'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'Classroom',
    params: {},
  });
});

test('today class list press without linkedCourseId opens Classroom search', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  mockTimetable.classes = [todayClass({ courseCode: 'CS301', title: '資料結構' })];
  const view = render(<StudentTodayScreen />);
  // Location text only appears on the class list row (not NextAction meta).
  fireEvent.press(await view.findByText('主顧 303'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'Classroom',
    params: { q: '資料結構', from: 'timetable', code: 'CS301' },
  });
});

test('today class list press with linkedCourseId opens CourseHub', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  mockTimetable.classes = [
    todayClass({
      title: '資料結構',
      courseId: 'cw_11111111-1111-4111-8111-111111111111',
      courseCode: 'CS301',
    }),
  ];
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByText('主顧 303'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: {
      courseSpaceId: 'cw_11111111-1111-4111-8111-111111111111',
      groupId: 'cw_11111111-1111-4111-8111-111111111111',
      section: 'week',
    },
  });
});

test.each([-48, 3, 72])('the work card opens its course for a deadline offset of %s hours', async (hours) => {
  const data = result();
  data.tasks[0].dueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  await view.findAllByText('繳交期末報告');
  fireEvent.press(view.getByTestId('next-action'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'CourseHub',
    params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
});

test('after classes end, the card opens the course and its button still submits the assignment', async () => {
  const data = result();
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  mockTimetable.classes = [todayClass({
    startAt: Date.now() - 2 * 60 * 60 * 1000,
    endAt: Date.now() - 60 * 60 * 1000,
  })];
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.allClassesDone);
  fireEvent.press(view.getByTestId('next-action'));
  expect(mockNavigate).toHaveBeenLastCalledWith('學習', {
    screen: 'CourseHub',
    params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
  const submit = view.getByRole('button', { name: TODAY_COPY.goSubmit });
  expect(view.getByTestId('next-action')).not.toContainElement(submit);
  fireEvent.press(submit);
  expect(mockNavigate).toHaveBeenCalledTimes(2);
  expect(mockNavigate).toHaveBeenLastCalledWith('學習', {
    screen: 'HomeworkSubmit',
    params: expect.objectContaining({ courseId: 'course-a', hwId: 'homework-a', scrollToSubmit: true }),
  });
});

test.each([
  { hours: 2, afterClass: false, heading: TODAY_COPY.dueToday },
  { hours: 72, afterClass: false, heading: '下一個測驗' },
  { hours: 72, afterClass: true, heading: TODAY_COPY.allClassesDone },
])('the $heading card opens the exact quiz in one tap or lets the student visit the course', async ({ hours, afterClass, heading }) => {
  const data = result();
  const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  data.tasks.push({
    ...data.tasks[0], id: 'quiz-b', kind: 'quiz', title: '排序測驗', assignmentId: 'quiz-42', dueAt,
  });
  data.tasks[0].dueAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  if (afterClass) {
    mockTimetable.classes = [todayClass({ startAt: Date.now() - 7200000, endAt: Date.now() - 3600000 })];
  }
  const view = render(<StudentTodayScreen />);
  await view.findByText(heading);
  const quiz = view.getByRole('button', { name: '去作答' });
  const course = view.getByRole('button', { name: /排序測驗.*看課程/ });
  expect(course).not.toContainElement(quiz);
  fireEvent.press(quiz);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'QuizTaking',
    params: { groupId: 'course-a', groupName: '資料結構', quizId: 'quiz-42', dueAt: dueAt.toISOString() },
  });
  fireEvent.press(course);
  expect(mockNavigate).toHaveBeenCalledTimes(2);
  expect(mockNavigate).toHaveBeenLastCalledWith('學習', {
    screen: 'CourseHub', params: { courseSpaceId: 'course-a', groupId: 'course-a', section: 'week' },
  });
});

test('a quiz due just after Taipei midnight says tomorrow when it is still the previous evening', async () => {
  jest.setSystemTime(new Date('2026-11-03T23:55:00+08:00'));
  const data = result();
  data.tasks[0] = {
    ...data.tasks[0], kind: 'quiz', assignmentId: 'quiz-42', title: '排序測驗',
    dueAt: new Date('2026-11-04T00:05:00+08:00'),
  };
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText('明天截止')).toBeVisible();
  expect(view.queryByText(TODAY_COPY.dueToday)).toBeNull();
  expect(view.getByRole('button', { name: '去作答' })).toBeVisible();
});

test('a class starting soon keeps the urgent quiz visible in the collapsed list above 13 late assignments', async () => {
  const data = result();
  const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  data.tasks = [
    { ...data.tasks[0], id: 'quiz-urgent', kind: 'quiz', title: '期中考', assignmentId: 'quiz-42', dueAt },
    ...Array.from({ length: 13 }, (_, i) => ({
      ...data.tasks[0], id: `late-${i}`, title: `補交 ${i}`, assignmentId: `old-${i}`,
      dueAt: new Date(Date.now() - (13 - i) * 60 * 60 * 1000), lateSubmissionAllowed: true,
    })),
  ];
  mockTimetable.classes = [todayClass({ startAt: Date.now() + 15 * 60 * 1000 })];
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.nextClass);
  expect(view.getByRole('button', { name: '期中考，資料結構' })).toBeVisible();
  const headings = view.getAllByRole('header').map(node => node.props.children);
  expect(headings.indexOf('待處理')).toBeLessThan(headings.indexOf('今天課表'));
  fireEvent.press(view.getByRole('button', { name: '去作答，期中考' }));
  expect(mockNavigate).toHaveBeenCalledWith('學習', { screen: 'QuizTaking',
    params: { groupId: 'course-a', groupName: '資料結構', quizId: 'quiz-42', dueAt: dueAt.toISOString() } });
  expect(view.getByText(TODAY_COPY.moreTodos(11))).toBeVisible();
  expect(view.queryByLabelText('補交 2，資料結構')).toBeNull();
});

test('distinguishes a class in progress and shows the timetable before non-urgent work', async () => {
  mockTimetable.classes = [todayClass({ startAt: Date.parse('2026-11-03T07:50:00+08:00'),
    endAt: Date.parse('2026-11-03T08:40:00+08:00') })];
  const view = render(<StudentTodayScreen />);
  expect(await view.findByText('上課中')).toBeVisible();
  expect(view.queryByText(TODAY_COPY.nextClass)).toBeNull();
  expect(view.getByText('07:50–08:40 · 主顧 303')).toBeVisible();
  const headings = view.getAllByRole('header').map(node => node.props.children);
  expect(headings.indexOf('今天課表')).toBeLessThan(headings.indexOf('待處理'));
});
