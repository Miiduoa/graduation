import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import CourseGradesV2Screen, { loadCourseGrades } from '../screens/lmsV2/CourseGradesV2Screen';

let mockCourseId = 'course-1';
let mockUid = 'student-a';
let mockFailure = false;
let mockRollup: number | null = null;
let mockItems: { id: string; title: string; max_points: number | null; grade_categories: { weight: number }; grade_scores: { score: number | null; updated_at?: string }[] }[] = [{ id: 'grade-item-1', title: '期末報告', max_points: null, grade_categories: { weight: 100 }, grade_scores: [] }];
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockRange = jest.fn();
const mockOrder = jest.fn();
const mockFrom = jest.fn((table: string) => {
  const query = {
    select: (value: string) => {
      mockSelect(table, value);
      return query;
    },
    eq: (field: string, value: string) => {
      mockEq(table, field, value);
      return query;
    },
    order: (field: string) => {
      mockOrder(field);
      return query;
    },
    maybeSingle: async () => ({ data: { weighted_percent: mockRollup }, error: null }),
    range: async (start: number, end: number) => {
      mockRange(start, end);
      return mockFailure
        ? { data: null, error: new Error('讀取失敗') }
        : { data: mockItems.slice(start, end + 1), error: null };
    },
  };
  return query;
});
jest.mock('../services/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
    auth: { getUser: async () => ({ data: { user: { id: mockUid } }, error: null }) },
  }),
}));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../screens/lmsV2/_courseV2Shell', () => ({
  ...jest.requireActual('../screens/lmsV2/_courseV2Shell'),
  useCourseV2Params: () => ({ courseId: mockCourseId, courseName: '資料庫' }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCourseId = 'course-1';
  mockUid = 'student-a';
  mockFailure = false;
  mockRollup = null;
  mockItems = [{ id: 'grade-item-1', title: '期末報告', max_points: null, grade_categories: { weight: 100 }, grade_scores: [] }];
});
test('executes the loader through categories and scopes scores to the current student', async () => {
  const view = render(<CourseGradesV2Screen />);
  await view.findByText('查看原始評分紀錄');
  expect(mockSelect).toHaveBeenCalledWith(
    'grade_items',
    expect.stringContaining('grade_categories!inner(course_id, weight)'),
  );
  expect(mockEq).toHaveBeenCalledWith('grade_items', 'grade_categories.course_id', 'course-1');
  expect(mockEq).not.toHaveBeenCalledWith('grade_items', 'course_id', expect.anything());
  expect(mockEq).toHaveBeenCalledWith('grade_items', 'grade_scores.student_id', 'student-a');
  expect(view.queryByText('0')).toBeNull();
  fireEvent.press(view.getByText('查看原始評分紀錄'));
  expect(view.getByText(/原始評分項目：grade-item-1/)).toBeTruthy();
  expect(view.getByText('分數：未知（待評或尚未取得）')).toBeTruthy();
  fireEvent.press(view.getByText('返回成績'));
  expect(view.queryByText(/原始評分項目：grade-item-1/)).toBeNull();
});
test.each([100, 101, 205])('loads all %s items in stable pages', async (count) => {
  mockItems = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: `項目${i}`,
    max_points: null,
    grade_categories: { weight: 100 },
    grade_scores: [],
  }));
  expect((await loadCourseGrades('course-1')).items).toHaveLength(count);
  expect(mockRange).toHaveBeenCalledWith(100, 199);
  expect(mockOrder).toHaveBeenCalledWith('id');
});
test('query errors render retry and recover without a false empty list', async () => {
  mockFailure = true;
  const view = render(<CourseGradesV2Screen />);
  await view.findByText('讀取失敗');
  expect(view.queryByText('尚無已發布成績')).toBeNull();
  mockFailure = false;
  fireEvent.press(view.getByText('重試'));
  await view.findByText('查看原始評分紀錄');
});
test.each(['course', 'account'])(
  'changing %s clears the open record and old scores even if reload fails',
  async (scope) => {
    const view = render(<CourseGradesV2Screen />);
    fireEvent.press(await view.findByText('查看原始評分紀錄'));
    mockFailure = true;
    if (scope === 'course') mockCourseId = 'course-2';
    else mockUid = 'student-b';
    view.rerender(<CourseGradesV2Screen />);
    await view.findByText('讀取失敗');
    await waitFor(() => expect(view.queryByText(/原始評分項目：grade-item-1/)).toBeNull());
    expect(view.queryByText('期末報告')).toBeNull();
    expect(view.queryByText('學期加權總分')).toBeNull();
  },
);

test('refresh failure hides the previous summary and record; retry displays the new revision in Taipei time', async () => {
  mockItems[0].grade_scores = [{ score: 0, updated_at: '2026-10-31T01:05:00Z' }];
  const view = render(<CourseGradesV2Screen />);
  fireEvent.press(await view.findByText('查看原始評分紀錄'));
  expect(view.getByText('分數：0')).toBeTruthy();
  expect(view.getByText('更新時間：2026/10/31 上午9:05:00')).toBeTruthy();
  const refresh = view.UNSAFE_getByType(RefreshControl).props.onRefresh;
  mockFailure = true;
  await act(async () => { await refresh(); });
  await view.findByText('讀取失敗');
  expect(view.queryByText('學期加權總分')).toBeNull();
  expect(view.queryByText('分數：0')).toBeNull();
  mockFailure = false;
  mockItems[0].grade_scores = [{ score: 80, updated_at: '2026-10-31T02:05:00Z' }];
  fireEvent.press(view.getByText('重試'));
  await view.findByText('分數：80');
  expect(view.queryByText('分數：0')).toBeNull();
});

test('a supplied rollup stays unknown when one score is pending', async () => {
  mockRollup = 50;
  mockItems = [
    { id: 'scored', title: '已評項目', max_points: 100, grade_categories: { weight: 100 }, grade_scores: [{ score: 100 }] },
    { id: 'pending', title: '待評項目', max_points: 100, grade_categories: { weight: 100 }, grade_scores: [] },
  ];
  const view = render(<CourseGradesV2Screen />);
  await view.findByText('待評項目');
  expect(view.getByLabelText('學期加權總分：未知')).toBeTruthy();
  expect(view.queryByLabelText('學期加權總分：50')).toBeNull();
});

test('explicit zero remains a known total when every score is present', async () => {
  mockRollup = 0;
  mockItems[0].grade_scores = [{ score: 0 }];
  const view = render(<CourseGradesV2Screen />);
  expect(await view.findByLabelText('學期加權總分：0')).toBeTruthy();
});


test('零權重練習未評不遮蔽有效總分', async () => {
  mockRollup = 90;
  mockItems = [
    { id: 'final', title: '期末', max_points: 100, grade_categories: { weight: 100 }, grade_scores: [{ score: 90 }] },
    { id: 'practice', title: '練習', max_points: 100, grade_categories: { weight: 0 }, grade_scores: [] },
  ];
  const view = render(<CourseGradesV2Screen />);
  expect(await view.findByLabelText('學期加權總分：90')).toBeTruthy();
  expect(view.getByText('練習')).toBeTruthy();
});

test('沒有正權重類別時不採用總分', async () => {
  mockRollup = 90;
  mockItems[0].grade_categories.weight = 0;
  mockItems[0].grade_scores = [{ score: 90 }];
  const view = render(<CourseGradesV2Screen />);
  expect(await view.findByLabelText('學期加權總分：未知')).toBeTruthy();
});
