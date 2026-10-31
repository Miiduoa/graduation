import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceCorrectionResume } from './AttendanceCorrectionResume';
import { rememberCorrectionBookmark, readCorrectionBookmark } from '@/lib/attendanceCorrectionBookmark';
import { loadSavedCorrectionReceipt, type CorrectionReceiptResult } from '@/lib/attendanceCorrectionReceipt';
vi.mock('@/lib/attendanceCorrectionReceipt', () => ({ loadSavedCorrectionReceipt: vi.fn() }));
const scope = { actorUid: 'teacher', courseId: 'course', sessionId: 'session' };
let actor: string | null;
const actorNow = () => actor;
const editor = <button type="button">開啟新的更正</button>;
const saved: CorrectionReceiptResult = {
  kind: 'saved', status: 'late', savedAt: '2026-10-28T01:00:00Z', changedSinceSave: true,
  current: { scope: '["course","session","student"]', revision: 3, active: false,
    row: { uid: 'student', displayName: '學生甲', studentId: 'S001', status: 'excused', source: 'manual', checkedInAt: null, correctedAt: '2026-10-28T02:00:00Z' } },
};
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); actor = 'teacher'; vi.mocked(loadSavedCorrectionReceipt).mockResolvedValue(saved); });
function mount() { return render(<AttendanceCorrectionResume scope={scope} currentActor={actorNow}>{editor}</AttendanceCorrectionResume>); }
it('does not interrupt an editor without a prior unresolved operation', () => {
  mount(); expect(screen.getByText('開啟新的更正')).toBeTruthy(); expect(loadSavedCorrectionReceipt).not.toHaveBeenCalled();
});
it('restores only a reminder, never auto-submits or auto-loads a private student record', () => {
  rememberCorrectionBookmark(scope, 'request'); mount();
  expect(screen.getByRole('button', { name: '查核原更正收據' })).toBeTruthy();
  expect(screen.queryByText('開啟新的更正')).toBeNull();
  expect(screen.queryByText(/學生甲/)).toBeNull();
  expect(loadSavedCorrectionReceipt).not.toHaveBeenCalled();
});
it('distinguishes the saved decision from the current one, then explicitly releases the editor', async () => {
  rememberCorrectionBookmark(scope, 'request'); mount();
  fireEvent.click(screen.getByRole('button', { name: '查核原更正收據' }));
  expect(await screen.findByText('原操作已保存：遲到')).toBeTruthy();
  expect(screen.getByText('目前課堂狀態：請假')).toBeTruthy();
  expect(screen.queryByText('開啟新的更正')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '已確認，返回名冊' }));
  expect(screen.getByText('開啟新的更正')).toBeTruthy();
  expect(readCorrectionBookmark(scope)).toEqual({ kind: 'empty' });
  expect(loadSavedCorrectionReceipt).toHaveBeenCalledTimes(1);
});
it('keeps an unproven result and requires acknowledgement before removing only the reminder', async () => {
  rememberCorrectionBookmark(scope, 'request'); vi.mocked(loadSavedCorrectionReceipt).mockResolvedValue({ kind: 'not-found' }); mount();
  fireEvent.click(screen.getByRole('button', { name: '查核原更正收據' }));
  expect(await screen.findByText(/目前尚未找到這筆收據，不代表操作失敗/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '移除本頁提醒，返回名冊' }).hasAttribute('disabled')).toBe(true);
  expect(readCorrectionBookmark(scope).kind).toBe('pending');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '移除本頁提醒，返回名冊' }));
  expect(screen.getByText('開啟新的更正')).toBeTruthy();
});
it('does not reveal or consume another account\'s pending reminder', () => {
  rememberCorrectionBookmark({ ...scope, actorUid: 'other' }, 'request'); mount();
  expect(screen.getByText('開啟新的更正')).toBeTruthy(); expect(loadSavedCorrectionReceipt).not.toHaveBeenCalled();
  expect(readCorrectionBookmark({ ...scope, actorUid: 'other' }).kind).toBe('pending');
});
it('keeps the pointer on permission/read failure without fabricating success', async () => {
  rememberCorrectionBookmark(scope, 'request'); vi.mocked(loadSavedCorrectionReceipt).mockRejectedValue(new Error('denied')); mount();
  fireEvent.click(screen.getByRole('button', { name: '查核原更正收據' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('開啟新的更正')).toBeNull(); expect(readCorrectionBookmark(scope).kind).toBe('pending');
});
it('ignores a late result after changing the course', async () => {
  let finish!: (result: CorrectionReceiptResult) => void;
  vi.mocked(loadSavedCorrectionReceipt).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  rememberCorrectionBookmark(scope, 'request'); const view = mount();
  fireEvent.click(screen.getByRole('button', { name: '查核原更正收據' }));
  await waitFor(() => expect(loadSavedCorrectionReceipt).toHaveBeenCalledTimes(1));
  view.rerender(<AttendanceCorrectionResume scope={{ ...scope, courseId: 'other' }} currentActor={actorNow}>{editor}</AttendanceCorrectionResume>);
  await act(async () => finish(saved));
  expect(screen.queryByText(/學生甲/)).toBeNull(); expect(screen.getByText('開啟新的更正')).toBeTruthy();
});
it('does not issue concurrent receipt checks from double clicks', async () => {
  let finish!: (result: CorrectionReceiptResult) => void;
  vi.mocked(loadSavedCorrectionReceipt).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  rememberCorrectionBookmark(scope, 'request'); mount();
  const button = screen.getByRole('button', { name: '查核原更正收據' }); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(loadSavedCorrectionReceipt).toHaveBeenCalledTimes(1));
  await act(async () => finish(saved));
});
it('cannot erase a newer pointer when acknowledging an older receipt', async () => {
  rememberCorrectionBookmark(scope, 'old'); mount();
  fireEvent.click(screen.getByRole('button', { name: '查核原更正收據' })); await screen.findByText('原操作已保存：遲到');
  sessionStorage.clear(); rememberCorrectionBookmark(scope, 'new');
  fireEvent.click(screen.getByRole('button', { name: '已確認，返回名冊' }));
  expect(screen.getByRole('alert')).toBeTruthy(); expect(readCorrectionBookmark(scope)).toMatchObject({ bookmark: { requestId: 'new' } });
  expect(screen.queryByText('開啟新的更正')).toBeNull();
});
it('does not load malformed metadata and requires manual acknowledgement', () => {
  rememberCorrectionBookmark(scope, 'r'); sessionStorage.setItem(sessionStorage.key(0)!, 'invalid'); mount();
  expect(screen.getByRole('alert')).toBeTruthy(); expect(loadSavedCorrectionReceipt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '移除本頁提醒，返回名冊' }));
  expect(screen.getByText('開啟新的更正')).toBeTruthy();
});
