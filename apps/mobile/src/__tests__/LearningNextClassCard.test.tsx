import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LearningNextClassCard, nextLearningClass } from '../components/LearningNextClassCard';
import { useTodayTimetableData } from '../hooks/useTodayTimetableData';
import type { TimetableClassroomDestination } from '../hooks/timetableClassroomNav';
import { TODAY_COPY, type TodayClass } from '@campus/shared/src/pickNextAction';
import { safeNavigate } from '../utils/safeNavigate';

jest.mock('../hooks/useTodayTimetableData', () => ({ useTodayTimetableData: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
const mockNavigation = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));

const openTimetable = jest.fn();
const openImport = jest.fn();
const retry = jest.fn();
const now = Date.parse('2026-10-26T00:00:00.000Z');

type ClassRow = TodayClass & {
  courseCode?: string;
  courseWorkNav?: TimetableClassroomDestination;
};

const upcoming = (
  id: string,
  offsetMinutes: number,
  location = '',
  anchor = Date.now(),
  extras: Partial<ClassRow> & { omitCourseWorkNav?: boolean } = {},
): ClassRow => {
  const { omitCourseWorkNav, ...rest } = extras;
  const title = rest.title ?? '課程 ' + id;
  const courseId = rest.courseId;
  const courseCode = rest.courseCode;
  const courseWorkNav = omitCourseWorkNav
    ? undefined
    : (rest.courseWorkNav ??
      (courseId
        ? { kind: 'linked' as const, screen: 'CourseHub' as const, params: { courseId } }
        : title.trim()
          ? {
              kind: 'search' as const,
              screen: 'Classroom' as const,
              params: {
                q: title,
                from: 'timetable' as const,
                ...(courseCode ? { code: courseCode } : {}),
              },
            }
          : undefined));
  return {
    id,
    title,
    startAt: anchor + offsetMinutes * 60000,
    endAt: anchor + (offsetMinutes + 50) * 60000,
    location,
    courseId,
    courseCode,
    ...(courseWorkNav ? { courseWorkNav } : {}),
    ...rest,
  };
};

function renderCard() {
  return render(
    <LearningNextClassCard onOpenTimetable={openTimetable} onImportTimetable={openImport} />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'ready',
    classes: [upcoming('A', 60, '主顧324')],
    termKey: '115|1',
    retry,
  });
});

test('the next class helper skips ended and malformed classes before sorting by start time', () => {
  const classes = [
    upcoming('late', 120, '', now),
    upcoming('invalid', 15, '', now),
    upcoming('ended', -150, '', now),
    upcoming('early', 35, '', now),
  ];
  classes[1].endAt = Number.NaN;
  expect(nextLearningClass(classes, new Date(now))?.id).toBe('early');
  expect(nextLearningClass(classes, new Date(now + 48 * 60 * 60 * 1000))).toBeNull();
});

test('shows the next verified personal timetable slot, without claiming it came from school LMS', () => {
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'ready',
    classes: [upcoming('B', 100), upcoming('A', 60, '主顧324')],
    termKey: '115|1',
    retry,
  });
  const view = renderCard();
  expect(view.getByText('課程 A')).toBeTruthy();
  expect(view.queryByText('課程 B')).toBeNull();
  expect(view.getByText(/主顧324/)).toBeTruthy();
  expect(view.getByText(/依你自行編輯或匯入的課表顯示/)).toBeTruthy();
  fireEvent.press(view.getByText('開啟我的課表'));
  expect(openTimetable).toHaveBeenCalledTimes(1);
});

test('an import error remains explicit and retryable, rather than falsely reporting an empty day', () => {
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'error', classes: [], termKey: '', retry,
  });
  const view = renderCard();
  expect(view.getByText(/並不代表今天沒有課/)).toBeTruthy();
  fireEvent.press(view.getByText('重新讀取課表'));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('empty personal timetables offer import without pretending to provide an official class', () => {
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'empty', classes: [], termKey: '', retry,
  });
  const view = renderCard();
  fireEvent.press(view.getByText('匯入課表'));
  expect(openImport).toHaveBeenCalledTimes(1);
  expect(view.queryByText(/校方課程已同步/)).toBeNull();
});

test('找這門課 opens Classroom search when the next class has no linkedCourseId', () => {
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'ready',
    classes: [upcoming('A', 60, '主顧324', Date.now(), { courseCode: 'CS301', title: '資料結構' })],
    termKey: '115|1',
    retry,
  });
  const view = renderCard();
  fireEvent.press(view.getByText(TODAY_COPY.findCourse));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'Classroom', {
    q: '資料結構',
    from: 'timetable',
    code: 'CS301',
  });
});

test('作業與教材 opens CourseHub when the next class has linkedCourseId', () => {
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'ready',
    classes: [
      upcoming('A', 60, '主顧324', Date.now(), {
        courseId: 'cw_11111111-1111-4111-8111-111111111111',
        courseCode: 'CS301',
        title: '資料結構',
      }),
    ],
    termKey: '115|1',
    retry,
  });
  const view = renderCard();
  fireEvent.press(view.getByText('作業與教材'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'CourseHub', {
    courseSpaceId: 'cw_11111111-1111-4111-8111-111111111111',
    groupId: 'cw_11111111-1111-4111-8111-111111111111',
    section: 'week',
  });
});

test('blank course name without pre-seeded courseWorkNav resolves to Classroom home', () => {
  jest.mocked(useTodayTimetableData).mockReturnValue({
    status: 'ready',
    classes: [
      upcoming('A', 60, '主顧324', Date.now(), {
        title: '   ',
        omitCourseWorkNav: true,
      }),
    ],
    termKey: '115|1',
    retry,
  });
  const view = renderCard();
  fireEvent.press(view.getByText(TODAY_COPY.findCourse));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'Classroom', {});
});
