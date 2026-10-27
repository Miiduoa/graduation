import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { CreditPlanScenarioCard } from '../screens/creditAudit/CreditPlanScenarioCard';

const mockWrite = jest.fn();
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ uri: 'file:///tmp/scenario.json',
    write: (raw: string) => mockWrite(raw), delete: () => mockDelete(),
  })), Paths: { cache: '/tmp' },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../features/academics/creditPlanRepository', () => ({ portableCreditPlanJson: (plan: unknown) => JSON.stringify(plan) }));

const available = jest.mocked(isAvailableAsync);
const share = jest.mocked(shareAsync);
function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '60', target: '80', courses: [
    { id: 'one', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
    { id: 'two', name: '統計學', credits: 2.5, term: 2, category: 'elective', status: 'considering' },
  ] };
}
function open(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByLabelText('換個修法，先看差多少'));
}
function preset(view: ReturnType<typeof render>) { open(view); fireEvent.press(view.getByLabelText('比較只修已選課')); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  available.mockReset().mockResolvedValue(true);
  share.mockReset().mockResolvedValue(undefined);
  mockWrite.mockReset().mockResolvedValue(undefined);
  mockDelete.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('compares registered-only and course movements without changing the original saved plan', () => {
  const plan = sample();
  const initial = JSON.stringify(plan);
  const view = render(<CreditPlanScenarioCard plan={plan} />);
  preset(view);
  expect(view.getByText(/不排入 1 門、移動 0 門/).props.children).toContain('+2.5 學分');
  fireEvent.press(view.getByLabelText('調整資料庫（原第 1 學期）'));
  fireEvent.press(view.getByLabelText('改排第 4 學期'));
  expect(view.getByText(/不排入 1 門、移動 1 門/)).toBeTruthy();
  expect(JSON.stringify(plan)).toBe(initial);
  expect(mockWrite).not.toHaveBeenCalled();
});

test('search changes visibility only, not the scenario calculation', () => {
  const view = render(<CreditPlanScenarioCard plan={sample()} />); preset(view);
  fireEvent.changeText(view.getByLabelText('搜尋比較課程'), '資料庫');
  expect(view.queryByLabelText('調整統計學（原第 2 學期）')).toBeNull();
  expect(view.getByText(/不排入 1 門、移動 0 門/).props.children).toContain('+2.5 學分');
});

test('exports only the explicit alternative, preserving earned-credit and goal fields', async () => {
  const plan = sample();
  const initial = JSON.stringify(plan);
  const view = render(<CreditPlanScenarioCard plan={plan} />); preset(view);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  const saved = JSON.parse(mockWrite.mock.calls[0][0]);
  expect(saved.courses.map((row: { id: string }) => row.id)).toEqual(['one']);
  expect(saved.recognized).toBe('60');
  expect(saved.target).toBe('80');
  expect(JSON.stringify(plan)).toBe(initial);
  expect(mockDelete).not.toHaveBeenCalled();
});

test('an unavailable share provider does not create a file or claim successful backup', async () => {
  available.mockResolvedValueOnce(false);
  const view = render(<CreditPlanScenarioCard plan={sample()} />); preset(view);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('目前無法分享方案', expect.stringContaining('尚未匯出')));
  expect(mockWrite).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
});

test('a changed source invalidates the comparison and an in-flight export', async () => {
  const pending = deferred<boolean>();
  available.mockReturnValueOnce(pending.promise);
  const plan = sample();
  const view = render(<CreditPlanScenarioCard plan={plan} />); preset(view);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  view.rerender(<CreditPlanScenarioCard plan={{ ...plan, recognized: '70' }} />);
  await act(async () => pending.resolve(true));
  expect(view.getByText(/原規劃已更新/)).toBeTruthy();
  expect(share).not.toHaveBeenCalled();
  expect(mockWrite).not.toHaveBeenCalled();
});

test('A to B to A cannot revive a pending export even if the original object returns', async () => {
  const pending = deferred<boolean>();
  available.mockReturnValueOnce(pending.promise);
  const plan = sample();
  const view = render(<CreditPlanScenarioCard plan={plan} />); preset(view);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  view.rerender(<CreditPlanScenarioCard plan={{ ...plan, target: '90' }} />);
  view.rerender(<CreditPlanScenarioCard plan={plan} />);
  await act(async () => pending.resolve(true));
  expect(share).not.toHaveBeenCalled();
  expect(mockWrite).not.toHaveBeenCalled();
});

test('leaving the screen during file writing cleans the temporary file and never opens a share sheet', async () => {
  const pending = deferred<void>();
  mockWrite.mockReturnValueOnce(pending.promise);
  const view = render(<CreditPlanScenarioCard plan={sample()} />); preset(view);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  await waitFor(() => expect(mockWrite).toHaveBeenCalled());
  view.unmount();
  await act(async () => pending.resolve(undefined));
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(share).not.toHaveBeenCalled();
});

test('failed file writing leaves the original plan intact and permits retry', async () => {
  mockWrite.mockRejectedValueOnce(new Error('disk full'));
  const plan = sample();
  const view = render(<CreditPlanScenarioCard plan={plan} />); preset(view);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('無法匯出方案', 'disk full'));
  expect(plan.courses).toHaveLength(2);
  fireEvent.press(view.getByLabelText('匯出此比較方案 JSON'));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
});

test('empty plans do not expose fake comparisons or exports', () => {
  const view = render(<CreditPlanScenarioCard plan={emptyCreditPlan()} />); open(view);
  expect(view.getByText(/先在課程清單加入並儲存一門課/)).toBeTruthy();
  expect(view.queryByLabelText('匯出此比較方案 JSON')).toBeNull();
});
