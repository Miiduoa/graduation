import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusLocalReadResults } from '../screens/CampusLocalReadResults';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { askCampusAssistant } from '../features/campusAssistant';
import type { LocalCampusReadResult } from '../services/localCampusToolProtocol';

let mockUid = 'A';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }) }));
jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  OnDeviceAssistantError: class extends Error {},
  getOnDeviceAssistantReadiness: jest.fn(async () => ({ available: true, ready: true, modelId: 'qwen2.5-0.5b', reason: null })),
}));
jest.mock('../services/campusSenseSnapshot', () => ({
  CAMPUS_SENSE_MAX_AGE_MS: 900000,
  validCampusSenseSnapshot: () => null,
  refreshCampusSenseSnapshot: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const results: LocalCampusReadResult[] = [
  { id: 'timetable:0', label: '明天課表', content: '第 2–3 節｜資料庫', route: '/timetable', source: 'saved-timetable', status: 'available' },
  { id: 'assignments:1', label: '待交作業', content: '缺少有效的作業摘要，請同步後核對。', route: '/classroom', source: 'synced-summary', status: 'unavailable' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'A';
  jest.mocked(askCampusAssistant).mockReset();
});

test('shows separate source-backed results rather than a wall of generated text', () => {
  const navigate = jest.fn();
  const view = render(<CampusLocalReadResults results={results} disabled={false} onOpenRoute={navigate} />);
  expect(view.getByText('第 2–3 節｜資料庫')).toBeTruthy();
  expect(view.getByText(/手機已保存課表/)).toBeTruthy();
  expect(view.getByText(/資料不足，需確認來源/)).toBeTruthy();
  expect(view.queryByText('缺少有效的作業摘要，請同步後核對。')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('待交作業查詢結果'));
  expect(view.getByText('缺少有效的作業摘要，請同步後核對。')).toBeTruthy();
  fireEvent.press(view.getByText('開啟課程與作業核對'));
  expect(navigate).toHaveBeenCalledWith('/classroom');
});

test('busy state prevents repeated navigation or result expansion', () => {
  const navigate = jest.fn();
  const view = render(<CampusLocalReadResults results={results} disabled onOpenRoute={navigate} />);
  fireEvent.press(view.getByLabelText('待交作業查詢結果'));
  fireEvent.press(view.getByText('開啟個人課表核對'));
  expect(view.queryByText('缺少有效的作業摘要，請同步後核對。')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test('a malformed external destination is never exposed as a navigation action', () => {
  const navigate = jest.fn();
  const invalid = [{ ...results[0], route: 'https://example.com' as LocalCampusReadResult['route'] }];
  const view = render(<CampusLocalReadResults results={invalid} disabled={false} onOpenRoute={navigate} />);
  expect(view.queryByText(/開啟.*核對/)).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test('presentation is bounded to the same three-result budget as the executor', () => {
  const four = Array.from({ length: 4 }, (_, i) => ({ ...results[0], id: String(i), label: '結果' + i }));
  const view = render(<CampusLocalReadResults results={four} disabled={false} />);
  expect(view.getByLabelText('結果2查詢結果')).toBeTruthy();
  expect(view.queryByLabelText('結果3查詢結果')).toBeNull();
});

test('assistant retains the structured receipts and labels the model/tool division honestly', async () => {
  jest.mocked(askCampusAssistant).mockResolvedValueOnce({
    source: 'device', tool: 'local-agent', hasActions: false,
    content: 'aggregate fallback not duplicated in the UI', localReads: results,
  });
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '那隔天呢？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.getByText('手機工具查詢')).toBeTruthy();
  expect(view.getByText('第 2–3 節｜資料庫')).toBeTruthy();
  expect(view.getByText(/手機模型理解需求/)).toBeTruthy();
  expect(view.queryByText('aggregate fallback not duplicated in the UI')).toBeNull();
});

test('account switching drops model-selected receipts along with the old conversation', async () => {
  jest.mocked(askCampusAssistant).mockResolvedValueOnce({
    source: 'device', tool: 'local-agent', hasActions: false,
    content: 'A private timetable', localReads: results,
  });
  const view = render(<CampusAssistantScreen />);
  fireEvent.changeText(view.getByLabelText('詢問校園助理'), '那隔天呢？');
  await act(async () => fireEvent.press(view.getByText('送出問題')));
  expect(view.getByText('第 2–3 節｜資料庫')).toBeTruthy();
  mockUid = 'B';
  view.rerender(<CampusAssistantScreen />);
  expect(view.queryByText('第 2–3 節｜資料庫')).toBeNull();
  expect(view.queryByText('手機工具查詢')).toBeNull();
});
