import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AICourseAdvisorScreen } from '../screens/AICourseAdvisorScreen';
import { askCourseAdvisor, loadAdvisorCatalog, loadAdvisorCourse } from '../features/courseAdvisor';
import type { CatalogQueryResult } from '../services/courseCatalogClient';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/courseAdvisor', () => ({
  askCourseAdvisor: jest.fn(),
  loadAdvisorCatalog: jest.fn(),
  loadAdvisorCourse: jest.fn(),
  currentAdvisorSemester: () => '1151',
  officialSyllabusUrl: () => null,
  OFFICIAL_CATALOG_URL: 'https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/',
  AdvisorError: class extends Error {},
}));
const catalog = {
  filter: { semester: '1151' },
  source: 'live',
  fetchedAt: 1780000000000,
  courses: [
    {
      code: 'CS101',
      name: '資料結構',
      teacher: '陳老師',
      credits: 3,
      semester: '1151',
      timePlaceRaw: '週一',
    },
    {
      code: 'CS102',
      name: '作業系統',
      teacher: '張老師',
      credits: 3,
      semester: '1151',
      timePlaceRaw: '週二',
    },
  ],
} as CatalogQueryResult;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student-a' };
  mockSchool = { id: 'pu' };
  jest.mocked(loadAdvisorCatalog).mockResolvedValue(catalog);
  jest.mocked(loadAdvisorCourse).mockResolvedValue({ id: 'course-a', name: '正式課程' });
  jest.mocked(askCourseAdvisor).mockResolvedValue('以校方公布的先修要求為準。');
});

test('shows only fetched catalog courses with no fabricated scores or completion', async () => {
  const view = render(<AICourseAdvisorScreen />);
  expect(view.queryByText('資料結構')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('查詢課程')));
  expect(view.getByText('資料結構')).toBeTruthy();
  expect(view.queryByText(/高評價|推薦度|已加入課表|AI 推薦/)).toBeNull();
});
test('a failed catalog query stays retryable and has no fixed recommendations', async () => {
  jest.mocked(loadAdvisorCatalog).mockRejectedValueOnce(new Error('offline'));
  const view = render(<AICourseAdvisorScreen />);
  await act(async () => fireEvent.press(view.getByText('查詢課程')));
  expect(view.getByText('目前無法查詢課程，請稍後再試。')).toBeTruthy();
  expect(view.queryByText('資料結構')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('查詢課程')));
  expect(view.getByText('資料結構')).toBeTruthy();
});
test('question failures preserve the draft and retry without an invented reply or duplicate send', async () => {
  const first = deferred<string>();
  jest.mocked(askCourseAdvisor).mockReturnValueOnce(first.promise);
  const view = render(<AICourseAdvisorScreen />);
  fireEvent.changeText(view.getByLabelText('課程問題'), '我想學資料結構');
  fireEvent.press(view.getByText('送出問題'));
  fireEvent.press(view.getByText('等待回覆中'));
  expect(askCourseAdvisor).toHaveBeenCalledTimes(1);
  await act(async () => first.reject(new Error('offline')));
  expect(view.getByLabelText('課程問題').props.value).toBe('我想學資料結構');
  expect(view.queryByText('以校方公布的先修要求為準。')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.getByText('以校方公布的先修要求為準。')).toBeTruthy();
});
test.each(['account', 'school', 'course'] as const)(
  'switching %s isolates a pending catalog response and conversation',
  async (change) => {
    const pending = deferred<CatalogQueryResult>();
    jest.mocked(loadAdvisorCatalog).mockReturnValueOnce(pending.promise);
    const view = render(<AICourseAdvisorScreen />);
    fireEvent.changeText(view.getByLabelText('課程問題'), '原帳號問題');
    fireEvent.press(view.getByText('查詢課程'));
    if (change === 'account') mockUser = { uid: 'student-b' };
    if (change === 'school') mockSchool = { id: 'other' };
    await act(async () =>
      view.rerender(
        <AICourseAdvisorScreen
          route={
            change === 'course'
              ? { params: { groupId: 'course-b', groupName: '偽造課名' } }
              : undefined
          }
        />,
      ),
    );
    await act(async () => pending.resolve(catalog));
    expect(view.queryByText('資料結構')).toBeNull();
    expect(view.getByLabelText('課程問題').props.value).toBe('');
    expect(view.queryByText('偽造課名')).toBeNull();
  },
);
test('changing search criteria cancels old results and a pending old reply', async () => {
  const pending = deferred<string>();
  jest.mocked(askCourseAdvisor).mockReturnValueOnce(pending.promise);
  const view = render(<AICourseAdvisorScreen />);
  fireEvent.changeText(view.getByLabelText('課程問題'), '舊問題');
  fireEvent.press(view.getByText('送出問題'));
  const oldGuard = jest.mocked(askCourseAdvisor).mock.calls[0][0].isCurrent;
  fireEvent.changeText(view.getByLabelText('課程關鍵字'), '新關鍵字');
  expect(oldGuard()).toBe(false);
  await act(async () => pending.resolve('舊回覆'));
  expect(view.queryByText('舊回覆')).toBeNull();
});
test('changing selected catalog course isolates pending chat and permits a new question', async () => {
  const pending = deferred<string>();
  jest.mocked(askCourseAdvisor).mockReturnValueOnce(pending.promise);
  const view = render(<AICourseAdvisorScreen />);
  await act(async () => fireEvent.press(view.getByText('查詢課程')));
  fireEvent.press(view.getByText('討論資料結構'));
  fireEvent.changeText(view.getByLabelText('課程問題'), '第一門課');
  fireEvent.press(view.getByText('送出問題'));
  const oldGuard = jest.mocked(askCourseAdvisor).mock.calls[0][0].isCurrent;
  fireEvent.press(view.getByText('討論作業系統'));
  expect(oldGuard()).toBe(false);
  fireEvent.changeText(view.getByLabelText('課程問題'), '第二門課');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await act(async () => pending.resolve('第一門課的舊回覆'));
  expect(view.queryByText('第一門課的舊回覆')).toBeNull();
  expect(view.getByText('以校方公布的先修要求為準。')).toBeTruthy();
  expect(jest.mocked(askCourseAdvisor).mock.calls[1][0]).toMatchObject({
    history: [],
    course: { code: 'CS102' },
  });
});
test('a failed classroom membership read does not permit focused chat', async () => {
  jest.mocked(loadAdvisorCourse).mockRejectedValueOnce(new Error('denied'));
  const view = render(
    <AICourseAdvisorScreen route={{ params: { groupId: 'missing', groupName: '偽造課名' } }} />,
  );
  await act(async () => {});
  expect(view.queryByText('偽造課名')).toBeNull();
  fireEvent.changeText(view.getByLabelText('課程問題'), '我的成績');
  fireEvent.press(view.getByText('送出問題'));
  expect(askCourseAdvisor).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'course'] as const)(
  'switching %s discards an in-flight reply before it reaches the new context',
  async (change) => {
    const pending = deferred<string>();
    jest.mocked(askCourseAdvisor).mockReturnValueOnce(pending.promise);
    const view = render(<AICourseAdvisorScreen />);
    fireEvent.changeText(view.getByLabelText('課程問題'), '舊範圍問題');
    fireEvent.press(view.getByText('送出問題'));
    const guard = jest.mocked(askCourseAdvisor).mock.calls[0][0].isCurrent;
    if (change === 'account') mockUser = { uid: 'student-b' };
    if (change === 'school') mockSchool = { id: 'other' };
    await act(async () =>
      view.rerender(
        <AICourseAdvisorScreen
          route={change === 'course' ? { params: { groupId: 'course-b' } } : undefined}
        />,
      ),
    );
    expect(guard()).toBe(false);
    await act(async () => pending.resolve('舊範圍回覆'));
    expect(view.queryByText('舊範圍回覆')).toBeNull();
    expect(view.getByLabelText('課程問題').props.value).toBe('');
  },
);

test('an old search failure cannot clear the newer request loading state or replace its result', async () => {
  const first = deferred<CatalogQueryResult>();
  const second = deferred<CatalogQueryResult>();
  jest
    .mocked(loadAdvisorCatalog)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const view = render(<AICourseAdvisorScreen />);
  fireEvent.press(view.getByText('查詢課程'));
  const oldSignal = jest.mocked(loadAdvisorCatalog).mock.calls[0][3];
  fireEvent.changeText(view.getByLabelText('課程關鍵字'), '作業系統');
  expect(oldSignal.aborted).toBe(true);
  fireEvent.press(view.getByText('查詢課程'));
  await act(async () => first.reject(new Error('old failure')));
  expect(view.getByText('查詢中')).toBeTruthy();
  expect(view.queryByText('目前無法查詢課程，請稍後再試。')).toBeNull();
  await act(async () => second.resolve({ ...catalog, courses: [catalog.courses[1]] }));
  expect(view.getByText('作業系統')).toBeTruthy();
  expect(view.queryByText('資料結構')).toBeNull();
});
