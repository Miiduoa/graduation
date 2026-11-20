import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import CreditPlanningScreen from '../screens/CreditPlanningScreen';
import { readMobileCreditPlan, writeMobileCreditPlan } from '../features/academics/creditPlanRepository';

let mockUid: string | null = 'student-a';
let mockSchool = { id: 'pu', name: '靜宜大學' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null, loading: false }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    Screen: ({ title, children, headerRight }: { title: string; children: React.ReactNode; headerRight?: React.ReactNode }) =>
      React.createElement(View, null, React.createElement(Text, null, title), headerRight, children),
    Spinner: () => null,
  };
});
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: '/tmp' } }));
jest.mock('../features/academics/creditPlanRepository', () => ({
  CREDIT_PLAN_BACKUP_MAX_BYTES: 90_000,
  mobileCreditPlanKey: (uid: string | null, schoolId: string) => `plan:${uid ?? 'guest'}:${schoolId}`,
  readMobileCreditPlan: jest.fn(), writeMobileCreditPlan: jest.fn(),
  parsePortableCreditPlan: (raw: string) => JSON.parse(raw),
  portableCreditPlanJson: (plan: unknown) => JSON.stringify(plan),
}));

const read = jest.mocked(readMobileCreditPlan);
const write = jest.mocked(writeMobileCreditPlan);
const hero = '把未來的學分，排成可執行的計畫。';
const success = '所有變更已保存在這台裝置。';
type ScreenView = ReturnType<typeof render>;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function fillAll(view: ScreenView) {
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '128');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '資料庫管理');
  fireEvent.press(view.getByLabelText('分類門檻與非學分條件'));
  fireEvent.changeText(view.getByLabelText('必修已確認採計'), '20');
  fireEvent.changeText(view.getByLabelText('必修目標門檻'), '48');
  fireEvent.changeText(view.getByLabelText('新增畢業條件（自行核對）'), '英語檢定');
}
function saveAll(view: ScreenView) { fireEvent.press(view.getByLabelText('儲存所有變更')); }
function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '20', courses: [
    { id: 'existing', name: '資料庫管理', credits: 3, term: 1, category: 'required', status: 'considering' },
  ] };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'student-a'; mockSchool = { id: 'pu', name: '靜宜大學' };
  read.mockReset().mockResolvedValue(emptyCreditPlan());
  write.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('does not offer a batch write for an unchanged plan or a semester-only selection', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  expect(view.queryByTestId('credit-plan-save-bar')).toBeNull();
  fireEvent.press(view.getByLabelText('第 2 學期 · 0'));
  expect(view.queryByTestId('credit-plan-save-bar')).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test('saves all four sections with one scoped write and clears only committed inputs', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  saveAll(view);
  await view.findByText(success);
  expect(write).toHaveBeenCalledTimes(1);
  const [key, plan] = write.mock.calls[0];
  expect(key).toBe('plan:student-a:pu');
  expect(plan).toMatchObject({ recognized: '60', target: '128',
    categoryGoals: { required: { recognized: '20', target: '48' } },
    courses: [{ name: '資料庫管理', credits: 3, status: 'considering' }],
    milestones: [{ label: '英語檢定', done: false }],
  });
  expect(view.getByLabelText('課程名稱').props.value).toBe('');
  expect(view.getByLabelText('新增畢業條件（自行核對）').props.value).toBe('');
  await waitFor(() => expect(view.queryByTestId('credit-plan-save-bar')).toBeNull());
});

test('rejects the whole write for an invalid field, retains every draft, then permits correction', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  fireEvent.changeText(view.getByLabelText('學分'), '0');
  saveAll(view);
  expect(Alert.alert).toHaveBeenCalledWith('請先修正再儲存', expect.stringContaining('課程安排'));
  expect(write).not.toHaveBeenCalled();
  expect(view.getByLabelText('已確認可採計學分').props.value).toBe('60');
  expect(view.getByLabelText('新增畢業條件（自行核對）').props.value).toBe('英語檢定');
  fireEvent.changeText(view.getByLabelText('學分'), '3');
  saveAll(view);
  await view.findByText(success);
  expect(write).toHaveBeenCalledTimes(1);
});

test('storage failure retains all four sections and a retry does not duplicate their entries', async () => {
  write.mockRejectedValueOnce(new Error('disk full'));
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  saveAll(view);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('規劃未儲存', 'disk full'));
  expect(view.queryByText(success)).toBeNull();
  expect(view.getByLabelText('課程名稱').props.value).toBe('資料庫管理');
  expect(view.getByLabelText('必修目標門檻').props.value).toBe('48');
  expect(view.getByLabelText('新增畢業條件（自行核對）').props.value).toBe('英語檢定');
  saveAll(view);
  await view.findByText(success);
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][1].courses).toHaveLength(1);
  expect(write.mock.calls[1][1].milestones).toHaveLength(1);
});

test('repeated presses cannot issue a second write while saving', async () => {
  const pending = deferred();
  write.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  act(() => { saveAll(view); saveAll(view); });
  expect(write).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('課程名稱').props.editable).toBe(false);
  expect(view.getByLabelText('希望累計的學分').props.editable).toBe(false);
  await act(async () => { pending.resolve(); });
  await view.findByText(success);
});

test('batch editing preserves an existing course identifier and does not append a duplicate', async () => {
  read.mockResolvedValue(sample());
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.press(view.getByLabelText('編輯資料庫管理'));
  fireEvent.changeText(view.getByLabelText('課程名稱'), '資料庫系統');
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  saveAll(view);
  await view.findByText(success);
  expect(write.mock.calls[0][1].courses).toEqual([
    { ...sample().courses[0], name: '資料庫系統' },
  ]);
  expect(view.queryByText('儲存課程修改')).toBeNull();
});

test('old completion cannot clear new campus/account drafts', async () => {
  const pending = deferred();
  write.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  saveAll(view);
  mockUid = 'student-b'; mockSchool = { id: 'nchu', name: '中興大學' };
  view.rerender(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('課程名稱'), '另一個帳號的草稿');
  await act(async () => { pending.resolve(); });
  expect(view.getByLabelText('課程名稱').props.value).toBe('另一個帳號的草稿');
  expect(view.queryByText(success)).toBeNull();
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0]).toBe('plan:student-a:pu');
});

test('A to B to A still rejects an old batch completion', async () => {
  const pending = deferred();
  write.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  saveAll(view);
  mockUid = 'student-b';
  view.rerender(<CreditPlanningScreen />);
  await view.findByText(hero);
  mockUid = 'student-a';
  view.rerender(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('課程名稱'), '回來後的新輸入');
  await act(async () => { pending.resolve(); });
  expect(view.getByLabelText('課程名稱').props.value).toBe('回來後的新輸入');
  expect(view.queryByText(success)).toBeNull();
});

test('reopening restores the single saved plan without creating phantom drafts', async () => {
  let stored = emptyCreditPlan();
  read.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
  write.mockImplementation(async (_key, next) => { stored = JSON.parse(JSON.stringify(next)); });
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fillAll(view);
  saveAll(view);
  await view.findByText(success);
  view.unmount();
  const reopened = render(<CreditPlanningScreen />);
  await reopened.findByText(hero);
  expect(reopened.getByLabelText('已確認可採計學分').props.value).toBe('60');
  expect(reopened.getByLabelText('編輯資料庫管理')).toBeTruthy();
  expect(reopened.queryByTestId('credit-plan-save-bar')).toBeNull();
  fireEvent.press(reopened.getByLabelText('分類門檻與非學分條件'));
  expect(reopened.getByLabelText('英語檢定')).toBeTruthy();
  expect(write).toHaveBeenCalledTimes(1);
});

test('late native input is retained as an edit of the newly saved course, not a second course', async () => {
  const pending = deferred();
  write.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanningScreen />);
  await view.findByText(hero);
  fireEvent.changeText(view.getByLabelText('課程名稱'), '資料庫管理');
  const lateInput = view.getByLabelText('課程名稱').props.onChangeText;
  saveAll(view);
  // 模擬儲存開始前已排入佇列、在欄位停用後才送達的原生輸入事件。
  act(() => lateInput('資料庫進階'));
  await act(async () => { pending.resolve(); });
  expect(view.getByLabelText('課程名稱').props.value).toBe('資料庫進階');
  expect(view.getByText('儲存課程修改')).toBeTruthy();
  saveAll(view);
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write.mock.calls[1][1].courses).toHaveLength(1);
  expect(write.mock.calls[1][1].courses[0]).toMatchObject({
    id: write.mock.calls[0][1].courses[0].id, name: '資料庫進階',
  });
  await waitFor(() => expect(view.queryByTestId('credit-plan-save-bar')).toBeNull());
});
