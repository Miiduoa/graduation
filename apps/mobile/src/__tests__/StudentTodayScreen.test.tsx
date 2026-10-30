import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
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
  profile: { schoolId: 'school-a', role: 'student' } as { schoolId: string; role: string } | null,
};
const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
const mockTimetable = {
  status: 'ready' as 'loading' | 'ready' | 'error' | 'empty',
  classes: [] as TodayClass[],
  termKey: '115-1',
  retry: jest.fn(),
};

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
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'student-a' }, profile: { schoolId: 'school-a', role: 'student' } };
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
});

test('opens timetable import from the empty timetable state', async () => {
  mockTimetable.status = 'empty';
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.noTimetable);
  fireEvent.press(view.getByText(TODAY_COPY.importTimetable));
  expect(rootNavigateNested).toHaveBeenCalledWith('學習', 'PersonalImport', { kind: 'timetable' });
});

test('opens the assignment submit screen from a todo row', async () => {
  const data = result();
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByLabelText('繳交期末報告，資料結構'));
  expect(mockNavigate).toHaveBeenCalledWith('學習', {
    screen: 'HomeworkSubmit',
    params: {
      courseId: 'course-a',
      hwId: 'homework-a',
      hwTitle: '繳交期末報告',
      dueAt: data.tasks[0].dueAt?.toISOString(),
    },
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
        ? { ...mockAuth, user: { uid: 'student-b' } }
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
    screen: 'HomeworkSubmit',
    params: expect.objectContaining({ courseId: 'course-a', hwId: 'homework-3' }),
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
    screen: 'HomeworkSubmit',
    params: { courseId: 'course-a', hwId: 'homework-a', hwTitle: '繳交期末報告' },
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

test('the entire next-assignment card opens that assignment directly', async () => {
  const data = result();
  jest.mocked(loadStudentHome).mockResolvedValue(data);
  const view = render(<StudentTodayScreen />);
  await view.findByText(TODAY_COPY.nextAssignment);
  fireEvent.press(view.getByTestId('next-action'));
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


test('the general homework shortcut opens the courses tab when no specific task is available', async () => {
  jest.mocked(loadStudentHome).mockResolvedValue({ courses: [], tasks: [] });
  const view = render(<StudentTodayScreen />);
  fireEvent.press(await view.findByLabelText('直接前往交作業'));
  expect(mockNavigate).toHaveBeenCalledWith('我的', {
    screen: 'NuniWorkspace', params: { tab: 'courses' },
  });
});
