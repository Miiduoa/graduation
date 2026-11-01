import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import CreditPlanningScreen from '../screens/CreditPlanningScreen';
import { mobileCreditPlanKey } from '../features/academics/creditPlanRepository';

const mockData = new Map<string, string>();
let mockUid = 'alice';
let mockSchool = { id: 'pu', name: '靜宜大學' };
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockData.get(key) ?? null),
  setItem: jest.fn(async (key: string, raw: string) => { mockData.set(key, raw); }),
} }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid }, loading: false }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../ui/components', () => {
  const React = require('react'); const { Text, View } = require('react-native');
  return { Screen: ({ title, children }: { title: string; children: React.ReactNode }) =>
    React.createElement(View, null, React.createElement(Text, null, title), children), Spinner: () => null };
});
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: '/tmp' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
const get = jest.mocked(AsyncStorage.getItem), set = jest.mocked(AsyncStorage.setItem);
const key = () => mobileCreditPlanKey('alice', 'pu');
function sample(): CreditPlan { return { ...emptyCreditPlan(), recognized: '60', target: '128',
  courses: [
    { id: 'one', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
    { id: 'two', name: '統計學', credits: 2.5, term: 2, category: 'elective', status: 'considering' },
  ] }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function setup(plan = sample()) {
  mockData.set(key(), JSON.stringify(plan)); const view = render(<CreditPlanningScreen />);
  await view.findByText('把未來的學分，排成可執行的計畫。');
  fireEvent.press(view.getByLabelText('換個修法，先看差多少'));
  fireEvent.press(view.getByLabelText('比較只修已選課'));
  return view;
}
function preview(view: ReturnType<typeof render>) { fireEvent.press(view.getByLabelText('預覽並採用此方案')); }
async function apply(view: ReturnType<typeof render>) {
  preview(view); fireEvent.press(view.getByLabelText('確認採用到個人規劃'));
  await view.findByText('已採用到這台裝置的個人規劃。');
}
beforeEach(() => {
  jest.clearAllMocks(); mockData.clear(); mockUid = 'alice'; mockSchool = { id: 'pu', name: '靜宜大學' };
  get.mockReset().mockImplementation(async key => mockData.get(key) ?? null);
  set.mockReset().mockImplementation(async (key, raw) => { mockData.set(key, raw); });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('review has no write; explicit adoption and undo use the real scoped repository', async () => {
  const view = await setup(); preview(view); expect(set).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('確認採用到個人規劃'));
  await view.findByText('已採用到這台裝置的個人規劃。');
  expect(JSON.parse(mockData.get(key())!).courses.map((c: { id: string }) => c.id)).toEqual(['one']);
  expect(JSON.parse(mockData.get(key())!).recognized).toBe('60');
  fireEvent.press(view.getByLabelText('復原這次採用'));
  await view.findByText('已復原這次採用，回到原本的修課安排。');
  expect(JSON.parse(mockData.get(key())!)).toEqual(sample()); expect(set).toHaveBeenCalledTimes(2);
});
test('cancel keeps the original and pending course input blocks the next adoption', async () => {
  const view = await setup(); preview(view); fireEvent.press(view.getByLabelText('取消採用'));
  fireEvent.changeText(view.getByLabelText('課程名稱'), '我的草稿');
  expect(view.getByLabelText('預覽並採用此方案').props.accessibilityState.disabled).toBe(true);
  expect(view.getByLabelText('課程名稱').props.value).toBe('我的草稿'); expect(set).not.toHaveBeenCalled();
});
test('CAS refuses another screen update between preview and confirmation', async () => {
  const view = await setup(); preview(view); const newer = { ...sample(), target: '140' }; mockData.set(key(), JSON.stringify(newer));
  fireEvent.press(view.getByLabelText('確認採用到個人規劃'));
  await view.findByText('原規劃已變更或無法讀取，請重新讀取並核對；沒有覆寫現有資料。');
  expect(set).not.toHaveBeenCalled(); expect(JSON.parse(mockData.get(key())!)).toEqual(newer);
});
test('disk failure preserves the preview and retry works without duplicating courses', async () => {
  const view = await setup(); preview(view); set.mockRejectedValueOnce(new Error('disk full'));
  fireEvent.press(view.getByLabelText('確認採用到個人規劃'));
  await view.findByText('disk full');
  expect(JSON.parse(mockData.get(key())!)).toEqual(sample());
  fireEvent.press(view.getByLabelText('確認採用到個人規劃')); await view.findByText('已採用到這台裝置的個人規劃。');
  expect(JSON.parse(mockData.get(key())!).courses).toHaveLength(1);
});
test('all-course omission remains undoable even after collapsing the comparison', async () => {
  const original = sample(); original.courses.forEach(c => { c.status = 'considering'; });
  const view = await setup(original); await apply(view); expect(JSON.parse(mockData.get(key())!).courses).toHaveLength(0);
  fireEvent.press(view.getByLabelText('換個修法，先看差多少')); fireEvent.press(view.getByLabelText('換個修法，先看差多少'));
  fireEvent.press(view.getByLabelText('復原這次採用')); await view.findByText('已復原這次採用，回到原本的修課安排。');
  expect(JSON.parse(mockData.get(key())!)).toEqual(original);
});
test('later saved edit invalidates undo instead of overwriting it', async () => {
  const view = await setup(); await apply(view);
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '150'); fireEvent.press(view.getByLabelText('儲存學分目標'));
  await waitFor(() => expect(view.queryByLabelText('復原這次採用')).toBeNull());
  expect(JSON.parse(mockData.get(key())!).target).toBe('150');
});
test('double confirmation while a write is pending starts one write', async () => {
  const view = await setup(); preview(view); const pending = deferred<void>();
  set.mockImplementationOnce(async (key, raw) => { await pending.promise; mockData.set(key, raw); });
  const confirm = view.getByLabelText('確認採用到個人規劃'); fireEvent.press(confirm); fireEvent.press(confirm);
  await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  await act(async () => pending.resolve()); await view.findByText('已採用到這台裝置的個人規劃。');
  expect(set).toHaveBeenCalledTimes(1);
});
test('account switch during compare read suppresses the old write and receipt', async () => {
  const view = await setup(); preview(view); const pending = deferred<string | null>();
  get.mockImplementationOnce(() => pending.promise);
  fireEvent.press(view.getByLabelText('確認採用到個人規劃'));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  mockUid = 'bob'; view.rerender(<CreditPlanningScreen />);
  await act(async () => pending.resolve(JSON.stringify(sample())));
  await view.findByText('把未來的學分，排成可執行的計畫。');
  expect(set).not.toHaveBeenCalled(); expect(view.queryByText('已採用到這台裝置的個人規劃。')).toBeNull();
  mockUid = 'alice'; view.rerender(<CreditPlanningScreen />);
  await view.findByText('把未來的學分，排成可執行的計畫。');
  expect(view.queryByLabelText('確認採用到個人規劃')).toBeNull(); expect(JSON.parse(mockData.get(key())!)).toEqual(sample());
});
test('a late native input received while waiting for storage prevents adopting over the draft', async () => {
  const view = await setup(); preview(view); const pending = deferred<string | null>();
  get.mockImplementationOnce(() => pending.promise);
  const onChange = view.getByLabelText('課程名稱').props.onChangeText;
  fireEvent.press(view.getByLabelText('確認採用到個人規劃'));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  act(() => onChange('晚到的輸入'));
  await act(async () => pending.resolve(JSON.stringify(sample())));
  await view.findByText('這次核對已失效，未更新規劃。');
  expect(set).not.toHaveBeenCalled(); expect(view.getByLabelText('課程名稱').props.value).toBe('晚到的輸入');
});
