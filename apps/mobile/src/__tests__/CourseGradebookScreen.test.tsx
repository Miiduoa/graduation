import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CourseGradebookScreen } from '../screens/CourseGradebookScreen';
import { ASSIGNMENT_FOCUS_MISSING } from '../screens/assignmentDeepLink';

jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: 'student-a' }, profile: { schoolId: 'pu', role: 'student' } }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => mockDataSource }));
jest.mock('../data/courseSpaceSource', () => ({
  listCourseSpaces: jest.fn(),
  getCourseGradebook: jest.fn(),
}));
jest.mock('../services/courseWorkspace', () => ({
  canManageCourse: () => false,
  formatDateTime: (_value: unknown, fallback: string) => fallback,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockDataSource: {
  getAssignment?: jest.Mock;
} = {};
let mockPublished = false;
let mockReadError: string | null = null;
let mockGradebookLoading = false;
let mockAssignments: Array<{
  id: string;
  title: string;
  weight: number;
  dueAt: null;
  gradesPublished: boolean;
  averageScore: null;
}> = [
  {
    id: 'work-1',
    title: '期末作業',
    weight: 100,
    dueAt: null,
    gradesPublished: false,
    averageScore: null,
  },
];
let mockBreakdown: Array<{
  assignmentId: string;
  title: string;
  weight: number;
  grade: number | null;
  submittedAt: Date | null;
  feedback: string | null;
}> = [
  {
    assignmentId: 'work-1',
    title: '期末作業',
    weight: 100,
    grade: null,
    submittedAt: new Date(),
    feedback: null,
  },
];
const mockReload = jest.fn();

jest.mock('../hooks/useAsyncList', () => ({
  useAsyncList: (_load: unknown, deps: unknown[]) => {
    if (deps.includes('assignment-focus-probe')) {
      return { loading: false, error: null, reload: mockReload, items: [] };
    }
    if (deps.length === 5) {
      return {
        loading: false,
        error: null,
        reload: mockReload,
        items: [{ groupId: 'course-1', name: '資料庫', role: 'member' }],
      };
    }
    return {
      loading: mockGradebookLoading,
      error: mockReadError,
      reload: mockReload,
      items: mockGradebookLoading
        ? []
        : [
            {
              assignments: mockAssignments,
              finalScoresPublished: mockPublished,
              finalScoresPublishedAt: null,
              rows: [
                {
                  uid: 'student-a',
                  published: mockPublished,
                  finalScore: mockPublished ? 80 : 0,
                  result: mockPublished ? 'passed' : 'failed',
                  gradedAssignments: mockPublished ? 1 : 0,
                  totalAssignments: 2,
                  assignmentBreakdown: mockBreakdown,
                },
              ],
            },
          ],
    };
  },
}));

beforeEach(() => {
  mockPublished = false;
  mockReadError = null;
  mockGradebookLoading = false;
  mockAssignments = [
    {
      id: 'work-1',
      title: '期末作業',
      weight: 100,
      dueAt: null,
      gradesPublished: false,
      averageScore: null,
    },
  ];
  mockBreakdown = [
    {
      assignmentId: 'work-1',
      title: '期末作業',
      weight: 100,
      grade: null,
      submittedAt: new Date(),
      feedback: null,
    },
  ];
  delete mockDataSource.getAssignment;
  mockReload.mockClear();
});

test('pending work stays unknown even when a stored total is zero and opens the exact assignment', () => {
  const navigate = jest.fn();
  const view = render(
    <CourseGradebookScreen navigation={{ navigate }} route={{ params: { groupId: 'course-1' } }} />,
  );
  expect(view.getByText(/來源：nuni 課程/)).toBeTruthy();
  expect(view.getByText('總分 未知（仍有待評項目）')).toBeTruthy();
  expect(view.getByText('待評 · 尚無分數')).toBeTruthy();
  expect(view.queryByText('總分 0')).toBeNull();
  fireEvent.press(view.getByText('查看原始作業／測驗紀錄'));
  expect(navigate).toHaveBeenCalledWith('HomeworkSubmit', {
    courseId: 'course-1',
    hwId: 'work-1',
    hwTitle: '期末作業',
  });
});

test('published final scores remain visible while individual work is pending', () => {
  mockPublished = true;
  const view = render(<CourseGradebookScreen route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText('總分 80')).toBeTruthy();
  expect(view.getByText('通過')).toBeTruthy();
  expect(view.queryByText(/班平均/)).toBeNull();
  expect(view.getByText('評分進度 1/2')).toBeTruthy();
});

test('failed gradebook reads show retry without scores, progress, or missing submissions', () => {
  mockReadError = '讀取失敗';
  const view = render(<CourseGradebookScreen route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText('讀取成績簿失敗')).toBeTruthy();
  expect(view.queryByText(/評分進度 0/)).toBeNull();
  expect(view.queryByText(/缺件/)).toBeNull();
  expect(view.queryByText(/班平均/)).toBeNull();
  fireEvent.press(view.getByText('重試'));
  expect(mockReload).toHaveBeenCalled();
  mockReadError = null;
  view.rerender(<CourseGradebookScreen route={{ params: { groupId: 'course-1' } }} />);
  expect(view.getByText('總分 未知（仍有待評項目）')).toBeTruthy();
});

test('帶 assignmentId 時標示該作業，且成績簿載入前不誤報找不到', () => {
  mockGradebookLoading = true;
  const loading = render(
    <CourseGradebookScreen route={{ params: { groupId: 'course-1', assignmentId: 'work-1' } }} />,
  );
  expect(loading.getByText('整理課程成績中...')).toBeTruthy();
  expect(loading.queryByText(ASSIGNMENT_FOCUS_MISSING)).toBeNull();

  mockGradebookLoading = false;
  const view = render(
    <CourseGradebookScreen route={{ params: { groupId: 'course-1', assignmentId: 'work-1' } }} />,
  );
  expect(view.queryByText(ASSIGNMENT_FOCUS_MISSING)).toBeNull();
  expect(view.getAllByLabelText('期末作業（通知定位）').length).toBeGreaterThan(0);
});

test('成績簿清單為空時不因 assignmentId 誤報找不到', () => {
  mockAssignments = [];
  mockBreakdown = [];
  const view = render(
    <CourseGradebookScreen route={{ params: { groupId: 'course-1', assignmentId: 'hw-one' } }} />,
  );
  expect(view.queryByText(ASSIGNMENT_FOCUS_MISSING)).toBeNull();
  expect(view.getByText(/還沒有可計算的評分項目/)).toBeTruthy();
});

test('成績簿已載入且確定沒有該作業時才提示找不到', () => {
  const view = render(
    <CourseGradebookScreen
      route={{ params: { groupId: 'course-1', assignmentId: 'missing-work' } }}
    />,
  );
  expect(view.getByText(ASSIGNMENT_FOCUS_MISSING)).toBeTruthy();
  expect(view.getAllByText('期末作業').length).toBeGreaterThan(0);
});
