import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AIOverlayHost } from '../components/AIOverlayHost';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { askCampusAssistant, getOnDeviceAssistantReadiness } from '../features/campusAssistant';
import { confirmCampusAgentWrite } from '../features/campusAssistantActions';
import { refreshCampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { scheduleCampusAssignmentReminder, cancelCampusAssignmentReminder, getCampusAssignmentReminderStatus } from '../services/campusAssignmentReminders';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';
import { beginSavedCampusPlansSignOutCleanup, endSavedCampusPlansSignOutCleanup } from '../services/savedCampusPlans';
import { readNuniPlanAssignmentTarget, type NuniPlanAssignmentSource } from '../services/nuniPlanAssignmentTarget';
jest.mock('../services/nuniPlanAssignmentTarget', () => ({ readNuniPlanAssignmentTarget: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
const mockClose = jest.fn();
let mockOverlay = { visible: true, mode: 'chat', initialPrompt: '查校方公告' };
jest.mock('../app/useAIOverlay', () => ({
  useAIOverlay: () => mockOverlay,
  aiOverlay: { close: () => mockClose() },
}));
let mockUid: string | null = 'A';
let mockSchool = 'pu';
let mockPlatform: {
  loading?: boolean; session?: { platformAccountId: string; context?: string };
  isSessionCurrent?: (id: string, context: string) => boolean;
  request?: jest.Mock;
  bffRequest?: jest.Mock;
} | null = null;
jest.mock('../state/nuniSession', () => ({
  ...jest.requireActual('../state/nuniSession'), useOptionalNuniSession: () => mockPlatform,
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: {
      id: mockSchool,
      name: mockSchool === 'pu' ? '靜宜大學' : `學校（${mockSchool}）`,
    },
  }),
}));
jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  OnDeviceAssistantError: class OnDeviceAssistantError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  getOnDeviceAssistantReadiness: jest.fn(async () => ({
    available: true, ready: false, modelId: 'qwen2.5-0.5b',
    reason: '尚未下載免費模型',
  })),
}));
jest.mock('../features/campusAssistantActions', () => ({
  confirmCampusAgentWrite: jest.fn(),
}));
jest.mock('../services/campusSenseSnapshot', () => ({
  ...jest.requireActual('../services/campusSenseSnapshot'),
  refreshCampusSenseSnapshot: jest.fn(),
}));
let mockUpcomingClass = false;
jest.mock('../screens/AssistantClassNowHint', () => ({
  AssistantClassNowHint: ({ children }: { children: (upcoming: boolean) => React.ReactNode }) => children(mockUpcomingClass),
}));
jest.mock('../screens/LegacyAssignmentReminders', () => ({ LegacyAssignmentReminders: () => null }));
jest.mock('../services/campusAssignmentReminders', () => ({
  scheduleCampusAssignmentReminder: jest.fn(),
  cancelCampusAssignmentReminder: jest.fn(),
  getCampusAssignmentReminderStatus: jest.fn(async () => []),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const request = askCampusAssistant as jest.Mock;
function openCampusTools(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByRole('tab', { name: '校園工具' }));
}
function selectCampusMode(view: ReturnType<typeof render>) {
  openCampusTools(view);
  fireEvent.press(view.getByText('校園即時 · 需網路'));
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  jest.clearAllMocks();
  // clearAllMocks does not clear queued mockResolvedValueOnce implementations.
  // Prevent a pending result from one navigation test reaching another account.
  request.mockReset();
  jest.mocked(readNuniPlanAssignmentTarget).mockReset();
  jest.mocked(confirmCampusAgentWrite).mockReset();
  jest.mocked(refreshCampusSenseSnapshot).mockReset();
  jest.mocked(scheduleCampusAssignmentReminder).mockReset();
  jest.mocked(cancelCampusAssignmentReminder).mockReset();
  jest.mocked(getCampusAssignmentReminderStatus).mockReset();
  jest.mocked(getCampusAssignmentReminderStatus).mockResolvedValue([]);
  mockUid = 'A';
  mockSchool = 'pu';
  mockUpcomingClass = false;
  mockPlatform = null;
  mockOverlay = { visible: true, mode: 'chat', initialPrompt: '查校方公告' };
  await AsyncStorage.clear();
});
test('failed questions remain editable and retry does not add duplicated history', async () => {
  request
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ content: '已找到公告', hasActions: false });
  const view = render(<CampusAssistantScreen />);
  selectCampusMode(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '查公告');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('查公告');
  expect(view.getByText(/問題已保留/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重試查詢')));
  expect(request.mock.calls[1][0].messages).toEqual([{ role: 'user', content: '查公告' }]);
  expect(view.getByText('已找到公告')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('');
});
test.each([
  ['今日重點', '重新整理今日重點', '今天要先處理什麼？'],
  ['未來七天', '重新規劃未來七天', '依手機課表與授權作業安排接下來七天的學習計畫'],
])('retrying %s refreshes its sources and leaves the draft intact', async (initial, retry, question) => {
  const sensed = {
    userId: 'A', schoolId: 'pu', checkedAt: new Date(Date.now() - 1000).toISOString(),
    schedule: { status: 'unavailable' as const, count: null },
    assignments: { status: 'available' as const, count: 0, items: [] },
    announcements: { status: 'available' as const, items: [] },
  };
  const refreshed = { ...sensed, checkedAt: new Date().toISOString() };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sensed).mockResolvedValueOnce(refreshed);
  request.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ content: '今天的安排', source: 'device' });
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '還在想怎麼問');
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText(initial)));
  await act(async () => fireEvent.press(view.getByText(retry)));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toMatchObject({
    messages: [{ role: 'user', content: question }], mode: 'device', senseSnapshot: refreshed,
  });
  expect(view.getByText('今天的安排')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('還在想怎麼問');
  expect(view.queryByText(retry)).toBeNull();
});

async function failAssignmentPage(draft: string) {
  const checkedAt = new Date().toISOString();
  const items = Array.from({ length: 9 }, (_, i) => ({ title: `報告 ${i + 1}`, groupName: '資管', dueAt: null }));
  const snapshot = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    announcements: { status: 'available' as const, items: [] },
    assignments: { status: 'available' as const, count: items.length, items },
  };
  const question = '我的待交作業';
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot);
  request.mockResolvedValueOnce({
    source: 'device', content: '八份待交報告',
    assignmentRead: { userId: 'A', schoolId: 'pu', checkedAt, items: items.slice(0, 8),
      filterQuestion: question, page: { question, offset: 0, total: items.length, asOf: Date.parse(checkedAt) } },
  }).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ source: 'device', content: '最後一份報告' });
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  const field = view.getByLabelText('詢問校園助理');
  fireEvent.changeText(field, question);
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  fireEvent.changeText(field, draft);
  await act(async () => fireEvent.press(view.getByText('下一頁作業')));
  return { view, field, snapshot };
}

test.each(['', '待會才要送出的問題'])('an assignment retry resends only the selected page with draft "%s"', async (draft) => {
  const { view, field, snapshot } = await failAssignmentPage(draft);
  await act(async () => fireEvent.press(view.getByText('重試「下一頁」')));
  expect(request.mock.calls[2][0].messages).toEqual(request.mock.calls[1][0].messages);
  expect(request.mock.calls[2][0].messages.at(-1)).toEqual({ role: 'user', content: '下一頁' });
  expect(request.mock.calls[2][0]).toMatchObject({ mode: 'device', senseSnapshot: snapshot });
  expect(view.getByText('最後一份報告')).toBeTruthy();
  expect(field.props.value).toBe(draft);
  expect(view.queryByText('重試「下一頁」')).toBeNull();
});

test('an assignment retry cannot run after its source expires or is cleared', async () => {
  const { view, snapshot } = await failAssignmentPage('繼續寫的問題');
  const expired = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(snapshot.checkedAt) + 16 * 60_000);
  try {
    fireEvent.press(view.getByText('重試「下一頁」'));
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    expired.mockRestore();
  }
  openCampusTools(view);
  fireEvent.press(view.getByText('清除本次校園摘要'));
  fireEvent.press(view.getByText('對話'));
  expect(view.queryByText('重試「下一頁」')).toBeNull();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('繼續寫的問題');
});

test('stopping a brief during sync discards late data and offers the same brief again', async () => {
  const sync = deferred<Awaited<ReturnType<typeof refreshCampusSenseSnapshot>>>();
  jest.mocked(refreshCampusSenseSnapshot).mockReturnValueOnce(sync.promise);
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  fireEvent.press(view.getByText('今日重點'));
  fireEvent.press(view.getByText('取消這次同步'));
  expect(jest.mocked(refreshCampusSenseSnapshot).mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => sync.resolve({
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 0, items: [] },
    announcements: { status: 'available', items: [] },
  }));
  expect(request).not.toHaveBeenCalled();
  expect(view.getByText('重新整理今日重點')).toBeTruthy();
});

test.each(['account', 'school', 'account-back'])(
  '%s changes hide old questions and ignore a late reply',
  async (change) => {
    const old = deferred<{ content: string; hasActions: boolean }>();
    request.mockReturnValueOnce(old.promise);
    const view = render(<CampusAssistantScreen route={{ params: { prompt: 'A 的問題' } }} />);
    selectCampusMode(view);
    fireEvent.press(view.getByText('送出問題'));
    const oldCurrent = request.mock.calls[0][0].isCurrent;
    if (change === 'school') mockSchool = 'other';
    else mockUid = 'B';
    view.rerender(<CampusAssistantScreen route={{ params: { prompt: 'A 的問題' } }} />);
    expect(view.getByLabelText('詢問校園助理').props.value).toBe('');
    if (change === 'account-back') {
      mockUid = 'A';
      view.rerender(<CampusAssistantScreen />);
    }
    expect(oldCurrent()).toBe(false);
    await act(async () => old.resolve({ content: 'A 的私人回覆', hasActions: false }));
    expect(view.queryByText('A 的私人回覆')).toBeNull();
    expect(view.getByLabelText('詢問校園助理').props.value).toBe('');
  },
);
test('a proposal is clearly unsent and double press cannot execute or duplicate a request', async () => {
  const pending = deferred<{ content: string; hasActions: boolean }>();
  request.mockReturnValue(pending.promise);
  const view = render(<CampusAssistantScreen />);
  selectCampusMode(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '幫我送出申請');
  const button = view.getByText('送出問題');
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ content: '已整理申請草稿，請確認。', hasActions: true }));
  expect(view.getByText('尚未送出任何申請或交易。請到對應服務確認辦理。')).toBeTruthy();
  expect(view.queryByText('確認執行')).toBeNull();
});
test('guests can draft offline, but cannot submit authenticated campus queries', () => {
  mockUid = null;
  const goBack = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ goBack }} />);
  expect(view.getByLabelText('詢問校園助理')).toBeTruthy();
  selectCampusMode(view);
  expect(view.queryByLabelText('詢問校園助理')).toBeNull();
  fireEvent.press(view.getByLabelText('返回'));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

test.each(['chat', 'quick', 'insights'])(
  'global %s entry uses the same callable UI without running the prompt automatically',
  async (mode) => {
    mockOverlay = { visible: true, mode, initialPrompt: '查校方公告' };
    request.mockResolvedValueOnce({ content: '伺服器公告', hasActions: false });
    const view = render(<AIOverlayHost />);
    selectCampusMode(view);
    expect(view.getByLabelText('詢問校園助理').props.value).toBe('查校方公告');
    expect(request).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(view.getByText('送出問題')));
    expect(view.getByText('伺服器公告')).toBeTruthy();
    fireEvent.press(view.getByLabelText('返回'));
    expect(mockClose).toHaveBeenCalledTimes(1);
  },
);

test('suggested questions fill an editable draft without calling the backend until submitted', async () => {
  const view = render(<CampusAssistantScreen />);
  fireEvent.press(view.getByText('幫我把期末報告拆成可以完成的步驟'));
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('幫我把期末報告拆成可以完成的步驟');
  expect(request).not.toHaveBeenCalled();
});

test('shows one announcement shortcut and reuses the current account’s synced source when pressed', async () => {
  const view = render(<CampusAssistantScreen />);
  expect(view.getAllByRole('button', { name: /公告/ })).toHaveLength(1);
  expect(view.getByRole('button', { name: '同步並查今日公告' })).toBeTruthy();
  const source = {
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    announcements: { status: 'available' as const, items: [] },
    assignments: { status: 'unavailable' as const, count: null, items: [] },
    schedule: { status: 'unavailable' as const, count: null },
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(source);
  request.mockResolvedValueOnce({ source: 'device', content: '本次摘要中沒有今天的公告。', hasActions: false });
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByRole('tab', { name: '對話' }));
  expect(view.getAllByRole('button', { name: /公告/ })).toHaveLength(1);
  expect(request).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查今日公告' })));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ mode: 'device', senseSnapshot: source }));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
});

test('assistant offers the existing service directly instead of inventing a transaction', async () => {
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '圖書館怎麼走');
  fireEvent.press(view.getByText('前往校園地圖'));
  expect(navigate).toHaveBeenCalledWith('校園', {
    screen: 'MapV2',
    params: undefined,
  });
  expect(request).not.toHaveBeenCalled();
});

test('a verified offline timetable result opens only its allowlisted local service', async () => {
  const navigate = jest.fn();
  request.mockResolvedValueOnce({
    content: '星期一有 2 堂已保存的課程',
    source: 'device',
    tool: 'saved-timetable',
    route: '/timetable',
    hasActions: false,
  });
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天課表');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.getByText('手機離線工具')).toBeTruthy();
  expect(view.getByText(/本機規則／已保存資料/)).toBeTruthy();
  fireEvent.press(view.getByText('開啟我的課表'));
  expect(navigate).toHaveBeenCalledWith('學習', {
    screen: 'PersonalTimetable',
    params: undefined,
  });
});

test('a service route outside the local allowlist is never turned into a direct navigation', async () => {
  request.mockResolvedValueOnce({
    content: '請核對內容',
    source: 'device',
    tool: 'open-service',
    route: 'https://untrusted.invalid',
    hasActions: false,
  });
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '幫我寫報告');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.queryByText(/開啟https/)).toBeNull();
});

test('a server proposal requires review and a second explicit tap before writing', async () => {
  const runId = '01234567-89ab-4cde-8012-3456789abcde';
  request.mockResolvedValueOnce({
    content: '已準備好報修草稿，確認前不會送出。',
    source: 'campus',
    hasActions: true,
    proposals: [{
      label: '確認送出報修',
      toolName: 'createDormRepairRequest',
      input: { dormitory: 'A棟', room: '301', category: '冷氣', description: '不冷' },
      agentRunId: runId,
    }],
  });
  jest.mocked(confirmCampusAgentWrite).mockResolvedValue({
    success: true, toolName: 'createDormRepairRequest', repairId: 'repair-123',
  });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  selectCampusMode(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), 'A棟301冷氣不冷');
  await act(async () => fireEvent.press(view.getByText('送出問題')));

  expect(view.getByText('確認送出報修')).toBeTruthy();
  expect(view.getByText('需要本人確認 · 尚未執行')).toBeTruthy();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('檢視任務草稿'));
  expect(view.getByText('301')).toBeTruthy();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(view.getByText('確認並執行'));
  });
  expect(confirmCampusAgentWrite).toHaveBeenCalledTimes(1);
  expect(jest.mocked(confirmCampusAgentWrite).mock.calls[0][0]).toMatchObject({
    userId: 'A', schoolId: 'pu',
    proposal: { agentRunId: runId, toolName: 'createDormRepairRequest' },
  });
  expect(view.getByText('伺服器已確認執行成功')).toBeTruthy();
  expect(view.getByText('紀錄編號：repair-123')).toBeTruthy();
  expect(view.queryByText('確認並執行')).toBeNull();
  fireEvent.press(view.getByText('開啟服務頁核對紀錄'));
  expect(navigate).toHaveBeenCalledWith('校園', {
    screen: 'Dormitory',
    params: undefined,
  });
});

test('a lost write receipt is never displayed as success or offered for automatic retry', async () => {
  request.mockResolvedValueOnce({
    content: '請確認',
    source: 'campus', hasActions: true,
    proposals: [{
      label: '送出請假', toolName: 'submitLeaveRequest',
      input: { courseId: 'course-1', date: '2026-10-29', type: '事假' },
      agentRunId: '01234567-89ab-4cde-8012-3456789abcde',
    }],
  });
  jest.mocked(confirmCampusAgentWrite).mockRejectedValueOnce(new Error('timeout'));
  const view = render(<CampusAssistantScreen />);
  selectCampusMode(view);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '明天請假');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  fireEvent.press(view.getByText('檢視任務草稿'));
  await act(async () => fireEvent.press(view.getByText('確認並執行')));
  expect(view.getByText('執行狀態尚未確認')).toBeTruthy();
  expect(view.queryByText('伺服器已確認執行成功')).toBeNull();
  expect(view.queryByText('確認並執行')).toBeNull();
  expect(confirmCampusAgentWrite).toHaveBeenCalledTimes(1);
});

test('a user explicitly syncs authorized context before it reaches local inference', async () => {
  const snapshot = {
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable' as const, count: null },
    assignments: { status: 'available' as const, count: 2, items: [
      { title: '報告', groupName: '資料庫', dueAt: null },
    ] },
    announcements: { status: 'available' as const, items: [] },
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValue(snapshot);
  request.mockResolvedValueOnce({
    content: '資料庫報告', source: 'device', tool: 'campus-snapshot', hasActions: false,
  });
  const view = render(<CampusAssistantScreen />);
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledWith({
    scope: { uid: 'A', schoolId: 'pu' }, isCurrent: expect.any(Function),
    signal: expect.any(AbortSignal), onProgress: expect.any(Function),
  });
  expect(jest.mocked(refreshCampusSenseSnapshot).mock.calls[0][0].signal?.aborted).toBe(false);
  expect(view.getByText('已取得本次授權資料')).toBeTruthy();
  fireEvent.press(view.getByText('對話'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '我的待交作業');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device', senseSnapshot: snapshot,
  }));
  expect(view.getByText(/先前主動同步的授權摘要/)).toBeTruthy();
  openCampusTools(view);
  fireEvent.press(view.getByText('清除本次校園摘要'));
  expect(view.getByText('尚未同步校園摘要')).toBeTruthy();
});

test('switching schools drops sensed data and ignores a late sync response', async () => {
  const pending = deferred<{
    userId: string; schoolId: string; checkedAt: string;
    schedule: { status: 'unavailable'; count: null };
    assignments: { status: 'available'; count: number; items: [] };
    announcements: { status: 'available'; items: [] };
  }>();
  jest.mocked(refreshCampusSenseSnapshot).mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  fireEvent.press(view.getByText('同步我的校園資料'));
  mockSchool = 'other';
  view.rerender(<CampusAssistantScreen />);
  await act(async () => pending.resolve({
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 0, items: [] },
    announcements: { status: 'available', items: [] },
  }));
  openCampusTools(view);
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
  expect(view.getByText('尚未同步校園摘要')).toBeTruthy();
});

test('one-tap daily brief senses authorized sources and synthesizes on the phone', async () => {
  const sensed = {
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '資料庫作業', groupName: '資料庫', dueAt: '2026-10-28T09:00:00Z' }],
    },
    announcements: { status: 'available' as const, items: [] },
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sensed);
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-snapshot',
    content: '下一步：先核對資料庫作業', route: '/classroom', hasActions: false,
  });
  const view = render(<CampusAssistantScreen />);
  expect(request).not.toHaveBeenCalled();
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('整理今日重點')));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device',
    senseSnapshot: sensed,
    messages: [{ role: 'user', content: '今天要先處理什麼？' }],
  }));
  expect(view.getByText('下一步：先核對資料庫作業')).toBeTruthy();
  expect(view.getByText(/先前主動同步的授權摘要/)).toBeTruthy();
});

test('stopping on-device generation aborts the owned request and discards a late reply', async () => {
  const pending = deferred<{ content: string; hasActions: boolean; source: 'device' }>();
  request.mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '請規劃三天的報告進度');
  fireEvent.press(view.getByText('送出問題'));
  const signal = request.mock.calls[0][0].signal as AbortSignal;
  expect(signal).toBeDefined();
  expect(signal.aborted).toBe(false);
  fireEvent.press(view.getByText('停止本機回答'));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve({ content: '已被取消的過期回答', hasActions: false, source: 'device' });
  });
  expect(view.queryByText('已被取消的過期回答')).toBeNull();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('請規劃三天的報告進度');
  expect(view.getByText(/已停止本機回答/)).toBeTruthy();
});

test('leaving the assistant aborts any in-progress on-device generation', () => {
  const old = deferred<{ content: string; hasActions: boolean; source: 'device' }>();
  request.mockReturnValueOnce(old.promise);
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '幫我做學習計畫');
  fireEvent.press(view.getByText('送出問題'));
  const signal = request.mock.calls[0][0].signal as AbortSignal;
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
  // No need to resolve a native generation that was explicitly stopped.
});

test('the seven-day agent entry shows sourced steps and only navigates to verified screens', async () => {
  const checkedAt = new Date().toISOString();
  const sensed = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '資訊管理期末報告', groupName: '資管', dueAt: null }],
    },
    announcements: { status: 'available' as const, items: [] },
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sensed);
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan', hasActions: false,
    content: '七日計畫詳細文字，只用於純文字模式',
    route: '/classroom',
    plan: {
      title: '接下來七天的學習行動',
      overview: '上次主動同步：10/27。只使用已授權資料。',
      checkedAt,
      limitations: ['尚未接通正式課表來源。'],
      steps: [{
        id: 'assignment-0',
        title: '資訊管理期末報告',
        detail: '核對課程頁面的截止日與繳交狀態。',
        priority: 'verify',
        evidence: 'authorized-assignments',
        route: '/classroom',
      }],
    },
  });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('未來七天')));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device',
    senseSnapshot: sensed,
    messages: [{ role: 'user', content: '依手機課表與授權作業安排接下來七天的學習計畫' }],
  }));
  expect(view.getByText('接下來七天的學習行動')).toBeTruthy();
  expect(view.getByText('資訊管理期末報告')).toBeTruthy();
  expect(view.getByText('依據：已授權作業摘要')).toBeTruthy();
  expect(view.queryByText('七日計畫詳細文字，只用於純文字模式')).toBeNull();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();

  fireEvent.press(view.getByText('開啟課程與作業核對'));
  expect(navigate).toHaveBeenCalledWith('學習', {
    screen: 'CoursesHome', params: undefined,
  });
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test('an idle campus sense dashboard expires automatically rather than showing stale data as synced', async () => {
  const syncedAt = new Date().toISOString();
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce({
    userId: 'A', schoolId: 'pu', checkedAt: syncedAt,
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 1, items: [] },
    announcements: { status: 'available', items: [] },
  });

  // Capture the real screen expiry timer without replacing React Native timers.
  const scheduled = jest.spyOn(global, 'setTimeout');
  let afterExpiry: jest.SpyInstance | undefined;
  try {
    const view = render(<CampusAssistantScreen />);
    openCampusTools(view);
    await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
    expect(view.getByText('已取得本次授權資料')).toBeTruthy();

    const timeout = scheduled.mock.calls.find(
      ([callback, delay]) => typeof callback === 'function' &&
        typeof delay === 'number' && delay >= 14 * 60 * 1000,
    )?.[0];
    expect(typeof timeout).toBe('function');

    afterExpiry = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(syncedAt) + 15 * 60 * 1000 + 1000,
    );
    await act(async () => (timeout as () => void)());
    expect(view.queryByText('已取得本次授權資料')).toBeNull();
    expect(view.getByText('校園摘要已過期，請重新同步')).toBeTruthy();
    view.unmount();
  } finally {
    afterExpiry?.mockRestore();
    scheduled.mockRestore();
  }
});

test('one-tap weekly plan still uses local timetable when the campus is offline', async () => {
  jest.mocked(refreshCampusSenseSnapshot).mockRejectedValueOnce(new Error('network-unavailable'));
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan',
    content: '只根據本機課表建立七日計畫',
    hasActions: false,
    plan: {
      title: '接下來七天的學習行動',
      overview: '只使用手機內已保存課表。',
      checkedAt: new Date().toISOString(),
      limitations: ['沒有可確認的授權作業摘要。'],
      steps: [{
        id: 'timetable-review',
        title: '手機保存課表',
        detail: '此為本地副本，不是校方即時課表。',
        priority: 'normal', evidence: 'saved-timetable',
        route: '/timetable',
      }],
    },
  });
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('未來七天')));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device', senseSnapshot: null,
    messages: [{ role: 'user', content: '依手機課表與授權作業安排接下來七天的學習計畫' }],
  }));
  expect(view.getByText('手機保存課表')).toBeTruthy();
  expect(view.getByText(/連線失敗，改用手機已保存的個人課表/)).toBeTruthy();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test('a temporary network error reuses only a recent, authorized in-memory sense', async () => {
  const sensed = {
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable' as const, count: null },
    assignments: { status: 'available' as const, count: 1,
      items: [{ title: '已授權作業', groupName: '資管', dueAt: null }] },
    announcements: { status: 'available' as const, items: [] },
  };
  jest.mocked(refreshCampusSenseSnapshot)
    .mockResolvedValueOnce(sensed)
    .mockRejectedValueOnce(new Error('offline'));
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-snapshot',
    content: '依上次有效快照整理今日作業', hasActions: false,
  });
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('今日重點')));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device',
    senseSnapshot: sensed,
  }));
  expect(view.getByText(/改用先前已授權且未過期的摘要/)).toBeTruthy();
  expect(view.getByText('依上次有效快照整理今日作業')).toBeTruthy();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test('a denied campus permission drops the old snapshot even when it was recently valid', async () => {
  const sensed = {
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable' as const, count: null },
    assignments: { status: 'available' as const, count: 1,
      items: [{ title: '需授權的作業', groupName: '學程', dueAt: null }] },
    announcements: { status: 'available' as const, items: [] },
  };
  const denied = Object.assign(new Error('Member no longer authorized'), {
    code: 'functions/permission-denied',
  });
  jest.mocked(refreshCampusSenseSnapshot)
    .mockResolvedValueOnce(sensed)
    .mockRejectedValueOnce(denied);
  request.mockResolvedValueOnce({
    content: '只根據手機課表回覆', tool: 'campus-plan',
    source: 'device', hasActions: false,
  });
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(view.getByText('已取得本次授權資料')).toBeTruthy();
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('今日重點')));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device', senseSnapshot: null,
  }));
  expect(view.queryByText('已取得本次授權資料')).toBeNull();
  expect(view.getByText(/權限或資料無法驗證，已捨棄校園摘要/)).toBeTruthy();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

test('source-verified assignment requires review and confirmation before a local reminder exists', async () => {
  const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const checkedAt = new Date().toISOString();
  const sense = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '可信任的期末報告', groupName: '資訊管理', dueAt,
        source: { kind: 'group-assignment' as const, groupId: 'course', assignmentId: 'work' } }],
    },
    announcements: { status: 'unavailable' as const, items: [] },
  };
  const step = {
    id: 'assignment-0', title: '可信任的期末報告',
    groupName: '資訊管理', dueAt, priority: 'normal',
    evidence: 'authorized-assignments', route: '/classroom',
    detail: '請核對作業頁面的截止與繳交狀態。',
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sense);
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan', hasActions: false,
    content: '任務規劃',
    plan: {
      title: '今日優先行動', overview: '上次主動同步',
      checkedAt, limitations: [], steps: [step],
    },
  });
  jest.mocked(scheduleCampusAssignmentReminder).mockResolvedValueOnce({
    outcome: 'scheduled', triggerAt: new Date(Date.parse(dueAt) - 86400000).toISOString(),
  });
  jest.mocked(cancelCampusAssignmentReminder).mockResolvedValueOnce(true);

  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天要先處理什麼？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));

  expect(view.getByText('可信任的期末報告')).toBeTruthy();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('設定手機本機截止提醒'));
  expect(view.getByText('確認設定本機提醒')).toBeTruthy();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('1 天前'));
  await act(async () => fireEvent.press(view.getByText('確認設定本機提醒')));

  await waitFor(() => expect(scheduleCampusAssignmentReminder).toHaveBeenCalledTimes(1));
  expect(jest.mocked(scheduleCampusAssignmentReminder).mock.calls[0][0]).toMatchObject({
    scope: { uid: 'A', schoolId: 'pu' },
    snapshot: sense,
    leadMinutes: 1440,
    step: { title: '可信任的期末報告', dueAt, evidence: 'authorized-assignments' },
  });
  expect(view.getByText('本機提醒已排程成功，這不會提交作業或修改校務資料。')).toBeTruthy();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  jest.mocked(getCampusAssignmentReminderStatus).mockResolvedValueOnce([1440]);
  await act(async () => fireEvent.press(view.getByText('取消這項本機提醒')));
  expect(cancelCampusAssignmentReminder).toHaveBeenCalledWith(expect.objectContaining({
    scope: { uid: 'A', schoolId: 'pu' }, leadMinutes: 1440,
  }));
});


test('an already scheduled local reminder is restored when reopening the assistant', async () => {
  const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const checkedAt = new Date().toISOString();
  const sense = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '可信任的期末報告', groupName: '資訊管理', dueAt,
        source: { kind: 'group-assignment' as const, groupId: 'course', assignmentId: 'work' } }],
    },
    announcements: { status: 'unavailable' as const, items: [] },
  };
  const step = {
    id: 'assignment-0', title: '可信任的期末報告',
    groupName: '資訊管理', dueAt, priority: 'normal',
    evidence: 'authorized-assignments', route: '/classroom',
    detail: '請核對作業頁面的截止與繳交狀態。',
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sense);
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan', hasActions: false,
    content: '任務規劃',
    plan: {
      title: '今日優先行動', overview: '上次主動同步',
      checkedAt, limitations: [], steps: [step],
    },
  });
  jest.mocked(getCampusAssignmentReminderStatus).mockResolvedValue([60]);
  jest.mocked(cancelCampusAssignmentReminder).mockResolvedValueOnce(true);
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天要先處理什麼？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await waitFor(() => expect(view.getByText('已設定截止前 1 小時提醒')).toBeTruthy());
  expect(view.queryByText('設定手機本機截止提醒')).toBeNull();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('取消這項本機提醒')));
  expect(cancelCampusAssignmentReminder).toHaveBeenCalledTimes(1);
  expect(view.getByText('已退訂並清除提醒偏好，撤回或延期後也不會自動恢復。')).toBeTruthy();
});

test('unverified OS reminder status blocks scheduling until a successful recheck', async () => {
  const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const checkedAt = new Date().toISOString();
  const sense = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '可信任的期末報告', groupName: '資訊管理', dueAt,
        source: { kind: 'group-assignment' as const, groupId: 'course', assignmentId: 'work' } }],
    },
    announcements: { status: 'unavailable' as const, items: [] },
  };
  const step = {
    id: 'assignment-0', title: '可信任的期末報告',
    groupName: '資訊管理', dueAt, priority: 'normal',
    evidence: 'authorized-assignments', route: '/classroom',
    detail: '請核對作業頁面的截止與繳交狀態。',
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sense);
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan', hasActions: false,
    content: '任務規劃',
    plan: {
      title: '今日優先行動', overview: '上次主動同步',
      checkedAt, limitations: [], steps: [step],
    },
  });
  jest.mocked(getCampusAssignmentReminderStatus)
    .mockRejectedValueOnce(new Error('Native inventory unavailable'))
    .mockResolvedValueOnce([]);
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天要先處理什麼？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await waitFor(() => expect(view.getByText(/無法確認裝置提醒狀態/)).toBeTruthy());
  expect(view.queryByText('設定手機本機截止提醒')).toBeNull();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('重新確認本機提醒狀態')));
  await waitFor(() => expect(view.getByText('設定手機本機截止提醒')).toBeTruthy());
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
});
test('no real due time means the agent never offers a notification action', async () => {
  const checkedAt = new Date().toISOString();
  const sense = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '沒有截止日期的練習', groupName: '資料庫', dueAt: null }],
    },
    announcements: { status: 'unavailable' as const, items: [] },
  };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(sense);
  request.mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan', hasActions: false,
    content: '有限資訊',
    plan: {
      title: '今日優先行動', overview: '上次主動同步',
      checkedAt, limitations: ['來源沒有截止日期'],
      steps: [{
        id: 'assignment-0', title: '沒有截止日期的練習',
        priority: 'verify', evidence: 'authorized-assignments',
        route: '/classroom', detail: '需核對正式截止時間。',
      }],
    },
  });
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天要做什麼？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.getByText('沒有截止日期的練習')).toBeTruthy();
  expect(view.queryByText('設定手機本機截止提醒')).toBeNull();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
});

test('tapping a result retains the unsent draft and opens only the selected source; a reminder still needs confirmation', async () => {
  const checkedAt = new Date().toISOString();
  const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const items = ['資料庫設計', '資料庫管理'].map((groupName, index) => ({
    title: '期中報告', groupName, dueAt,
    source: { kind: 'group-assignment' as const, groupId: 'db' + index, assignmentId: 'report' },
  }));
  const snapshot = { userId: 'A', schoolId: 'pu', checkedAt,
    assignments: { status: 'available' as const, count: 2, items },
    announcements: { status: 'available' as const, items: [] }, schedule: { status: 'unavailable' as const, count: null } };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot);
  const assignmentRead = { userId: 'A', schoolId: 'pu', checkedAt, items, filterQuestion: '期中報告何時交？' };
  const reply = { source: 'device', tool: 'campus-snapshot', content: '有兩份同名報告', route: '/classroom', hasActions: false };
  request.mockResolvedValueOnce({ ...reply, assignmentRead });
  request.mockResolvedValueOnce({ ...reply, content: '資料庫管理的報告', assignmentRead: { ...assignmentRead, items: [items[1]], reviewReminder: true } });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  const field = view.getByLabelText('詢問校園助理');
  fireEvent.changeText(field, '期中報告何時交？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  fireEvent.changeText(field, '還在輸入的問題');
  expect(view.getByRole('button', { name: '選擇第 1 筆，資料庫設計，期中報告' })).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '選擇第 2 筆，資料庫管理，期中報告' })));
  const turns = request.mock.calls[1][0].messages;
  expect(turns[1].assignmentRead).toEqual(assignmentRead);
  expect(turns[2]).toEqual({ role: 'user', content: '第 2 筆' });
  expect(field.props.value).toBe('還在輸入的問題');
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).toHaveBeenCalledWith('學習', { screen: 'HomeworkSubmit', params: { groupId: 'db1', assignmentId: 'report' } });
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  expect(view.getByText('確認設定本機提醒')).toBeTruthy();
});

test('moves between assignment pages without sending the draft and keeps the back button on a one-row last page', async () => {
  const checkedAt = new Date().toISOString();
  const items = Array.from({ length: 9 }, (_, i) => ({ title: '練習 ' + (i + 1), groupName: '資料庫', dueAt: null }));
  const snapshot = { userId: 'A', schoolId: 'pu', checkedAt,
    assignments: { status: 'available' as const, count: items.length, items },
    announcements: { status: 'available' as const, items: [] }, schedule: { status: 'unavailable' as const, count: null } };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot);
  const question = '我有哪些待交作業？';
  const page = (offset: number) => ({
    source: 'device', tool: 'campus-snapshot', content: '已同步的作業', hasActions: false,
    assignmentRead: { userId: 'A', schoolId: 'pu', checkedAt, filterQuestion: question, items: items.slice(offset, offset + 8),
      page: { question, offset, total: items.length, asOf: Date.parse(checkedAt) } },
  });
  request.mockResolvedValueOnce(page(0)).mockResolvedValueOnce(page(8)).mockResolvedValueOnce(page(0));
  const view = render(<CampusAssistantScreen />);
  openCampusTools(view);
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  fireEvent.press(view.getByText('對話'));
  const field = view.getByLabelText('詢問校園助理');
  fireEvent.changeText(field, question);
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  fireEvent.changeText(field, '待會再問的問題');
  expect(view.queryByText('上一頁作業')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('下一頁作業')));
  expect(request.mock.calls[1][0].messages.at(-1).content).toBe('下一頁');
  expect(view.queryByText('下一頁作業')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('上一頁作業')));
  expect(request.mock.calls[2][0].messages.at(-1).content).toBe('上一頁');
  expect(view.getByRole('button', { name: '選擇本頁第 2 筆，資料庫，練習 2' })).toBeTruthy();
  expect(field.props.value).toBe('待會再問的問題');
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
});

test('the next-class shortcut opens the selected occurrence in its own term and account', async () => {
  const navigate = jest.fn();
  const first = { courseId: 'manual:a', term: '115|1', name: '專題', room: 'A301',
    date: '2026-11-05', startTime: '10:10', endTime: '12:00' };
  const second = { ...first, courseId: 'manual:b', room: 'B203' };
  request.mockResolvedValue({ content: '兩堂專題', source: 'device', tool: 'saved-timetable',
    savedClassRead: { uid: 'A', schoolId: 'pu', classes: [first, second], updatedAt: null } });
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  await act(async () => fireEvent.press(view.getByText('查下一堂課')));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toMatchObject({
    mode: 'device', messages: [{ role: 'user', content: '下一堂課是什麼？' }],
  });
  expect(view.getByText('同時段有多堂課')).toBeTruthy();
  expect(view.queryByText('開啟我的課表')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: /在課表中查看專題.*B203/ }));
  expect(navigate).toHaveBeenCalledWith('學習', { screen: 'PersonalTimetable', params: {
    schoolId: 'pu', courseId: second.courseId, date: second.date, term: second.term,
    startAt: Date.parse('2026-11-05T10:10:00+08:00'), reminderScope: JSON.stringify({ owner: 'firebase:A', schoolId: 'pu' }),
  } });
  mockSchool = 'other';
  view.rerender(<CampusAssistantScreen navigation={{ navigate }} />);
  expect(view.queryByText('B203')).toBeNull();
});

test.each([false, true])('puts the imminent class first only when the timetable hint confirms it (%s)', (upcoming) => {
  mockUpcomingClass = upcoming;
  const view = render(<CampusAssistantScreen />);
  const choices = view.getAllByRole('button', { name: /^(現在有課嗎？|查下一堂課)$/ });
  expect(choices).toHaveLength(2);
  expect(choices[0]).toBe(view.getByRole('button', { name: upcoming ? '查下一堂課' : '現在有課嗎？' }));
});

test('one tap on current class checks the device and can open a staggered overlap by its original start', async () => {
  const navigate = jest.fn();
  const first = { courseId: 'manual:a', term: '115|1', name: '資料結構', room: 'A301',
    date: '2026-11-05', startTime: '09:10', endTime: '11:00' };
  const second = { ...first, courseId: 'manual:b', name: '資料庫', room: 'B203', startTime: '10:10' };
  request.mockResolvedValue({ content: '課程時段重疊', source: 'device', tool: 'saved-timetable',
    savedClassRead: { uid: 'A', schoolId: 'pu', classes: [first, second], updatedAt: null, currentAt: '2026-11-05T02:25:00Z' } });
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '現在有課嗎？' })));
  expect(request.mock.calls[0][0]).toMatchObject({ mode: 'device', messages: [{ role: 'user', content: '我現在有課嗎？' }] });
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  expect(view.getByText('這個時段有 2 堂課')).toBeTruthy();
  expect(view.getByText('查詢時間 2026/11/5 上午10:25（台灣時間）')).toBeTruthy();
  expect(view.queryByText('下一堂課')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: /在課表中查看資料庫.*10:10–11:00.*B203/ }));
  expect(navigate).toHaveBeenCalledWith('學習', { screen: 'PersonalTimetable', params: {
    schoolId: 'pu', courseId: second.courseId, date: second.date, term: second.term,
    startAt: Date.parse('2026-11-05T10:10:00+08:00'), reminderScope: JSON.stringify({ owner: 'firebase:A', schoolId: 'pu' }),
  } });
});

test('a verified free period offers the next class without erasing an unsent draft', async () => {
  const navigate = jest.fn();
  request.mockResolvedValueOnce({ content: '此時沒有排課', source: 'device', tool: 'saved-timetable',
    route: '/timetable', savedClassRead: { uid: 'A', schoolId: 'pu', classes: [], updatedAt: null, currentAt: '2026-11-05T02:25:00Z' } })
    .mockResolvedValueOnce({ content: '尚未排定接下來的課程', source: 'device', tool: 'saved-timetable', route: '/timetable' });
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '現在有課嗎？' })));
  expect(view.getByText('這個時段沒有排課')).toBeTruthy();
  expect(view.getByText('查詢時間 2026/11/5 上午10:25（台灣時間）')).toBeTruthy();
  expect(view.getByRole('button', { name: '開啟我的課表' })).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '準備明天的考試');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查下一堂課' })));
  expect(request.mock.calls[1][0].messages.at(-1)).toEqual({ role: 'user', content: '下一堂課是什麼？' });
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('準備明天的考試');
});

test('unavailable evidence displays its explanation and offers the timetable without declaring a free period', async () => {
  request.mockResolvedValue({ content: '這台手機目前無法確認這個時段的課程。', source: 'device', tool: 'saved-timetable', route: '/timetable' });
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '現在有課嗎？' })));
  expect(view.getByText('這台手機目前無法確認這個時段的課程。')).toBeTruthy();
  expect(view.getByRole('button', { name: '開啟我的課表' })).toBeTruthy();
  expect(view.queryByText('這個時段沒有排課')).toBeNull();
});

test('a failed next-class shortcut retries the original read in one tap', async () => {
  request.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({
    content: '請核對本學期與上課時間。', tool: 'saved-timetable', source: 'device', route: '/timetable',
  });
  const view = render(<CampusAssistantScreen />);
  await act(async () => fireEvent.press(view.getByText('查下一堂課')));
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('');
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重試「下一堂課是什麼？」' })));
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0].messages).toEqual([{ role: 'user', content: '下一堂課是什麼？' }]);
  expect(view.getByText('請核對本學期與上課時間。')).toBeTruthy();
});

test('an unresolved or active platform session cannot open the campus account timetable', async () => {
  const view = render(<CampusAssistantScreen />);
  expect(view.getByText('查下一堂課')).toBeTruthy();
  mockPlatform = { loading: true };
  await act(async () => view.rerender(<CampusAssistantScreen />));
  expect(view.queryByText('查下一堂課')).toBeNull();
  expect(view.queryByText('現在有課嗎？')).toBeNull();
  mockPlatform = { session: { platformAccountId: 'student-b' } };
  await act(async () => view.rerender(<CampusAssistantScreen />));
  expect(view.queryByText('查下一堂課')).toBeNull();
  expect(view.queryByText('現在有課嗎？')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

const platformRoute = { name: 'NuniTimetableAssistant' };

function setPlatformFixture(accountId: string, context = 'context-a') {
  mockPlatform = {
    session: { platformAccountId: accountId, context },
    isSessionCurrent: (id, captured) =>
      id === mockPlatform?.session?.platformAccountId && captured === mockPlatform.session?.context,
    request: jest.fn(async () => ({})),
    bffRequest: jest.fn(async () => ({})),
  };
}

test('platform lookup, room follow-up and exact class link use the same nuni owner with no Firebase features', async () => {
  setPlatformFixture('student-b');
  const item = { courseId: 'manual:n1', term: '115|1', name: '平台帳號的專題', room: 'A301',
    date: '2026-11-05', startTime: '10:10', endTime: '12:00' };
  const read = { uid: '', owner: 'nuni:student-b', schoolId: 'pu', classes: [item], updatedAt: null };
  request.mockResolvedValueOnce({ content: item.name, source: 'device', tool: 'saved-timetable', savedClassRead: read })
    .mockResolvedValueOnce({ content: item.room, source: 'device', tool: 'saved-timetable', savedClassRead: { ...read, focus: 'room' } });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen route={platformRoute} navigation={{ navigate, getState: () => ({ routeNames: ['PersonalTimetable', 'PersonalImport'] }) }} />);
  expect(view.getByText('課業助理')).toBeTruthy();
  expect(view.getByRole('tab', { name: '已儲存計畫' })).toBeTruthy();
  expect(view.getByText('整理今日重點')).toBeTruthy();
  expect(view.queryByText('下載／管理免費 AI 模型')).toBeNull();
  expect(getOnDeviceAssistantReadiness).not.toHaveBeenCalled();
  const field = view.getByLabelText('詢問校園助理');
  await act(async () => fireEvent.press(view.getByText('查下一堂課')));
  const call = request.mock.calls[0][0];
  expect(call.scope).toEqual({ uid: '', schoolId: 'pu' });
  expect(call.platformTimetable.accountId).toBe('student-b');
  expect(call.platformTimetable.isCurrent()).toBe(true);
  expect(call).not.toHaveProperty('senseSnapshot');
  fireEvent.changeText(field, '接著要問的問題');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '在哪間教室？' })));
  expect(request.mock.calls[1][0].messages[1].savedClassRead).toEqual(read);
  expect(field.props.value).toBe('接著要問的問題');
  fireEvent.press(view.getAllByRole('button', { name: /在課表中查看平台帳號的專題/ })[1]);
  expect(navigate).toHaveBeenLastCalledWith('PersonalTimetable', {
    schoolId: 'pu', courseId: item.courseId, date: item.date, term: item.term,
    startAt: Date.parse('2026-11-05T10:10:00+08:00'), reminderScope: JSON.stringify({ owner: read.owner, schoolId: 'pu' }),
  });
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
});

test('switching to a nuni timetable during announcement sync cannot expose the Firebase result or start a second sync', async () => {
  const pending = deferred<Awaited<ReturnType<typeof refreshCampusSenseSnapshot>>>();
  jest.mocked(refreshCampusSenseSnapshot).mockReturnValueOnce(pending.promise);
  const view = render(<CampusAssistantScreen />);
  fireEvent.press(view.getByText('同步並查今日公告'));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);

  setPlatformFixture('student-b');
  await act(async () => view.rerender(<CampusAssistantScreen route={platformRoute} />));
  await act(async () => pending.resolve({
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    announcements: { status: 'available', items: [{ title: '校園帳號的公告', publishedAt: null }] },
    assignments: { status: 'unavailable', count: null, items: [] },
    schedule: { status: 'unavailable', count: null },
  }));
  expect(view.getByText('課業助理')).toBeTruthy();
  expect(view.queryByText(/查今日公告/)).toBeNull();
  expect(view.queryByText('校園帳號的公告')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
});

test('a platform session replacement discards pending results even for the same platform account', async () => {
  setPlatformFixture('student-b');
  const response = deferred<object>();
  request.mockReturnValue(response.promise);
  const view = render(<CampusAssistantScreen route={platformRoute} />);
  fireEvent.press(view.getByText('現在有課嗎？'));
  const claim = request.mock.calls[0][0].platformTimetable;
  setPlatformFixture('student-b', 'context-new');
  expect(claim.isCurrent()).toBe(false);
  view.rerender(<CampusAssistantScreen route={platformRoute} />);
  await act(async () => response.resolve({ content: '舊學生的課表', source: 'device' }));
  expect(view.queryByText('舊學生的課表')).toBeNull();
  expect(view.getByText('現在有課嗎？')).toBeTruthy();
});

test('a missing nuni timetable opens the public import screen; unrelated questions expose no unregistered service shortcut', async () => {
  setPlatformFixture('student-b');
  request.mockResolvedValueOnce({ content: '請匯入這個帳號的課表', source: 'device', tool: 'saved-timetable', route: '/timetable/import' })
    .mockResolvedValueOnce({ content: '可查現在或下一堂課。', source: 'device', tool: 'saved-timetable' });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen route={platformRoute} navigation={{ navigate, getState: () => ({ routeNames: ['PersonalImport'] }) }} />);
  await act(async () => fireEvent.press(view.getByText('現在有課嗎？')));
  fireEvent.press(view.getByRole('button', { name: '匯入課表' }));
  expect(navigate).toHaveBeenCalledWith('PersonalImport', { kind: 'timetable' });
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '公車');
  expect(view.queryByText('前往公車')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.queryByText('查看公車')).toBeNull();
});

test('the general assistant keeps its model tools and masks the Firebase timetable while a nuni account is active', async () => {
  setPlatformFixture('student-b');
  const view = render(<CampusAssistantScreen route={{ name: 'CampusAssistant' }} />);
  expect(view.queryByText('現在有課嗎？')).toBeNull();
  openCampusTools(view);
  expect(view.getByText('下載／管理免費 AI 模型')).toBeTruthy();
  expect(getOnDeviceAssistantReadiness).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test('the nuni course action opens a specific assignment and keeps a typed draft intact', async () => {
  setPlatformFixture('student-b');
  const navigate = jest.fn();
  const item = { courseId: 'import:x', term: '115|1', name: '資訊管理', room: 'A302',
    date: '2026-11-05', startTime: '10:10', endTime: '12:00' };
  const anchor = { uid: '', owner: 'nuni:student-b', schoolId: 'pu', classes: [item], updatedAt: null };
  request.mockResolvedValueOnce({ content: item.name, source: 'device', savedClassRead: anchor })
    .mockResolvedValueOnce({ content: '這堂課的作業', source: 'device', courseworkRead: {
      anchor, checkedAt: '2026-11-05T02:30:00Z', result: {
        kind: 'assignments', workspace: { id: 'work-id', title: '資訊管理' }, limited: false,
        assignments: [{ id: 'assign-id', title: '小考報告', dueAt: null, state: 'closed', submittedAt: null }],
      },
    } });
  const screen = render(<CampusAssistantScreen route={platformRoute}
    navigation={{ navigate, getState: () => ({ routeNames: ['NuniWorkspace', 'PersonalImport', 'PersonalTimetable'] }) }} />);
  await act(async () => fireEvent.press(screen.getByText('查下一堂課')));
  const input = screen.getByLabelText('詢問校園助理');
  fireEvent.changeText(input, '保留我的草稿');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: '查這堂課的作業' })));
  expect(input.props.value).toBe('保留我的草稿');
  fireEvent.press(screen.getByRole('button', { name: /查看作業：小考報告，已停止收件 · 未見繳交紀錄/ }));
  expect(navigate).toHaveBeenCalledWith('NuniWorkspace', {
    tab: 'courses', workspaceId: 'work-id', assignmentId: 'assign-id', assistantAccountId: 'student-b',
  });
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
});

test('course choices show reviewed class details, verify the selected ID, and mark an open late assignment as overdue', async () => {
  setPlatformFixture('student-b');
  const anchor = { uid: '', owner: 'nuni:student-b', schoolId: 'pu', updatedAt: null,
    classes: [{ courseId: 'import:x', term: '115|1', name: '資料結構', room: '', date: '2026-11-05', startTime: '10:10', endTime: '12:00' }] };
  const info = { teacher: '林老師', academicYear: '115', semester: '1', schoolId: 'pu', courseCode: 'CS101' };
  const reply = (result: unknown) => ({
    source: 'device', content: '資料結構作業', courseworkRead: { anchor, result, checkedAt: '2026-11-05T02:30:00Z' },
  });
  request.mockResolvedValueOnce(reply({ kind: 'choose', workspaces: [
    { id: 'first', title: '資料結構', reviewed: { ...info, className: '甲班' } },
    { id: 'second', title: '資料結構', reviewed: { ...info, className: '乙班' } },
  ] })).mockResolvedValueOnce(reply({ kind: 'assignments', limited: false, workspace: { id: 'second', title: '資料結構' },
    assignments: [
      { id: 'one', title: '練習一', state: 'open', dueAt: '2026-11-04T04:00:00Z', submittedAt: null },
      { id: 'two', title: '練習二', state: 'open', dueAt: '2026-11-04T04:00:00Z', submittedAt: '2026-11-04T00:00:00Z' },
      { id: 'three', title: '練習三', state: 'open', dueAt: '2026-11-06T04:00:00Z', submittedAt: null },
    ],
  }));
  const view = render(<CampusAssistantScreen route={platformRoute} />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '這堂課有什麼作業？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  await act(async () => fireEvent.press(view.getByRole('button', { name: /資料結構.*115學年度.*乙班.*林老師/ })));
  expect(request.mock.calls[1][0].courseworkChoice).toEqual({ workspaceId: 'second' });
  expect(view.getByRole('button', { name: /查看作業：練習一，已逾期 · 未見繳交紀錄/ })).toBeTruthy();
  expect(view.getByRole('button', { name: /查看作業：練習二，已繳交/ })).toBeTruthy();
  expect(view.getByRole('button', { name: /查看作業：練習三，仍在收件 · 未見繳交紀錄/ })).toBeTruthy();
  expect(view.queryAllByRole('button', { name: /(?:已逾期|已停止收件) · 未繳交/ })).toHaveLength(0);
});

describe('class assignment follow-ups in the nuni timetable assistant', () => {
  const anchor = { uid: '', owner: 'nuni:student-b', schoolId: 'pu', updatedAt: null,
    classes: [{ courseId: 'import:db', term: '115|1', name: '資料庫', room: 'A2', date: '2026-11-05', startTime: '10:10', endTime: '12:00' }] };
  const result = { kind: 'assignments' as const, limited: true, workspace: { id: 'db-class', title: '資料庫' },
    assignments: [
      { id: 'first', title: '週記', state: 'open' as const, dueAt: '2026-11-04T00:00:00Z', submittedAt: null },
      { id: 'second', title: '週記', state: 'open' as const, dueAt: '2026-11-06T12:00:00Z', submittedAt: '2026-11-04T05:20:55Z' },
    ] };
  const checkedAt = '2026-11-05T01:45:00Z';
  const reply = (extra: object = {}) => ({
    source: 'device', content: '資料庫的課堂作業', courseworkRead: { anchor, checkedAt, result, ...extra },
  });
  beforeEach(() => setPlatformFixture('student-b'));

  test('shows Taipei times both before and after confirmation and accepts just one tap while scheduling', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(checkedAt));
    try {
      const work = { ...result, assignments: [{ ...result.assignments[1], submittedAt: null }] };
      const card = (value: object) => reply({ result: work, view: { kind: 'reminder', action: 'set',
        ids: ['second'], minutes: 60, ...value } });
      let finish!: (value: unknown) => void;
      request.mockResolvedValueOnce(reply({ result: work }))
        .mockResolvedValueOnce(card({ step: 'review', message: '請核對作業和提醒時間。' }))
        .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const screen = render(<CampusAssistantScreen route={platformRoute} />);
      fireEvent.changeText(screen.getByLabelText('詢問校園助理'), '這堂課有什麼作業？');
      await act(async () => fireEvent.press(screen.getByText('送出問題')));
      await act(async () => fireEvent.press(screen.getByRole('button', { name: '提醒我交這份' })));
      expect(screen.getByText('台灣時間')).toBeTruthy();
      expect(screen.getByText('截止時間 · 2026/11/6 下午8:00')).toBeTruthy();
      expect(screen.getByLabelText('提醒時間，2026/11/6 下午7:00，台灣時間')).toBeTruthy();
      expect(screen.getByText('提醒時間 · 2026/11/6 下午7:00')).toBeTruthy();
      expect(screen.getByRole('radio', { name: '提前 1 小時', checked: true })).toBeTruthy();
      expect(request.mock.calls[1][0].courseworkChoice).toBeUndefined();
      const confirm = screen.getByRole('button', { name: '確認設定提醒' });
      await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
      expect(request).toHaveBeenCalledTimes(3);
      expect(request.mock.calls[2][0].courseworkChoice).toEqual({ reminder: 'confirm', id: 'second' });
      expect(screen.queryByRole('button', { name: '取消作業查詢' })).toBeNull();
      await act(async () => finish(card({ step: 'result', next: 'remove', message: '已設定這份作業的手機提醒。' })));
      expect(screen.getByText('已設定這份作業的手機提醒。')).toBeTruthy();
      expect(screen.getAllByText('提醒時間 · 2026/11/6 下午7:00')).toHaveLength(2);
      expect(screen.getByRole('button', { name: '取消這份作業的提醒' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '確認設定提醒' })).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  test('clarifies same-title receipts, preserves exact selection, keeps the time of the source read and opens that assignment', async () => {
    const navigate = jest.fn();
    request.mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({ view: { kind: 'choose-receipt', ids: ['first', 'second'], message: '請選擇要核對的作業。' } }))
      .mockResolvedValueOnce(reply({ view: { kind: 'receipt', ids: ['second'], message: '週記有繳交紀錄。' } }))
      .mockResolvedValueOnce(reply());
    const screen = render(<CampusAssistantScreen route={platformRoute}
      navigation={{ navigate, getState: () => ({ routeNames: ['NuniWorkspace'] }) }} />);
    const input = screen.getByLabelText('詢問校園助理');
    fireEvent.changeText(input, '這堂課有什麼作業？');
    await act(async () => fireEvent.press(screen.getByText('送出問題')));
    fireEvent.changeText(input, '保留草稿');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '我交了嗎？' })));
    expect(screen.getByText('請選擇要核對的作業。')).toBeTruthy();
    const second = screen.getByRole('button', { name: /選擇作業：第 2 份，週記，截止.*11\/6/ });
    await act(async () => fireEvent.press(second));
    expect(request.mock.calls[2][0].courseworkChoice).toEqual({ assignmentId: 'second' });
    expect(screen.getByText(/繳交於 .*11\/4.*20:55/)).toBeTruthy();
    expect(input.props.value).toBe('保留草稿');
    fireEvent.press(screen.getByRole('button', { name: /查看作業：週記，已繳交.*繳交於/ }));
    expect(navigate).toHaveBeenLastCalledWith('NuniWorkspace', {
      tab: 'courses', workspaceId: 'db-class', assignmentId: 'second', assistantAccountId: 'student-b',
    });
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '回到這門課的作業' })));
    expect(request.mock.calls[3][0].messages.at(-1).content).toBe('回到這門課的作業');
    expect(screen.getAllByRole('button', { name: /^查看作業：週記/ })).toHaveLength(2);
  });

  test('prioritization displays only the identified assignment and keeps the capped-source notice', async () => {
    request.mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(reply({ view: { kind: 'priority', ids: ['first'], message: '最早逾期、仍在收件的作業。' } }));
    const screen = render(<CampusAssistantScreen route={platformRoute} />);
    fireEvent.changeText(screen.getByLabelText('詢問校園助理'), '這門課有哪些作業？');
    await act(async () => fireEvent.press(screen.getByText('送出問題')));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '哪個最急？' })));
    expect(screen.getByText('優先處理的作業')).toBeTruthy();
    expect(screen.getByText('最早逾期、仍在收件的作業。')).toBeTruthy();
    expect(screen.getAllByText(/已達平台單次查詢上限/)).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^查看作業：週記/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^查看作業：週記，已逾期/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '我交了嗎？' })).toBeTruthy();
  });

  test('a changed assignment only offers a fresh read, keeps its exact destination and suppresses a stale receipt claim', async () => {
    request.mockResolvedValueOnce(reply({ changedAssignmentId: 'first', openedAssignmentId: 'first',
      view: { kind: 'receipt', ids: ['first'], message: '舊的收據回答' } }))
      .mockResolvedValueOnce(reply());
    const screen = render(<CampusAssistantScreen route={platformRoute} />);
    fireEvent.changeText(screen.getByLabelText('詢問校園助理'), '這門課有哪些作業？');
    await act(async () => fireEvent.press(screen.getByText('送出問題')));
    expect(screen.getByText('作業已更新，這是上次查詢的紀錄。')).toBeTruthy();
    expect(screen.queryByText('舊的收據回答')).toBeNull();
    expect(screen.queryByRole('button', { name: '我交了嗎？' })).toBeNull();
    expect(screen.queryByRole('button', { name: '哪個最急？' })).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: '重新核對繳交紀錄' })));
    expect(request.mock.calls[1][0].courseworkChoice).toEqual({ refreshAssignmentId: 'first' });
  });
});

test.each([false, true])('today’s announcement shortcut uses the indicated source and opens the selected record (already synced: %s)', async (synced) => {
  const title = '選課異動公告';
  const items = [
    { title, publishedAt: '2026-11-04T10:00:00Z', source: { kind: 'school-announcement' as const, id: 'same' } },
    { title, publishedAt: '2026-11-04T11:00:00Z', source: { kind: 'legacy-announcement' as const, id: 'same' } },
  ];
  const checkedAt = new Date().toISOString();
  const snapshot = { userId: 'A', schoolId: 'pu', checkedAt,
    announcements: { status: 'available' as const, items },
    assignments: { status: 'unavailable' as const, count: null, items: [] },
    schedule: { status: 'unavailable' as const, count: null } };
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot);
  request.mockResolvedValueOnce({ source: 'device', tool: 'campus-snapshot', content: title + '。' + title,
    route: '/announcements', announcementRead: { userId: 'A', schoolId: 'pu', checkedAt, items, summary: '本次摘要列出 2 則公告。' } });
  const navigation = { navigate: jest.fn(), getState: () => ({ routeNames: ['公告詳情'] }) };
  const view = render(<CampusAssistantScreen navigation={navigation} />);
  if (synced) {
    openCampusTools(view);
    await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
    fireEvent.press(view.getByRole('tab', { name: '對話' }));
  }
  await act(async () => fireEvent.press(view.getByText(synced ? '查今日公告' : '同步並查今日公告')));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ mode: 'device', senseSnapshot: snapshot,
    messages: [{ role: 'user', content: '今天發布了哪些校園公告？' }] }));
  const button = view.getByRole('button', { name: /開啟公告，第 2 則/ });
  fireEvent.press(button);
  expect(navigation.navigate).toHaveBeenCalledWith('公告詳情', { sourceKind: 'legacy-announcement', id: 'same', schoolId: 'pu' });
  openCampusTools(view);
  fireEvent.press(view.getByText('清除本次校園摘要'));
  fireEvent.press(view.getByRole('tab', { name: '對話' }));
  expect(view.queryByRole('button', { name: /開啟公告，第 2 則/ })).toBeNull();
});

function resumablePlan(): CampusEvidencePlan {
  return {
    title: '今日優先行動', overview: '依手機課表與已同步作業整理。',
    checkedAt: '2026-11-06T01:00:00.000Z',
    steps: [
      { id: 'assignment-0', title: '資料庫期末報告', detail: '資料庫｜11/6 23:59 截止。',
        priority: 'urgent', evidence: 'authorized-assignments', route: '/classroom',
        dueAt: '2026-11-06T15:59:00.000Z', groupName: '資料庫' },
      { id: 'timetable-review', title: '核對今天課表', detail: '下午兩堂課，請確認教室。',
        priority: 'normal', evidence: 'saved-timetable', route: '/timetable' },
    ],
    limitations: ['校方資料可能更新，請重新核對。'],
    content: '今日優先行動：資料庫期末報告、核對今天課表。',
  };
}

async function askForSavedPlan(view: ReturnType<typeof render>, plan = resumablePlan()) {
  request.mockResolvedValueOnce({ content: plan.content, source: 'device', tool: 'campus-plan', hasActions: false, plan });
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '今天要先處理什麼？');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '送出問題' })));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
}

test('saves a real plan, resumes after remount, and records personal progress without executing a task', async () => {
  let view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view);
  expect(view.getByText('計畫已儲存')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('');
  view.unmount();
  request.mockClear();
  jest.mocked(getCampusAssignmentReminderStatus).mockClear();

  view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '繼續已儲存的計畫（1）' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  const checkbox = view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' });
  expect(checkbox.props.accessibilityState.checked).toBe(false);
  await act(async () => fireEvent.press(checkbox));
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
  expect(request).not.toHaveBeenCalled();
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  expect(getCampusAssignmentReminderStatus).not.toHaveBeenCalled();
  view.unmount();

  view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  openCampusTools(view);
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
});

test('saved-plan read failures cannot be shown as an empty shelf or a successful save', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk unavailable'));
  const view = render(<CampusAssistantScreen />);
  await act(async () => undefined);
  openCampusTools(view);
  expect(view.getByRole('alert')).toBeTruthy();
  expect(view.queryByText(/尚未儲存計畫/)).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新讀取已儲存計畫' })));
  expect(view.queryByRole('alert')).toBeNull();
  fireEvent.press(view.getByRole('tab', { name: '對話' }));
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await askForSavedPlan(view);
  expect(view.queryByText('計畫已儲存')).toBeNull();
  expect(view.getByRole('button', { name: '儲存這份計畫' })).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  expect(view.getByText('計畫已儲存')).toBeTruthy();
});

test('account and campus switches hide saved plans, while returning to the original scope restores them', async () => {
  const view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view);
  mockUid = 'B';
  view.rerender(<CampusAssistantScreen />);
  await act(async () => undefined);
  expect(view.queryByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeNull();
  expect(view.queryByText('資料庫期末報告')).toBeNull();
  mockUid = 'A'; mockSchool = 'nthu';
  view.rerender(<CampusAssistantScreen />);
  await act(async () => undefined);
  expect(view.queryByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeNull();
  mockSchool = 'pu';
  view.rerender(<CampusAssistantScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
});

test('replanning keeps the old checklist and unsent draft without trusting saved assistant text', async () => {
  let view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view);
  view.unmount();
  request.mockClear();
  view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '等一下問公車');
  fireEvent.press(view.getByRole('button', { name: '繼續已儲存的計畫（1）' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  await act(async () => fireEvent.press(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' })));
  request.mockResolvedValueOnce({ content: '新的規劃，尚未儲存。', source: 'device', hasActions: false });
  jest.mocked(refreshCampusSenseSnapshot).mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
  expect(view.getByText('新的規劃，尚未儲存。')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('等一下問公車');
  expect(request.mock.calls.at(-1)[0].messages).toEqual([{ role: 'user', content: '今天要先處理什麼？' }]);
  expect(request.mock.calls.at(-1)[0].senseSnapshot).toBeNull();
  openCampusTools(view);
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
});

function planWithComparisonEvidence(newer = false): CampusEvidencePlan {
  const plan = resumablePlan();
  plan.checkedAt = newer ? new Date().toISOString() : plan.checkedAt;
  if (newer) {
    plan.steps[0].dueAt = '2026-11-07T15:59:00.000Z';
    plan.steps[0].detail = '資料庫｜11/7 23:59 截止。';
    plan.content = '重新核對後的學習計畫。';
  }
  plan.comparisonBasis = {
    assignments: { status: 'complete', checkedAt: plan.checkedAt, total: 1,
      items: [{ identity: ['database', 'report'], title: plan.steps[0].title,
        groupName: '資料庫', dueAt: plan.steps[0].dueAt! }],
    },
    timetableUpdatedAt: null,
  };
  return plan;
}

async function openSavedPlanForReplanning() {
  let view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view, planWithComparisonEvidence());
  view.unmount();
  request.mockClear();
  view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '等一下問公車');
  fireEvent.press(view.getByRole('button', { name: '繼續已儲存的計畫（1）' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  await act(async () => fireEvent.press(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' })));
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValue({
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 1,
      items: [{ title: '資料庫期末報告', groupName: '資料庫', dueAt: '2026-11-07T15:59:00.000Z',
        source: { kind: 'group-assignment', groupId: 'database', assignmentId: 'report' } }],
      coverage: { complete: true, reason: 'complete', pages: 1 },
    },
    announcements: { status: 'unavailable', items: [] },
  });
  return view;
}

test('replanning shows deadline changes, opens the exact original and saves a separate unchecked plan', async () => {
  const view = await openSavedPlanForReplanning();
  const plan = planWithComparisonEvidence(true);
  request.mockResolvedValueOnce({ content: plan.content, source: 'device', tool: 'campus-plan', hasActions: false, plan });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
  expect(view.getByText('這次調整了什麼')).toBeTruthy();
  expect(view.getByText('截止時間有變動。請開啟作業頁核對。')).toBeTruthy();
  expect(view.getByText('資料庫｜資料庫期末報告\n截止 2026/11/6 23:59')).toBeTruthy();
  expect(view.getByText('資料庫｜資料庫期末報告\n截止 2026/11/7 23:59')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('等一下問公車');
  expect(request.mock.calls.at(-1)[0].messages).toEqual([{ role: 'user', content: '今天要先處理什麼？' }]);
  expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy();

  fireEvent.press(view.getByRole('button', { name: '查看原計畫' }));
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByRole('tab', { name: '對話' }));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  expect(view.getByRole('button', { name: '繼續已儲存的計畫（2）' })).toBeTruthy();
  openCampusTools(view);
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(false);
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
});

test('retrying a failed saved-plan refresh retains the original comparison target', async () => {
  const view = await openSavedPlanForReplanning();
  const plan = planWithComparisonEvidence(true);
  request.mockRejectedValueOnce(new Error('temporary read failure'))
    .mockResolvedValueOnce({ content: plan.content, source: 'device', hasActions: false, plan });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
  expect(view.queryByText('這次調整了什麼')).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新整理今日重點' })));
  expect(view.getByText('這次調整了什麼')).toBeTruthy();
  expect(view.getByRole('button', { name: '查看原計畫' })).toBeTruthy();
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('等一下問公車');
});

test.each(['account', 'school', 'cancel', 'signout'] as const)('a late replan cannot publish saved evidence after %s changes', async (change) => {
  const view = await openSavedPlanForReplanning();
  const plan = planWithComparisonEvidence(true);
  const pending = deferred<Awaited<ReturnType<typeof askCampusAssistant>>>();
  request.mockReturnValueOnce(pending.promise);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
  expect(request).toHaveBeenCalledTimes(1);
  const guard = request.mock.calls[0][0];
  if (change === 'account' || change === 'school') {
    if (change === 'account') mockUid = 'B'; else mockSchool = 'nthu';
    view.rerender(<CampusAssistantScreen />);
  } else if (change === 'cancel') {
    fireEvent.press(view.getByRole('button', { name: '停止本機回答' }));
  } else {
    await act(async () => { await beginSavedCampusPlansSignOutCleanup(); endSavedCampusPlansSignOutCleanup(); });
  }
  expect(guard.signal.aborted || !guard.isCurrent()).toBe(true);
  await act(async () => pending.resolve({ content: plan.content, source: 'device', hasActions: false, plan }));
  expect(view.queryByText('這次調整了什麼')).toBeNull();
  expect(view.queryByText('重新核對後的學習計畫。')).toBeNull();
  expect(view.queryByRole('button', { name: '查看原計畫' })).toBeNull();
});

test('revoking the saved-plan session removes a comparison that is already displayed', async () => {
  const view = await openSavedPlanForReplanning();
  const plan = planWithComparisonEvidence(true);
  request.mockResolvedValueOnce({ content: plan.content, source: 'device', hasActions: false, plan });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
  expect(view.getByText('這次調整了什麼')).toBeTruthy();
  await act(async () => { await beginSavedCampusPlansSignOutCleanup(); endSavedCampusPlansSignOutCleanup(); });
  expect(view.queryByText('這次調整了什麼')).toBeNull();
  expect(view.queryByRole('button', { name: '查看原計畫' })).toBeNull();
});

test('a failed sign-out revokes saved-plan UI and an explicit reload can save again', async () => {
  const view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view);
  await act(async () => {
    await beginSavedCampusPlansSignOutCleanup();
    endSavedCampusPlansSignOutCleanup();
  });
  expect(view.queryByText('計畫已儲存')).toBeNull();
  expect(view.queryByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  expect(view.queryByText('計畫已儲存')).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新載入計畫' })));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  expect(view.getByText('計畫已儲存')).toBeTruthy();
});

test('platform weekly planning uses its captured session and saves a resumable nuni plan without Firebase tools', async () => {
  setPlatformFixture('student-b');
  const plan = planWithComparisonEvidence();
  request.mockResolvedValueOnce({ content: plan.content, source: 'device', tool: 'campus-plan', hasActions: false, plan });
  let view = render(<CampusAssistantScreen route={platformRoute} />);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '規劃未來七天' })));
  const input = request.mock.calls[0][0];
  expect(input).toMatchObject({ scope: { uid: '', schoolId: 'pu' }, mode: 'device',
    messages: [{ role: 'user', content: '依手機課表與授權作業安排接下來七天的學習計畫' }],
    platformTimetable: { accountId: 'student-b' },
  });
  expect(input).not.toHaveProperty('senseSnapshot');
  await input.courseworkRequests.request('class-workspaces');
  await input.courseworkRequests.bffRequest('class-workspaces/work/assignments');
  expect(mockPlatform?.request).toHaveBeenCalledWith('class-workspaces', 'context-a', undefined);
  expect(mockPlatform?.bffRequest).toHaveBeenCalledWith('class-workspaces/work/assignments', 'context-a');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  expect(view.getByText('計畫已儲存')).toBeTruthy();
  expect(getOnDeviceAssistantReadiness).not.toHaveBeenCalled();
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  expect(getCampusAssignmentReminderStatus).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  view.unmount();

  view = render(<CampusAssistantScreen route={platformRoute} />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '繼續已儲存的計畫（1）' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  await act(async () => fireEvent.press(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' })));
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

test('platform plan links open the nuni workspace and never a Firebase course or announcement screen', async () => {
  setPlatformFixture('student-b');
  const navigate = jest.fn();
  const plan = resumablePlan();
  plan.steps.push({ id: 'unsupported', title: '舊格式公告', detail: '待核對',
    priority: 'verify', evidence: 'authorized-announcements', route: '/announcements' });
  const view = render(<CampusAssistantScreen route={platformRoute} navigation={{ navigate,
    getState: () => ({ routeNames: ['NuniWorkspace', 'PersonalTimetable', 'CoursesHome', '公告總覽'] }),
  }} />);
  await askForSavedPlan(view, plan);
  fireEvent.press(view.getByRole('button', { name: '開啟課程與作業核對' }));
  expect(navigate).toHaveBeenLastCalledWith('NuniWorkspace', { tab: 'courses' });
  fireEvent.press(view.getByRole('button', { name: '開啟我的課表核對' }));
  expect(navigate).toHaveBeenLastCalledWith('PersonalTimetable', undefined);
  fireEvent.press(view.getByRole('button', { name: '開啟校園公告核對' }));
  expect(navigate).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByRole('tab', { name: '已儲存計畫' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  fireEvent.press(view.getByRole('button', { name: '開啟課程與作業核對' }));
  expect(navigate).toHaveBeenLastCalledWith('NuniWorkspace', { tab: 'courses' });
  expect(getCampusAssignmentReminderStatus).not.toHaveBeenCalled();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
});

const planAssignmentSource: NuniPlanAssignmentSource = {
  accountId: 'pa_00000000-0000-4000-8000-000000000001', schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: 'cw_00000000-0000-4000-8000-000000000001',
  assignmentId: 'cwa_00000000-0000-4000-8000-000000000001',
};
const planAssignmentParams = { tab: 'courses' as const, workspaceId: planAssignmentSource.workspaceId,
  assignmentId: planAssignmentSource.assignmentId, assistantAccountId: planAssignmentSource.accountId };
function liveNuniPlan(): CampusEvidencePlan {
  const plan = resumablePlan();
  plan.steps[0].nuniSource = { ...planAssignmentSource };
  return plan;
}

test('a live platform plan retries the same precise assignment, preserves the draft and never restores its action from storage', async () => {
  setPlatformFixture(planAssignmentSource.accountId);
  const navigate = jest.fn();
  const navigation = { navigate, getState: () => ({ routeNames: ['NuniWorkspace', 'PersonalTimetable', 'CoursesHome'] }) };
  const lookup = jest.mocked(readNuniPlanAssignmentTarget);
  lookup.mockResolvedValueOnce({ kind: 'unavailable' }).mockResolvedValueOnce({ kind: 'ready', params: planAssignmentParams });
  let view = render(<CampusAssistantScreen route={platformRoute} navigation={navigation} />);
  await askForSavedPlan(view, liveNuniPlan());
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '等一下再問明天的公車');
  expect(lookup).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新核對這份作業' })));
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(lookup.mock.calls[0][0]).toMatchObject({ source: planAssignmentSource,
    accountId: planAssignmentSource.accountId, schoolId: 'pu' });
  expect(lookup.mock.calls[1][0].source).toEqual(planAssignmentSource);
  expect(navigate).toHaveBeenCalledWith('NuniWorkspace', planAssignmentParams);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('等一下再問明天的公車');
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  expect(scheduleCampusAssignmentReminder).not.toHaveBeenCalled();
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  view.unmount();
  view = render(<CampusAssistantScreen route={platformRoute} navigation={navigation} />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '繼續已儲存的計畫（1）' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  expect(view.queryByRole('button', { name: '查看這份作業' })).toBeNull();
  expect(view.getByRole('button', { name: '開啟課程與作業核對' })).toBeTruthy();
  expect(lookup).toHaveBeenCalledTimes(2);
});

test.each(['account', 'context', 'school', 'logout', 'unmount'])(
  'a precise plan assignment cannot navigate after its %s changes during verification', async (change) => {
    setPlatformFixture(planAssignmentSource.accountId);
    const navigate = jest.fn();
    const navigation = { navigate, getState: () => ({ routeNames: ['NuniWorkspace'] }) };
    const pending = deferred<Awaited<ReturnType<typeof readNuniPlanAssignmentTarget>>>();
    jest.mocked(readNuniPlanAssignmentTarget).mockReturnValueOnce(pending.promise);
    const view = render(<CampusAssistantScreen route={platformRoute} navigation={navigation} />);
    await askForSavedPlan(view, liveNuniPlan());
    await act(async () => fireEvent.press(view.getByRole('button', { name: '查看這份作業' })));
    const captured = jest.mocked(readNuniPlanAssignmentTarget).mock.calls[0][0];
    expect(captured.isCurrent()).toBe(true);
    if (change === 'unmount') view.unmount();
    else {
      if (change === 'account') setPlatformFixture('pa_00000000-0000-4000-8000-000000000002');
      else if (change === 'context') setPlatformFixture(planAssignmentSource.accountId, 'replacement-context');
      else if (change === 'school') mockSchool = 'nthu';
      else mockPlatform = null;
      await act(async () => view.rerender(<CampusAssistantScreen route={platformRoute} navigation={navigation} />));
    }
    expect(captured.isCurrent()).toBe(false);
    expect(captured.signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ kind: 'ready', params: planAssignmentParams }));
    expect(navigate).not.toHaveBeenCalled();
    expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  },
);

test('platform saved plans stay separate from a Firebase account with the same id and from other campuses', async () => {
  mockUid = 'student-b';
  const campusPlan = { ...resumablePlan(), title: '校園帳號的計畫' };
  let view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view, campusPlan);
  view.unmount();

  setPlatformFixture('student-b');
  view = render(<CampusAssistantScreen route={platformRoute} />);
  await act(async () => undefined);
  expect(view.queryByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeNull();
  await askForSavedPlan(view, { ...resumablePlan(), title: '平台帳號的計畫' });
  mockSchool = 'nthu';
  await act(async () => view.rerender(<CampusAssistantScreen route={platformRoute} />));
  expect(view.queryByText('平台帳號的計畫')).toBeNull();
  expect(view.queryByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeNull();
  mockSchool = 'pu';
  await act(async () => view.rerender(<CampusAssistantScreen route={platformRoute} />));
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  fireEvent.press(view.getByRole('tab', { name: '已儲存計畫' }));
  expect(view.getByRole('button', { name: /查看平台帳號的計畫/ })).toBeTruthy();
  expect(view.queryByText('校園帳號的計畫')).toBeNull();
  view.unmount();

  mockPlatform = null;
  view = render(<CampusAssistantScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeTruthy());
  openCampusTools(view);
  expect(view.getByRole('button', { name: /查看校園帳號的計畫/ })).toBeTruthy();
  expect(view.queryByText('平台帳號的計畫')).toBeNull();
});

async function openPlatformPlanForReplanning() {
  setPlatformFixture('student-b');
  const view = render(<CampusAssistantScreen route={platformRoute} />);
  await askForSavedPlan(view, planWithComparisonEvidence());
  request.mockClear();
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '待會再問教室');
  fireEvent.press(view.getByRole('tab', { name: '已儲存計畫' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  await act(async () => fireEvent.press(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' })));
  return view;
}

test('platform replanning retries with the original target, compares changes and preserves the old progress and draft', async () => {
  const view = await openPlatformPlanForReplanning();
  const plan = planWithComparisonEvidence(true);
  request.mockRejectedValueOnce(new Error('temporary platform error'))
    .mockResolvedValueOnce({ content: plan.content, source: 'device', hasActions: false, plan });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
  expect(view.queryByText('這次調整了什麼')).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新整理今日重點' })));
  expect(view.getByText('這次調整了什麼')).toBeTruthy();
  expect(view.getByText('截止時間有變動。請開啟作業頁核對。')).toBeTruthy();
  expect(view.getByLabelText('詢問校園助理').props.value).toBe('待會再問教室');
  expect(request.mock.calls[1][0].platformTimetable.accountId).toBe('student-b');
  expect(request.mock.calls[1][0]).not.toHaveProperty('senseSnapshot');
  expect(request.mock.calls[1][0].messages.filter((message: { role: string }) => message.role === 'user')).toHaveLength(2);
  expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查看原計畫' }));
  expect(view.getByRole('checkbox', { name: '我已處理：資料庫期末報告' }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByRole('tab', { name: '對話' }));
  await act(async () => fireEvent.press(view.getByRole('button', { name: '儲存這份計畫' })));
  expect(view.getByRole('button', { name: '繼續已儲存的計畫（2）' })).toBeTruthy();
});

test.each(['account', 'session', 'school', 'cancel', 'signout'] as const)(
  'a late platform replan cannot return old evidence after %s changes', async (change) => {
    const view = await openPlatformPlanForReplanning();
    const pending = deferred<Awaited<ReturnType<typeof askCampusAssistant>>>();
    request.mockReturnValueOnce(pending.promise);
    await act(async () => fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' })));
    const input = request.mock.calls[0][0];
    if (change === 'cancel') {
      fireEvent.press(view.getByRole('button', { name: '取消這次規劃' }));
    } else if (change === 'signout') {
      await act(async () => { await beginSavedCampusPlansSignOutCleanup(); endSavedCampusPlansSignOutCleanup(); });
    } else {
      if (change === 'account') setPlatformFixture('student-c');
      else if (change === 'session') setPlatformFixture('student-b', 'context-new');
      else mockSchool = 'nthu';
      await act(async () => view.rerender(<CampusAssistantScreen route={platformRoute} />));
    }
    expect(input.signal.aborted || !input.isCurrent()).toBe(true);
    const plan = planWithComparisonEvidence(true);
    await act(async () => pending.resolve({ content: plan.content, source: 'device', hasActions: false, plan }));
    expect(view.queryByText('這次調整了什麼')).toBeNull();
    expect(view.queryByText('重新核對後的學習計畫。')).toBeNull();
    expect(refreshCampusSenseSnapshot).not.toHaveBeenCalled();
    if (change === 'cancel') {
      expect(view.getByRole('button', { name: '重新整理今日重點' })).toBeTruthy();
      expect(view.getByLabelText('詢問校園助理').props.value).toBe('待會再問教室');
    }
  },
);

test('an expired platform route never falls back to the still-signed-in Firebase saved plans', async () => {
  const view = render(<CampusAssistantScreen />);
  await askForSavedPlan(view);
  mockPlatform = { session: undefined };
  await act(async () => view.rerender(<CampusAssistantScreen route={platformRoute} />));
  expect(view.queryByRole('button', { name: '繼續已儲存的計畫（1）' })).toBeNull();
  expect(view.queryByText('資料庫期末報告')).toBeNull();
  expect(view.queryByText('整理今日重點')).toBeNull();
});

test('all platform source limitations remain accessible in both live and saved plans', async () => {
  setPlatformFixture('student-b');
  const plan = { ...resumablePlan(), limitations: [
    '尚有課程未連結。', '部分課程無法核對學生身分。', '部分課程尚未經目錄核對。',
    '本次已達資料來源上限，不能判定其他課程沒有作業。',
  ] };
  const view = render(<CampusAssistantScreen route={platformRoute} />);
  await askForSavedPlan(view, plan);
  expect(view.queryByText(/本次已達資料來源上限/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看全部 4 項資料限制' }));
  expect(view.getByText(/本次已達資料來源上限，不能判定其他課程沒有作業/)).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: '已儲存計畫' }));
  fireEvent.press(view.getByRole('button', { name: /查看今日優先行動/ }));
  fireEvent.press(view.getByRole('button', { name: '查看全部 4 項資料限制' }));
  expect(view.getByText(/本次已達資料來源上限，不能判定其他課程沒有作業/)).toBeTruthy();
});
