import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import CourseHub from '../screens/CourseHubAiFirstScreen';
import { loadCourseHub, type CourseHubData } from '../features/courseHub';
import { safeNavigate } from '../utils/safeNavigate';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import { revealAssignmentSubmitArea } from '../screens/nuni/scrollAssignment';
let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/courseHub', () => ({ loadCourseHub: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({
  webBrowserOpenWithPuTronClassGate: jest.fn(),
}));
jest.mock('../screens/nuni/scrollAssignment', () => ({
  revealAssignmentSubmitArea: jest.fn(),
}));
const data: CourseHubData = {
  name: '資訊倫理',
  description: '課程說明',
  details: [],
  materials: { status: 'ready', items: [] },
  assignments: { status: 'ready', items: [] },
};
const route = { params: { groupId: 'course-a', groupName: '過時的課名' } };
/** UI shows pending work only through this Taiwan calendar week.
 * Derive the fixture from the test day instead of letting a fixed 2026 deadline expire.
 */
function thisWeekDeadline(): string {
  const taipei = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const weekday = taipei.getUTCDay() || 7;
  const sunday = Date.UTC(
    taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate() + 7 - weekday,
    23, 59, 59,
  ) - 8 * 60 * 60 * 1000;
  return new Date(sunday).toISOString();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'alice' };
  mockSchool = { id: 'pu' };
  jest.mocked(loadCourseHub).mockResolvedValue(data);
  jest.mocked(webBrowserOpenWithPuTronClassGate).mockResolvedValue(true);
});
test('uses real course name with scoped useful actions and no invented outcomes', async () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<CourseHub route={route} navigation={navigation} />);
  await view.findByText('資訊倫理');
  expect(
    view.queryByText(/過時的課名|CS302|13\/15|6\/7|88|A-|摘要已開啟|繳交作業|開始測驗/),
  ).toBeNull();
  expect(view.getByText('尚未發布作業。')).toBeTruthy();
  fireEvent.press(view.getByText('測驗通知'));
  expect(safeNavigate).toHaveBeenLastCalledWith(navigation, 'QuizCenter', {
    groupId: 'course-a',
    groupName: '資訊倫理',
  });
  fireEvent.press(view.getByText('課程群組與公告'));
  expect(safeNavigate).toHaveBeenLastCalledWith(navigation, 'GroupDetail', {
    groupId: 'course-a',
    groupName: '資訊倫理',
  });
});
test('unidentified courses and signed-out accounts never acquire default course content', () => {
  const view = render(<CourseHub route={{ params: { courseId: 'CS302' } }} />);
  expect(view.getByText('請先選擇課程')).toBeTruthy();
  expect(loadCourseHub).not.toHaveBeenCalled();
  mockUser = null;
  view.rerender(<CourseHub route={route} />);
  expect(view.getByText('登入後查看課程')).toBeTruthy();
  expect(loadCourseHub).not.toHaveBeenCalled();
});
test('read failures offer retry and are not described as empty coursework', async () => {
  jest.mocked(loadCourseHub).mockRejectedValueOnce(new Error('無法連線'));
  const view = render(<CourseHub route={route} />);
  await view.findByText('目前無法讀取課程');
  expect(view.queryByText('尚未發布作業。')).toBeNull();
  fireEvent.press(view.getByText('重新讀取課程'));
  await view.findByText('資訊倫理');
});
test('partial read failures stay distinct and published files open in the existing viewer', async () => {
  const navigation = { navigate: jest.fn() };
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: { status: 'error', items: [] },
    materials: {
      status: 'ready',
      items: [
        {
          id: 'm1',
          title: '課堂閱讀',
          description: '',
          url: 'https://school.test/reading',
          order: 1,
        },
      ],
    },
  });
  const view = render(<CourseHub route={route} navigation={navigation} />);
  await view.findByText('課堂閱讀');
  expect(view.getByText('作業讀取失敗，請更新課程資料後重試。')).toBeTruthy();
  expect(view.getByText(/目前沒有課程檔案上傳路徑/)).toBeTruthy();
  fireEvent.press(view.getByText('開啟教材：課堂閱讀'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'CourseMaterialViewer', {
    url: 'https://school.test/reading',
    title: '課堂閱讀',
    kind: 'material',
    courseName: '資訊倫理',
  });
  expect(webBrowserOpenWithPuTronClassGate).not.toHaveBeenCalled();
});
test('TronClass route opens exactly the selected official course and never Firestore quiz', async () => {
  const view = render(<CourseHub route={{ params: { source: 'tronclass', courseId: 321 } }} />);
  await view.findByText('開啟校方課程');
  expect(view.queryByText('測驗通知')).toBeNull();
  expect(view.queryByText('尚未發布作業。')).toBeNull();
  fireEvent.press(view.getByText('開啟校方課程'));
  await act(async () => {});
  expect(webBrowserOpenWithPuTronClassGate).toHaveBeenCalledWith(
    'https://tronclass.pu.edu.tw/course/321/content',
  );
});
test('section week scrolls to the week block', async () => {
  const view = render(
    <CourseHub route={{ params: { groupId: 'course-a', groupName: '資訊倫理', section: 'week' } }} />,
  );
  expect(await view.findByTestId('course-week')).toBeTruthy();
  await waitFor(() => expect(revealAssignmentSubmitArea).toHaveBeenCalled());
});

test.each(['account', 'school', 'course'])(
  'changing %s excludes a pending old response and invalidates its request guard',
  async (kind) => {
    let finish!: (value: CourseHubData) => void;
    jest.mocked(loadCourseHub).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<CourseHub route={route} />);
    const oldGuard = jest.mocked(loadCourseHub).mock.calls[0][1]!;
    if (kind === 'account') mockUser = { uid: 'bob' };
    if (kind === 'school') mockSchool = { id: 'school-b' };
    view.rerender(
      <CourseHub route={kind === 'course' ? { params: { groupId: 'course-b' } } : route} />,
    );
    await view.findByText('資訊倫理');
    expect(oldGuard()).toBe(false);
    await act(async () => {
      finish({ ...data, name: '前一個身分的課程' });
    });
    expect(view.queryByText('前一個身分的課程')).toBeNull();
  },
);

test('a published assignment opens its real submission detail with the scoped course and due date', async () => {
  const navigation = { navigate: jest.fn() };
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'work-23',
        title: '閱讀回應',
        description: '完成心得',
        dueAt: '2026-10-29T23:59:00+08:00',
        closed: false,
      }],
    },
  });

  const view = render(<CourseHub route={route} navigation={navigation} />);
  fireEvent.press(await view.findByText('查看作業：閱讀回應'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'HomeworkSubmit', {
    courseId: 'course-a',
    hwId: 'work-23',
    hwTitle: '閱讀回應',
    dueAt: '2026-10-29T23:59:00+08:00',
  });
});

test('closed assignments remain viewable but never appear among actionable weekly deadlines', async () => {
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'closed-1',
        title: '已結束測驗回顧',
        description: '',
        dueAt: '2026-10-29T23:59:00+08:00',
        closed: true,
      }],
    },
  });
  const view = render(<CourseHub route={route} />);
  expect(await view.findByText('查看已關閉作業：已結束測驗回顧')).toBeTruthy();
  expect(view.queryByText('查看本週作業：已結束測驗回顧')).toBeNull();
});

test('confirmed submission and published feedback never remain a pending weekly task', async () => {
  const navigation = { navigate: jest.fn() };
  const dueAt = thisWeekDeadline();
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'done-1',
        title: '已完成閱讀心得',
        description: '',
        dueAt,
        closed: false,
        submission: {
          kind: 'submitted',
          submittedAt: '2026-10-26T09:00:00.000Z',
          grade: { score: 92, feedback: '引用寫得很好', publishedAt: '2026-10-26T10:00:00.000Z', revisionCount: 0 },
        },
      }, {
        id: 'todo-1',
        title: '還未交的作業',
        description: '',
        dueAt,
        closed: false,
        submission: { kind: 'not_submitted' },
      }],
    },
  });
  const view = render(<CourseHub route={route} navigation={navigation} />);
  expect(await view.findByText('已繳交 · 已發布評分 92 分')).toBeTruthy();
  expect(view.getByText('教師回饋：引用寫得很好')).toBeTruthy();
  expect(view.queryByText('查看本週作業：已完成閱讀心得')).toBeNull();
  expect(view.getByText('查看本週作業：還未交的作業')).toBeTruthy();
  fireEvent.press(view.getByText('查看繳交紀錄：已完成閱讀心得'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'HomeworkSubmit', {
    courseId: 'course-a',
    hwId: 'done-1',
    hwTitle: '已完成閱讀心得',
    dueAt,
  });
});

test('unknown personal receipt status cannot be mistaken for pending coursework', async () => {
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'unknown-1',
        title: '無法確認繳交的作業',
        description: '',
        dueAt: '2026-10-29T15:59:00Z',
        closed: false,
        submission: { kind: 'unavailable' },
      }],
    },
  });
  const view = render(<CourseHub route={route} />);
  expect(await view.findByText('繳交狀態暫時讀不到，請重新整理')).toBeTruthy();
  expect(view.queryByText('查看本週作業：無法確認繳交的作業')).toBeNull();
  expect(view.getByText(/部分繳交狀態暫時無法確認/)).toBeTruthy();
});

test('returning to the course refreshes receipts instead of keeping a stale pending badge', async () => {
  const listeners: Array<() => void> = [];
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn((_event: string, callback: () => void) => {
      listeners.push(callback);
      return jest.fn();
    }),
  };
  const withReceipt = (kind: 'not_submitted' | 'submitted'): CourseHubData => ({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'r1',
        title: '期中作業',
        description: '',
        dueAt: '2026-10-29T15:59:00Z',
        closed: false,
        submission: kind === 'submitted'
          ? { kind: 'submitted', submittedAt: '2026-10-26T10:30:00Z', grade: null }
          : { kind: 'not_submitted' },
      }],
    },
  });
  jest.mocked(loadCourseHub)
    .mockResolvedValueOnce(withReceipt('not_submitted'))
    .mockResolvedValueOnce(withReceipt('submitted'));
  const view = render(<CourseHub route={route} navigation={navigation} />);
  expect(await view.findByText('尚未繳交')).toBeTruthy();
  expect(listeners).toHaveLength(1);
  await act(async () => listeners[0]());
  expect(await view.findByText(/已繳交 ·/)).toBeTruthy();
  expect(view.queryByText('查看本週作業：期中作業')).toBeNull();
  expect(loadCourseHub).toHaveBeenCalledTimes(2);
});

test('student filters distinguish confirmed submissions, unfinished work and unknown states', async () => {
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: { status: 'ready', items: [{
      id: 'done',
      title: '已送出的報告',
      description: '',
      dueAt: '2026-10-29T15:59:00Z',
      closed: false,
      submission: { kind: 'submitted', submittedAt: '2026-10-26T10:00:00Z', grade: null },
    }, {
      id: 'pending',
      title: '待繳作業',
      description: '',
      dueAt: '2026-10-29T15:59:00Z',
      closed: false,
      submission: { kind: 'not_submitted' },
    }, {
      id: 'unverified',
      title: '未確認的作業',
      description: '',
      dueAt: '2026-10-29T15:59:00Z',
      closed: false,
      submission: { kind: 'unavailable' },
    }] },
  });

  const view = render(<CourseHub route={route} />);
  expect(await view.findByText(/已繳交 1 · 已發布評分 0 · 未繳交 1 · 待確認 1/)).toBeTruthy();
  fireEvent.press(view.getByText('已繳交'));
  expect(view.getByText('查看繳交紀錄：已送出的報告')).toBeTruthy();
  expect(view.queryByText('查看作業：待繳作業')).toBeNull();
  fireEvent.press(view.getByText('未繳交'));
  expect(view.getByText('查看作業：待繳作業')).toBeTruthy();
  expect(view.queryByText('查看繳交紀錄：已送出的報告')).toBeNull();
  expect(view.queryByText('查看作業：未確認的作業')).toBeNull();
  fireEvent.press(view.getByText('全部'));
  expect(view.getByText('查看作業：未確認的作業')).toBeTruthy();
});

test('weekly actionable work still surfaces receipt warnings and never claims empty success for unknown receipts', async () => {
  const dueAt = thisWeekDeadline();
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'week-open',
        title: '本週待繳報告',
        description: '',
        dueAt,
        closed: false,
        submission: { kind: 'not_submitted' },
      }, {
        id: 'unknown-receipt',
        title: '狀態不明的作業',
        description: '',
        dueAt: '2026-11-10T15:59:00Z',
        closed: false,
        submission: { kind: 'unavailable' },
      }],
    },
  });

  const mixed = render(<CourseHub route={route} />);
  expect(await mixed.findByText('查看本週作業：本週待繳報告')).toBeTruthy();
  expect(mixed.getByText(/部分繳交狀態暫時無法確認/)).toBeTruthy();
  expect(mixed.queryByText('本週沒有待繳交的作業。')).toBeNull();

  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'only-unconfirmed',
        title: '僅有未確認收據',
        description: '',
        dueAt,
        closed: false,
        submission: { kind: 'unconfirmed' },
      }],
    },
  });
  const unknownOnly = render(<CourseHub route={{ params: { groupId: 'course-b' } }} />);
  expect(await unknownOnly.findByText(/部分繳交狀態暫時無法確認/)).toBeTruthy();
  expect(unknownOnly.queryByText('本週沒有待繳交的作業。')).toBeNull();
  expect(unknownOnly.queryByText('查看本週作業：僅有未確認收據')).toBeNull();
});

test('closed overdue work with late flag does not tell students the teacher still accepts submissions', async () => {
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data,
    assignments: {
      status: 'ready',
      items: [{
        id: 'closed-late',
        title: '已關閉但仍標補交',
        description: '',
        dueAt: '2026-10-20T15:59:00+08:00',
        closed: true,
        allowLateSubmission: true,
        submission: { kind: 'not_submitted' },
      }, {
        id: 'open-late',
        title: '仍可補交的作業',
        description: '',
        dueAt: '2026-10-20T15:59:00+08:00',
        closed: false,
        allowLateSubmission: true,
        submission: { kind: 'not_submitted' },
      }, {
        id: 'bad-deadline',
        title: '截止無法判讀',
        description: '',
        dueAt: 'totally-not-a-date',
        closed: false,
        allowLateSubmission: true,
        submission: { kind: 'not_submitted' },
      }],
    },
  });

  const view = render(<CourseHub route={route} />);
  expect(await view.findByText('查看已關閉作業：已關閉但仍標補交')).toBeTruthy();
  expect(view.getByText('已過截止時間 · 請洽授課教師')).toBeTruthy();
  expect(view.getByText('已過截止時間 · 教師允許補交')).toBeTruthy();
  expect(view.getByText('截止時間無法確認')).toBeTruthy();
  expect(view.queryByText('查看本週作業：已關閉但仍標補交')).toBeNull();
  expect(view.queryByText('查看本週作業：截止無法判讀')).toBeNull();
});


test('teachers open the scoped web grading workflow instead of student submission', async () => {
  jest.mocked(loadCourseHub).mockResolvedValue({
    ...data, canTeach: true,
    assignments: { status: 'ready', items: [{
      id: 'work', title: '閱讀報告', description: '', dueAt: null, closed: false,
      submission: { kind: 'instructor' },
    }] },
  });
  const navigation = { navigate: jest.fn() };
  const view = render(<CourseHub route={route} navigation={navigation} />);
  await view.findByText('開啟網頁批改');
  await act(async () => fireEvent.press(view.getByText('開啟網頁批改：閱讀報告')));
  expect(webBrowserOpenWithPuTronClassGate).toHaveBeenCalledWith('https://nuni.tw/teacher/course/course-a?school=pu');
  expect(safeNavigate).not.toHaveBeenCalledWith(navigation, 'HomeworkSubmit', expect.anything());
  expect(view.queryByText('未繳交')).toBeNull();
});
