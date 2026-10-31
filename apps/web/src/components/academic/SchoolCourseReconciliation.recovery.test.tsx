import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from '@/lib/academicClient';
import type { SchoolLmsSnapshot } from '@/lib/tronClassCourses';
import { SchoolCourseReconciliation } from './SchoolCourseReconciliation';

vi.mock('@/lib/academicClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/academicClient')>(), loadAcademicRecords: vi.fn(),
}));
function academic(name = '資料庫管理'): AcademicSnapshot<'courses'> {
  return { ownerUid: 'one', schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z', records: {
    semester: '1151', totalCredits: 2.5, sourceTotalCredits: 2.5,
    studentInfo: { class: null, studentId: null, name: null },
    courses: [{ id: 'a1', code: '1234', name, nameEn: '', semester: '1151', classOffered: '資管三B',
      courseType: '必修', credits: 2.5, teacherName: '測試教師', teacherEmail: '', timePlaceRaw: '三 2–4',
      location: '1655', dayOfWeek: 3, periods: [2, 3, 4], startTime: null, endTime: null, scheduleWarning: null }],
  } };
}
function lms(id = 100): SchoolLmsSnapshot {
  return { ownerUid: 'one', schoolId: 'pu', source: 'pu-tronclass', status: 'ongoing', fetchedAt: '2026-10-28T00:01:00Z',
    courses: [{ id, code: '1234', name: '資料庫課堂', teachers: [], semester: '1151', status: 'ongoing', href: `https://tronclass.pu.edu.tw/course/${id}/content` }] };
}
const props = () => ({ uid: 'one', schoolId: 'pu' as const, lms: lms(), returnUrl: '/school-courses?schoolId=pu', canReconnect: true });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const match = () => screen.queryByRole('link', { name: '前往 資料庫管理 的對應課堂' });
const refresh = () => fireEvent.click(screen.getByRole('button', { name: '重新核對校方課表' }));
const latestSignal = () => vi.mocked(loadAcademicRecords).mock.calls.at(-1)?.[3]?.signal;
async function start() {
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  await screen.findByRole('link', { name: '前往 資料庫管理 的對應課堂' });
}
beforeEach(() => { vi.mocked(loadAcademicRecords).mockReset().mockResolvedValue(academic()); });

it('更新中保留前次學分、搜尋及時間，但不顯示成功配對', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  const source = screen.getByText(/^e 校園：/).textContent!.split('；')[0];
  fireEvent.change(screen.getByLabelText('搜尋校方課程'), { target: { value: '１２３４' } });
  const pending = deferred<AcademicSnapshot<'courses'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  refresh();
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(screen.getByText('前次校方選課學分小計')).toBeTruthy();
  expect(screen.getByText(/^e 校園：/).textContent).toContain(source);
  expect((screen.getByLabelText('搜尋校方課程') as HTMLInputElement).value).toBe('１２３４');
  expect(match()).toBeNull(); expect(screen.queryByText('1 / 1 門')).toBeNull();
  await act(async () => { pending.resolve(academic()); });
  expect(match()).toBeTruthy();
  expect((screen.getByLabelText('搜尋校方課程') as HTMLInputElement).value).toBe('１２３４');
});
it('暫時失敗保留前次資料，重試後才更新時間與對照', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  refresh(); await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(screen.getByText('校方課表更新未完成')).toBeTruthy(); expect(match()).toBeNull();
  const next = { ...academic(), fetchedAt: '2026-10-29T02:00:00Z' };
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(next); refresh();
  await waitFor(() => expect(match()).toBeTruthy());
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText(/^e 校園：/).textContent).toContain('10/29');
});
it.each(['permission', 'reconnect', 'unconfigured'] as const)('%s 失敗清除前次私有資料', async (reason) => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError(reason));
  refresh(); await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull(); expect(match()).toBeNull();
  expect(screen.queryByText('前次校方選課學分小計')).toBeNull();
});
it('取消首次讀取會中止 signal、恢復焦點並忽略晚到結果', async () => {
  const pending = deferred<AcademicSnapshot<'courses'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' })); const signal = latestSignal();
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(signal?.aborted).toBe(true); expect(document.activeElement).toBe(screen.getByRole('button', { name: '核對校方課表' }));
  expect(screen.getByText('已取消這次讀取，尚未取得校方課表。可以重新核對。')).toBeTruthy();
  await act(async () => { pending.resolve(academic('過期回應')); });
  expect(screen.queryByRole('heading', { name: '過期回應' })).toBeNull();
});
it('取消更新保留前次資料，立即重試不被舊 finally 或錯誤打斷', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  const old = deferred<AcademicSnapshot<'courses'>>(); const next = deferred<AcademicSnapshot<'courses'>>();
  vi.mocked(loadAcademicRecords).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  refresh(); const oldSignal = latestSignal(); fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(oldSignal?.aborted).toBe(true); expect(match()).toBeNull();
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy(); refresh();
  const newSignal = latestSignal(); expect(newSignal).not.toBe(oldSignal); expect(newSignal?.aborted).toBe(false);
  await act(async () => { old.reject(new AcademicConnectionError('permission')); });
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByRole('button', { name: '正在核對…' }).hasAttribute('disabled')).toBe(true);
  await act(async () => { next.resolve(academic()); }); expect(match()).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(3);
});
it('校方更新失敗後，新的 LMS 快照不能自行恢復對照', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable')); refresh(); await screen.findByRole('alert');
  view.rerender(<SchoolCourseReconciliation {...original} lms={lms(201)} />);
  expect(match()).toBeNull(); expect(screen.getByText('等待重新核對')).toBeTruthy();
  refresh(); await waitFor(() => expect(match()?.getAttribute('href')).toContain('/201/content'));
});
it('重新核對來源身分不符時清除舊資料，不只拒絕新列', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce({ ...academic('別人課表'), ownerUid: 'other' });
  refresh(); await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(screen.queryByRole('heading', { name: '別人課表' })).toBeNull(); expect(match()).toBeNull();
});
it('未知程式錯誤不當成可沿用資料的網路錯誤', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new Error('unexpected'));
  refresh(); await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
});
it('離頁中止請求，重新開啟不帶回前次資料', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  const pending = deferred<AcademicSnapshot<'courses'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  refresh(); const signal = latestSignal(); view.unmount(); expect(signal?.aborted).toBe(true);
  render(<SchoolCourseReconciliation {...original} />);
  await act(async () => { pending.resolve(academic()); });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull(); expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});
it('切換帳號會中止等待，切回也不還原前次資料', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  const pending = deferred<AcademicSnapshot<'courses'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  refresh(); const signal = latestSignal();
  view.rerender(<SchoolCourseReconciliation {...original} uid="two" />);
  expect(signal?.aborted).toBe(true); expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  view.rerender(<SchoolCourseReconciliation {...original} />);
  await act(async () => { pending.resolve(academic()); }); expect(match()).toBeNull();
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
});
it('更新成功保留待核對篩選與已展開的清單範圍', async () => {
  const value = academic(); value.records.courses.push(...Array.from({ length: 14 }, (_, i) => ({
    ...value.records.courses[0], id: `extra-${i}`, code: String(2000 + i), name: `待核對 ${i}`,
  })));
  vi.mocked(loadAcademicRecords).mockResolvedValue(value);
  render(<SchoolCourseReconciliation {...props()} />); await start();
  fireEvent.click(screen.getByRole('button', { name: '只看待核對（14）' }));
  fireEvent.click(screen.getByRole('button', { name: '顯示更多校方課程（還有 2 門）' }));
  refresh(); await waitFor(() => expect(screen.getByRole('button', { name: '只看待核對（14）' }).getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByRole('heading', { name: '待核對 13' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull(); expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});
