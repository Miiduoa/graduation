import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CourseAppealsScreen from '../screens/CourseAppealsScreen';
import {
  createCourseAppeal,
  listCourseAppeals,
  loadAppealTeacherStatus,
  loadPersonalTimetable,
} from '../services/personalTimetable';

const mockUser = { uid: 'stu' };
const mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../services/personalTimetable', () => ({
  appealOfferingId: (course: { name: string; teacher?: string }) =>
    `${course.name}｜${course.teacher}`,
  createCourseAppeal: jest.fn(async () => 'r1'),
  listCourseAppeals: jest.fn(async () => []),
  loadAppealTeacherStatus: jest.fn(async () => ({})),
  loadPersonalTimetable: jest.fn(),
  withdrawCourseAppeal: jest.fn(),
}));

const NO_TEACHER = '這門課還沒對應老師，申訴暫時只有學校看得到。';
const course = {
  id: 'c1',
  name: '資料庫',
  teacher: '王老師',
  day: 1,
  start: 3,
  end: 4,
  room: '主顧303',
  color: 'blue',
};
const pending = {
  id: 'a1',
  schoolId: 'pu',
  studentUid: 'stu',
  courseId: 'c1',
  courseName: '資料庫',
  offeringId: '資料庫｜王老師',
  title: '期中考成績',
  body: '第三題的分數',
  status: 'pending',
  teacherNote: '',
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(loadPersonalTimetable)
    .mockResolvedValue({
      courses: [course],
      meta: {},
      shareWithFriends: false,
      schoolId: 'pu',
    } as never);
});

async function submitOne() {
  fireEvent.press(screen.getByRole('button', { name: '資料庫' }));
  fireEvent.changeText(screen.getByPlaceholderText('主旨'), '出缺席紀錄');
  fireEvent.changeText(screen.getByPlaceholderText('說明（至少八個字）'), '當天有請假單可以補');
  await act(async () => {
    fireEvent.press(screen.getByText('送出'));
  });
}

it('沒有對應老師：頂卡、清單、送出後都說只有學校看得到', async () => {
  jest.mocked(listCourseAppeals).mockResolvedValue([pending] as never);
  jest.mocked(loadAppealTeacherStatus).mockResolvedValue({});
  render(<CourseAppealsScreen />);
  await waitFor(() => expect(screen.getAllByText(NO_TEACHER)).toHaveLength(2));
  expect(screen.queryByText('已送出，等老師看。')).toBeNull();
  await submitOne();
  expect(createCourseAppeal).toHaveBeenCalled();
  await waitFor(() => expect(screen.getAllByText(NO_TEACHER)).toHaveLength(3));
  expect(screen.queryByText(/會通知/)).toBeNull();
});

it('有對應老師：頂卡、清單、送出後都是「已送出，等老師看。」', async () => {
  jest.mocked(listCourseAppeals).mockResolvedValue([pending] as never);
  jest.mocked(loadAppealTeacherStatus).mockResolvedValue({ '資料庫｜王老師': true });
  render(<CourseAppealsScreen />);
  await waitFor(() => expect(screen.getAllByText('已送出，等老師看。')).toHaveLength(2));
  expect(screen.queryByText(NO_TEACHER)).toBeNull();
  await submitOne();
  await waitFor(() => expect(screen.getAllByText('已送出，等老師看。')).toHaveLength(3));
});
