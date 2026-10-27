import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AIOverlayHost } from '../components/AIOverlayHost';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { askCampusAssistant } from '../features/campusAssistant';
import { confirmCampusAgentWrite } from '../features/campusAssistantActions';
import { refreshCampusSenseSnapshot } from '../services/campusSenseSnapshot';
const mockClose = jest.fn();
let mockOverlay = { visible: true, mode: 'chat', initialPrompt: '查校方公告' };
jest.mock('../app/useAIOverlay', () => ({
  useAIOverlay: () => mockOverlay,
  aiOverlay: { close: () => mockClose() },
}));
let mockUid: string | null = 'A';
let mockSchool = 'pu';
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const request = askCampusAssistant as jest.Mock;
function selectCampusMode(view: ReturnType<typeof render>) {
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
beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does not clear queued mockResolvedValueOnce implementations.
  // Prevent a pending result from one navigation test reaching another account.
  request.mockReset();
  jest.mocked(confirmCampusAgentWrite).mockReset();
  jest.mocked(refreshCampusSenseSnapshot).mockReset();
  mockUid = 'A';
  mockSchool = 'pu';
  mockOverlay = { visible: true, mode: 'chat', initialPrompt: '查校方公告' };
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
  await act(async () => fireEvent.press(view.getByText('同步我的校園資料')));
  expect(refreshCampusSenseSnapshot).toHaveBeenCalledWith({
    scope: { uid: 'A', schoolId: 'pu' }, isCurrent: expect.any(Function),
  });
  expect(view.getByText('已取得本次授權資料')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '我的待交作業');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'device', senseSnapshot: snapshot,
  }));
  expect(view.getByText(/先前主動同步的授權摘要/)).toBeTruthy();
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
  fireEvent.press(view.getByText('同步我的校園資料'));
  mockSchool = 'other';
  view.rerender(<CampusAssistantScreen />);
  await act(async () => pending.resolve({
    userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 0, items: [] },
    announcements: { status: 'available', items: [] },
  }));
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
  await act(async () => fireEvent.press(view.getByText('今日重點')));
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
