import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { emptyCreditPlan } from '@campus/shared/src/creditPlanner';
import type { Grade } from '../data/types';
import CreditTranscriptReviewScreen from '../screens/CreditTranscriptReviewScreen';
import { loadCreditRecords, type CreditLoadSuccess } from '../screens/creditAudit/loadCreditRecords';
import { readMobileCreditPlan, replaceReviewedCreditPlan } from '../features/academics/creditPlanRepository';

let mockUid: string | null = 'a';
let mockLoading = false;
let mockSchool = { id: 'pu', name: '靜宜大學' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null, loading: mockLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('../ui/components', () => {
  const React = require('react'); const { Text, View } = require('react-native');
  return { Screen: ({ title, children, headerRight }: { title: string; children: React.ReactNode; headerRight?: React.ReactNode }) =>
    React.createElement(View, null, React.createElement(Text, null, title), headerRight, children), Spinner: () => null };
});
jest.mock('../screens/creditAudit/loadCreditRecords', () => ({ loadCreditRecords: jest.fn() }));
jest.mock('../features/academics/creditPlanRepository', () => ({
  mobileCreditPlanKey: (uid: string, schoolId: string) => `${uid}:${schoolId}`,
  readMobileCreditPlan: jest.fn(), replaceReviewedCreditPlan: jest.fn(),
}));
const load = jest.mocked(loadCreditRecords);
const read = jest.mocked(readMobileCreditPlan);
const save = jest.mocked(replaceReviewedCreditPlan);
function data(patch: Partial<CreditLoadSuccess> = {}): CreditLoadSuccess {
  return { ok: true, readAt: Date.now(), fromOfflineSchoolCache: false, gpa: null, gpaUnavailable: true,
    grades: [{ id: 'g1', userId: 'a', schoolId: 'pu', courseId: 'c1', courseName: '資料庫',
      courseCode: 'IM1', courseType: '必修', semester: '1141', credits: 3, grade: 80,
      gradeSource: 'school-official' } as Grade], ...patch };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks(); mockUid = 'a'; mockLoading = false; mockSchool = { id: 'pu', name: '靜宜大學' };
  load.mockReset().mockImplementation(async () => data());
  read.mockReset().mockResolvedValue(emptyCreditPlan());
  save.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
async function select(view: ReturnType<typeof render>) {
  await view.findByText('1 · 選擇核對標準');
  fireEvent.press(view.getByLabelText('60 分'));
  fireEvent.press(view.getByLabelText('選取無重複疑義的通過紀錄'));
}
async function preview(view: ReturnType<typeof render>) {
  await select(view); fireEvent.press(view.getByLabelText('預覽套用差異'));
  await view.findByText('核對更新前後');
}

test('full review reads scoped records, previews and requires explicit confirmation before one local write', async () => {
  const replace = jest.fn(); const view = render(<CreditTranscriptReviewScreen navigation={{ replace }} />);
  await preview(view);
  expect(load).toHaveBeenCalledWith({ uid: 'a', schoolId: 'pu' });
  expect(save).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('確認套用到個人規劃')); expect(save).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('我已核對來源、採計與重修規則'));
  fireEvent.press(view.getByLabelText('確認套用到個人規劃'));
  await view.findByText('已更新個人規劃');
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('a:pu', emptyCreditPlan(), expect.objectContaining({ recognized: '3' }), expect.any(Function));
  expect(replace).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('查看更新後的學分規劃'));
  expect(replace).toHaveBeenCalledWith('CreditPlanning');
});

test('no guest or unresolved authentication can read private grades', () => {
  mockLoading = true; const view = render(<CreditTranscriptReviewScreen />); expect(load).not.toHaveBeenCalled();
  mockLoading = false; mockUid = null; view.rerender(<CreditTranscriptReviewScreen />);
  expect(load).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});

test('a read failure is not an empty transcript and never resets confirmed credits', async () => {
  load.mockResolvedValueOnce({ ok: false, reason: 'read-failed', errorMessage: '校務服務未回覆' });
  const view = render(<CreditTranscriptReviewScreen />);
  await view.findByText('校務服務未回覆');
  expect(view.queryByText('目前沒有可核對的成績')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('重新讀取成績與核對'));
  await view.findByText('1 · 選擇核對標準');
});

test('a genuine empty success cannot be applied as zero', async () => {
  load.mockResolvedValueOnce(data({ grades: [] }));
  const view = render(<CreditTranscriptReviewScreen />);
  await view.findByText('目前沒有可核對的成績');
  expect(view.queryByLabelText('預覽套用差異')).toBeNull(); expect(save).not.toHaveBeenCalled();
});

test('an A to B to A account switch rejects an old source reply', async () => {
  const old = deferred<CreditLoadSuccess>(); load.mockReturnValueOnce(old.promise);
  const view = render(<CreditTranscriptReviewScreen />);
  mockUid = 'b'; mockSchool = { id: 'nchu', name: '中興大學' }; view.rerender(<CreditTranscriptReviewScreen />);
  await view.findByText('1 · 選擇核對標準');
  mockUid = 'a'; mockSchool = { id: 'pu', name: '靜宜大學' }; view.rerender(<CreditTranscriptReviewScreen />);
  await view.findByText('1 · 選擇核對標準');
  await act(async () => { old.resolve(data({ grades: [] })); });
  expect(view.queryByText('目前沒有可核對的成績')).toBeNull(); expect(save).not.toHaveBeenCalled();
});

test('offline provenance is visible and expired reads require reload before preview', async () => {
  load.mockResolvedValueOnce(data({ readAt: Date.now() - 11 * 60_000, fromOfflineSchoolCache: true }));
  const view = render(<CreditTranscriptReviewScreen />); await select(view);
  expect(view.getByText(/含離線／過期副本/)).toBeTruthy();
  fireEvent.press(view.getByLabelText('預覽套用差異'));
  await view.findByText(/已超過 10 分鐘/);
  expect(read).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});

test('same-name planned courses require a decision before applying and only selected removal occurs', async () => {
  read.mockResolvedValueOnce({ ...emptyCreditPlan(), courses: [
    { id: 'future', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
  ] });
  const view = render(<CreditTranscriptReviewScreen />); await preview(view);
  fireEvent.press(view.getByLabelText('我已核對來源、採計與重修規則'));
  fireEvent.press(view.getByLabelText('確認套用到個人規劃')); expect(save).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('移除已修規劃：資料庫'));
  fireEvent.press(view.getByLabelText('確認套用到個人規劃'));
  await view.findByText('已更新個人規劃');
  expect(save.mock.calls[0][2].courses).toEqual([]);
});

test('a persistence failure keeps the review available for deliberate retry', async () => {
  save.mockRejectedValueOnce(new Error('disk full'));
  const view = render(<CreditTranscriptReviewScreen />); await preview(view);
  fireEvent.press(view.getByLabelText('我已核對來源、採計與重修規則'));
  fireEvent.press(view.getByLabelText('確認套用到個人規劃'));
  await view.findByText('disk full');
  expect(view.queryByText('已更新個人規劃')).toBeNull();
  fireEvent.press(view.getByLabelText('確認套用到個人規劃'));
  await view.findByText('已更新個人規劃'); expect(save).toHaveBeenCalledTimes(2);
});

test('late write results do not display another account receipt', async () => {
  const pending = deferred<void>(); save.mockReturnValueOnce(pending.promise);
  const view = render(<CreditTranscriptReviewScreen />); await preview(view);
  fireEvent.press(view.getByLabelText('我已核對來源、採計與重修規則'));
  fireEvent.press(view.getByLabelText('確認套用到個人規劃'));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const current = save.mock.calls[0][3];
  mockUid = 'b'; view.rerender(<CreditTranscriptReviewScreen />);
  await view.findByText('1 · 選擇核對標準'); expect(current()).toBe(false);
  await act(async () => pending.resolve(undefined));
  expect(view.queryByText('已更新個人規劃')).toBeNull();
});

test('multiple taps cannot issue parallel confirmations', async () => {
  const pending = deferred<void>(); save.mockReturnValueOnce(pending.promise);
  const view = render(<CreditTranscriptReviewScreen />); await preview(view);
  fireEvent.press(view.getByLabelText('我已核對來源、採計與重修規則'));
  const button = view.getByLabelText('確認套用到個人規劃');
  fireEvent.press(button); fireEvent.press(button);
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(undefined));
});
