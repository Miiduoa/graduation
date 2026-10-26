import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AIOverlayHost } from '../components/AIOverlayHost';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { askCampusAssistant } from '../features/campusAssistant';
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
  getOnDeviceAssistantReadiness: jest.fn(async () => ({
    available: true, ready: false, modelId: 'qwen2.5-0.5b',
    reason: '尚未下載免費模型',
  })),
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
  mockUid = 'A';
  mockSchool = 'pu';
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
