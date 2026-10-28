import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { CampusAssignmentWorkbench } from '../screens/CampusAssignmentWorkbench';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { askCampusAssistant } from '../features/campusAssistant';
import { refreshCampusSenseSnapshot, type CampusSenseSnapshot, type CampusSenseProgress } from '../services/campusSenseSnapshot';

let mockUid: string | null = 'A';
let mockSchool = 'pu';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool, name: '測試學校' } }) }));
jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  getOnDeviceAssistantReadiness: jest.fn(async () => ({ available: true, ready: false, modelId: 'qwen2.5-0.5b' })),
  OnDeviceAssistantError: class extends Error {},
}));
jest.mock('../features/campusAssistantActions', () => ({ confirmCampusAgentWrite: jest.fn() }));
jest.mock('../services/campusSenseSnapshot', () => ({
  ...jest.requireActual('../services/campusSenseSnapshot'), refreshCampusSenseSnapshot: jest.fn(),
}));
jest.mock('../screens/CampusAssignmentReminderAction', () => ({ CampusAssignmentReminderAction: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const now = Date.parse('2026-10-28T01:00:00Z');
function snapshot(size = 30): CampusSenseSnapshot {
  return {
    userId: 'A', schoolId: 'pu', checkedAt: new Date(now).toISOString(),
    schedule: { status: 'unavailable', count: null },
    announcements: { status: 'unavailable', items: [] },
    assignments: { status: 'available', count: size, items: Array.from({ length: size }, (_, index) => ({
      title: '任務 ' + index, groupName: index % 2 ? '資料庫' : '程式設計',
      dueAt: new Date(now + (index + 1) * 3600000).toISOString(),
      source: { kind: 'group-assignment' as const, groupId: 'g_' + index % 2, assignmentId: 'a_' + index },
    })) },
  };
}
const context = () => ({ userId: 'A', schoolId: 'pu', isCurrent: () => true, navigation: { navigate: jest.fn() } });
beforeEach(() => {
  // 只固定資料時效判斷；保留測試清理程序需要的實際事件排程。
  jest.spyOn(Date, 'now').mockReturnValue(now);
  mockUid = 'A'; mockSchool = 'pu';
  jest.mocked(refreshCampusSenseSnapshot).mockReset(); jest.mocked(askCampusAssistant).mockReset();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('searches a record on the last page and opens its authorized assignment without inference', () => {
  const ctx = context();
  const view = render(<CampusAssignmentWorkbench snapshot={snapshot(137)} context={ctx} disabled={false} />);
  expect(view.getByText('任務 0')).toBeTruthy();
  expect(view.queryByText('任務 136')).toBeNull();
  expect(view.getAllByText('查看這份作業')).toHaveLength(12);
  fireEvent.changeText(view.getByLabelText('搜尋已同步作業'), '任務 136');
  expect(view.getByText('任務 136')).toBeTruthy();
  expect(view.getByText('符合條件 1 筆 · 已同步 137 筆')).toBeTruthy();
  fireEvent.press(view.getByText('查看這份作業'));
  expect(ctx.navigation.navigate).toHaveBeenCalledWith('學習', {
    screen: 'HomeworkSubmit', params: { groupId: 'g_0', assignmentId: 'a_136' },
  });
  expect(askCampusAssistant).not.toHaveBeenCalled();
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
});

test('pagination is bounded and search resets back to the first matching page', () => {
  const view = render(<CampusAssignmentWorkbench snapshot={snapshot()} context={context()} disabled={false} />);
  fireEvent.press(view.getByText('下一頁作業'));
  expect(view.queryByText('任務 0')).toBeNull();
  expect(view.getByText('任務 12')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋已同步作業'), '任務 0');
  expect(view.getByText('任務 0')).toBeTruthy();
  fireEvent.press(view.getByText('重設作業篩選'));
  expect(view.getAllByText('查看這份作業')).toHaveLength(12);
});

test('date filters expose selection state and distinguish no matches from no source data', () => {
  const data = snapshot(2);
  data.assignments.items[0].dueAt = null;
  const view = render(<CampusAssignmentWorkbench snapshot={data} context={context()} disabled={false} />);
  fireEvent.press(view.getByLabelText('篩選作業：未提供日期'));
  expect(view.getByLabelText('篩選作業：未提供日期').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('任務 0')).toBeTruthy();
  expect(view.queryByText('任務 1')).toBeNull();
  fireEvent.press(view.getByLabelText('篩選作業：已逾期'));
  expect(view.getByText(/已同步清單沒有符合條件的作業/)).toBeTruthy();
});

test('partial sources explicitly disclose records outside the local search', () => {
  const data = snapshot(5); data.assignments.count = 70;
  const view = render(<CampusAssignmentWorkbench snapshot={data} context={context()} disabled={false} />);
  fireEvent.changeText(view.getByLabelText('搜尋已同步作業'), '不存在');
  expect(view.getByText(/另有 65 筆尚未同步/)).toBeTruthy();
  expect(view.getByText('符合條件 0 筆 · 已同步 5 筆')).toBeTruthy();
});

test.each(['user', 'school', 'stale'])('never displays private rows for a %s mismatch', (kind) => {
  const data = snapshot();
  if (kind === 'user') data.userId = 'B';
  if (kind === 'school') data.schoolId = 'other';
  if (kind === 'stale') data.checkedAt = new Date(now - 900001).toISOString();
  const view = render(<CampusAssignmentWorkbench snapshot={data} context={context()} disabled={false} />);
  expect(view.queryByText('任務 0')).toBeNull();
  expect(view.getByText(/作業資料已失效/)).toBeTruthy();
});

test('an idle open workbench removes private rows when the source expires', () => {
  const scheduled = jest.spyOn(global, 'setTimeout');
  const view = render(<CampusAssignmentWorkbench snapshot={snapshot()} context={context()} disabled={false} />);
  expect(view.getByText('任務 0')).toBeTruthy();
  // 取得元件實際註冊的過期回呼，不另外製造一套過期邏輯。
  const expire = scheduled.mock.calls.find(
    ([callback, delay]) => typeof callback === 'function' && delay === 900001,
  )?.[0];
  expect(typeof expire).toBe('function');
  jest.mocked(Date.now).mockReturnValue(now + 900001);
  act(() => { (expire as () => void)(); });
  expect(view.queryByText('任務 0')).toBeNull();
  expect(view.getByText(/作業資料已失效/)).toBeTruthy();
  view.unmount();
});

test('the assistant exposes search without another sync or model request and clears it on campus switch', async () => {
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot(137));
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.queryByLabelText('搜尋已同步作業')).toBeNull();
  fireEvent.press(view.getByText('查看與篩選已同步作業'));
  fireEvent.changeText(view.getByLabelText('搜尋已同步作業'), '任務 136');
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).toHaveBeenCalledWith('學習', {
    screen: 'HomeworkSubmit', params: { groupId: 'g_0', assignmentId: 'a_136' },
  });
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
  expect(askCampusAssistant).not.toHaveBeenCalled();
  mockSchool = 'other';
  await act(async () => { view.rerender(<CampusAssistantScreen navigation={{ navigate }} />); });
  expect(view.queryByText('任務 136')).toBeNull();
  expect(view.queryByLabelText('搜尋已同步作業')).toBeNull();
});

test('manual sync reports progress, blocks concurrent send/mode changes, and releases on cancel', async () => {
  let signal!: AbortSignal;
  let oldProgress!: (value: CampusSenseProgress) => void;
  jest.mocked(refreshCampusSenseSnapshot).mockImplementationOnce((input) => {
    signal = input.signal!; oldProgress = input.onProgress!;
    oldProgress({ phase: 'reading', loaded: 50, total: 137, pages: 1, pageLimit: 8 });
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('sense-cancelled')), { once: true }));
  });
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '保留這個問題');
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.getByText('正在核對作業：50 / 137 筆')).toBeTruthy();
  fireEvent.press(view.getByText('送出問題'));
  fireEvent.press(view.getByText('校園即時 · 需網路'));
  expect(askCampusAssistant).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('取消這次同步')));
  expect(signal.aborted).toBe(true);
  expect(view.queryByText('正在同步校園資料…')).toBeNull();
  expect(view.getByText(/已取消這次同步/)).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('保留這個問題');
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot(1));
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  act(() => oldProgress({ phase: 'complete', loaded: 137, total: 137, pages: 3, pageLimit: 8 }));
  expect(view.queryByText('正在核對作業：137 / 137 筆')).toBeNull();
  expect(view.getByText('已取得本次授權資料')).toBeTruthy();
});

test('cancelling one-tap planning during sync never starts local generation', async () => {
  jest.mocked(refreshCampusSenseSnapshot).mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
    signal!.addEventListener('abort', () => reject(new Error('sense-cancelled')), { once: true });
  }));
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByText('今日重點')));
  await act(async () => fireEvent.press(view.getByText('取消這次同步')));
  expect(askCampusAssistant).not.toHaveBeenCalled();
  expect(view.queryByText('正在同步校園資料…')).toBeNull();
});
