import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AcademicConnectionError, loadAcademicRecords, type AcademicSnapshot } from '@/lib/academicClient';
import type { SchoolLmsSnapshot } from '@/lib/tronClassCourses';
import { SchoolCourseReconciliation } from './SchoolCourseReconciliation';

vi.mock('@/lib/academicClient', () => ({
  loadAcademicRecords: vi.fn(),
  AcademicConnectionError: class extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));
function academic(): AcademicSnapshot<'courses'> {
  return { ownerUid: 'one', schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z', records: {
    semester: '1151', totalCredits: 2.5, sourceTotalCredits: 2.5,
    studentInfo: { class: null, studentId: null, name: null },
    courses: [{ id: 'academic-1', code: '1234', name: '資料庫管理', nameEn: '', semester: '1151',
      classOffered: '資管三B', courseType: '必修', credits: 2.5, teacherName: '測試教師', teacherEmail: '',
      timePlaceRaw: '三 2–4', location: '1655', dayOfWeek: 3, periods: [2, 3, 4],
      startTime: null, endTime: null, scheduleWarning: null }],
  } };
}
function snapshot(id = 100): SchoolLmsSnapshot {
  return { ownerUid: 'one', schoolId: 'pu', source: 'pu-tronclass', status: 'ongoing',
    fetchedAt: '2026-10-28T00:01:00Z', courses: [{ id, name: '資料庫課堂', code: '1234',
      teachers: ['測試教師'], semester: '1151', status: 'ongoing', href: `https://tronclass.pu.edu.tw/course/${id}/content` }],
  };
}
function props() {
  return { uid: 'one', schoolId: 'pu' as const, lms: snapshot(),
    returnUrl: '/school-courses?schoolId=pu&campus=pu', canReconnect: true };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const matchedLink = () => screen.queryByRole('link', { name: '前往 資料庫管理 的對應課堂' });
beforeEach(() => { vi.mocked(loadAcademicRecords).mockReset().mockResolvedValue(academic()); });
async function start() {
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  return screen.findByRole('heading', { name: '資料庫管理' });
}

it('等使用者主動核對才讀取本人課表，搜尋不再讀學校', async () => {
  render(<SchoolCourseReconciliation {...props()} />);
  expect(loadAcademicRecords).not.toHaveBeenCalled(); await start();
  expect(loadAcademicRecords).toHaveBeenCalledWith('courses', 'one', 'pu');
  expect(screen.getByText('三 2–4 · 1655')).toBeTruthy();
  expect(screen.getByText('1 / 1 門')).toBeTruthy();
  expect(matchedLink()?.getAttribute('href')).toBe('https://tronclass.pu.edu.tw/course/100/content');
  fireEvent.change(screen.getByLabelText('搜尋校方課程'), { target: { value: '１２３４' } });
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('等待中防止連點產生重複請求', async () => {
  const pending = deferred<AcademicSnapshot<'courses'>>();
  vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  render(<SchoolCourseReconciliation {...props()} />);
  const button = screen.getByRole('button', { name: '核對校方課表' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(academic()); });
  expect(await screen.findByRole('heading', { name: '資料庫管理' })).toBeTruthy();
});
it('校方小計未知時不補零或從 LMS 推算', async () => {
  const value = academic(); value.records.sourceTotalCredits = null;
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />); await start();
  expect(screen.getByText('校方未提供')).toBeTruthy();
  expect(screen.queryByText('0 學分')).toBeNull(); expect(screen.getByText('2.5 學分')).toBeTruthy();
});
it('來源失敗不顯示零學分，重新核對可以恢復', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  expect((await screen.findByRole('alert')).textContent).toContain('校方課表暫時無法核對');
  expect(screen.queryByText('0 學分')).toBeNull(); await start(); expect(screen.queryByRole('alert')).toBeNull();
});
it('重新核對失敗不繼續顯示先前的成功對照', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('permission'));
  fireEvent.click(screen.getByRole('button', { name: '重新核對校方課表' }));
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull(); await screen.findByRole('alert');
  const target = new URL(screen.getByRole('link', { name: '重新連線 e 校園' }).getAttribute('href')!, 'https://campus.local');
  expect(target.searchParams.get('returnUrl')).toBe('/school-courses?schoolId=pu&campus=pu');
});
it('登入功能關閉時不提供無效的重新登入按鈕', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  render(<SchoolCourseReconciliation {...props()} canReconnect={false} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' })); await screen.findByRole('alert');
  expect(screen.queryByRole('link', { name: '重新連線 e 校園' })).toBeNull();
  expect(screen.getByRole('link', { name: '前往 e 校園 ↗' })).toBeTruthy();
});
it('帳號 A→B→A 仍立即移除私有資料，不恢復舊對照', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  view.rerender(<SchoolCourseReconciliation {...original} uid="two" />);
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  view.rerender(<SchoolCourseReconciliation {...original} />);
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('LMS 切換期間完成的本人課表，只與目前快照對照，不採用舊課堂', async () => {
  const pending = deferred<AcademicSnapshot<'courses'>>();
  vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  view.rerender(<SchoolCourseReconciliation {...original} lms={snapshot(201)} />);
  await act(async () => { pending.resolve(academic()); });
  expect(await screen.findByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(matchedLink()?.getAttribute('href')).toContain('/201/content');
  expect(screen.queryByRole('link', { name: /100/ })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('同時間戳的新空快照移除舊配對，但保留校方學分', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  view.rerender(<SchoolCourseReconciliation {...original} lms={{ ...original.lms, courses: [] }} />);
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(matchedLink()).toBeNull(); expect(screen.getByText('0 / 1 門')).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('錯誤 owner 的校方資料不能出現在畫面', async () => {
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce({ ...academic(), ownerUid: 'other' });
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' })); await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
});
it('待核對篩選與搜尋只在裝置上處理', async () => {
  const value = academic(); value.records.courses.push({ ...value.records.courses[0], id: '2', code: '5678', name: '統計學' });
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />); await start();
  fireEvent.click(screen.getByRole('button', { name: '只看待核對（1）' }));
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(screen.getByRole('heading', { name: '統計學' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋校方課程'), { target: { value: '不存在' } });
  expect(screen.getByText('沒有符合條件的課程，請調整搜尋或待核對篩選。')).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('分批展開不增加來源讀取', async () => {
  const value = academic(); value.records.courses = Array.from({ length: 15 }, (_, index) => ({ ...value.records.courses[0], id: String(index), code: String(2000 + index), name: `測試課程 ${index}` }));
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' })); await screen.findByRole('heading', { name: '測試課程 0' });
  expect(screen.queryByRole('heading', { name: '測試課程 14' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '顯示更多校方課程（還有 3 門）' }));
  expect(screen.getByRole('heading', { name: '測試課程 14' })).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('多時段不重複學分，模糊配對不生成關聯', async () => {
  const value = academic(); value.records.courses.push({ ...value.records.courses[0], id: 'second-time', timePlaceRaw: '五 2' });
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  const source = snapshot(); source.courses.push({ ...source.courses[0], id: 101 });
  render(<SchoolCourseReconciliation {...props()} lms={source} />); await start();
  expect(screen.getByText('三 2–4 · 1655')).toBeTruthy(); expect(screen.getByText('五 2 · 1655')).toBeTruthy();
  expect(screen.getByText('0 / 1 門')).toBeTruthy(); expect(matchedLink()).toBeNull();
  expect(screen.getByText('同課號有多筆資料，需核對')).toBeTruthy();
});
it('空的官方選課回應不等於沒有修課或零學分', async () => {
  const value = academic(); value.records.courses = []; value.records.sourceTotalCredits = null;
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  expect(await screen.findByText('這次校方回應沒有可核對的選課列；不表示沒有修課，也不據此判定零學分。')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '校方課表與 WOW Class 對照' })).queryByText('0 學分')).toBeNull();
});
it('WOW Class 失敗仍可讀校方課表，不偽裝成空清單', async () => {
  render(<SchoolCourseReconciliation {...props()} lms={null} />); await start();
  expect(screen.getByText('三 2–4 · 1655')).toBeTruthy(); expect(screen.getByText('尚未對照')).toBeTruthy();
  expect(screen.getByText('WOW Class 未連線，尚未對照')).toBeTruthy(); expect(matchedLink()).toBeNull();
  expect(screen.queryByText('0 / 1 門')).toBeNull();
});
it('LMS A→B→A 重新計算當前連結，校務來源不必重抓', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  view.rerender(<SchoolCourseReconciliation {...original} lms={snapshot(201)} />);
  expect(matchedLink()?.getAttribute('href')).toContain('/201/content');
  view.rerender(<SchoolCourseReconciliation {...original} lms={null} lmsStatus="loading" />);
  expect(matchedLink()).toBeNull(); expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  view.rerender(<SchoolCourseReconciliation {...original} />);
  expect(matchedLink()?.getAttribute('href')).toContain('/100/content');
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('離頁後回應不帶入重新開啟的工作區', async () => {
  const pending = deferred<AcademicSnapshot<'courses'>>();
  vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' })); view.unmount();
  render(<SchoolCourseReconciliation {...original} />);
  await act(async () => { pending.resolve(academic()); });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1); await start();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});
it('等待 LMS 時可先讀取本人課表，LMS 回來才補上配對', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} lms={null} lmsStatus="loading" />);
  await start(); expect(screen.getByText('等待課堂資料')).toBeTruthy(); expect(matchedLink()).toBeNull();
  view.rerender(<SchoolCourseReconciliation {...original} lmsStatus="ready" />);
  expect(matchedLink()).toBeTruthy(); expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('LMS 更新與失敗不清除校方資料或使用者搜尋', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  fireEvent.change(screen.getByLabelText('搜尋校方課程'), { target: { value: '１２３４' } });
  view.rerender(<SchoolCourseReconciliation {...original} lmsStatus="refreshing" />);
  expect(matchedLink()).toBeNull(); expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  view.rerender(<SchoolCourseReconciliation {...original} lms={null} lmsStatus="unavailable" />);
  expect((screen.getByLabelText('搜尋校方課程') as HTMLInputElement).value).toBe('１２３４');
  expect(screen.getByText('尚未對照')).toBeTruthy(); expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});
it('LMS owner 不符只停用課堂對照，不隱藏已驗證的校方課表', async () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />); await start();
  view.rerender(<SchoolCourseReconciliation {...original} lms={{ ...snapshot(201), ownerUid: 'other' }} />);
  expect(screen.getByRole('alert').textContent).toContain('未採用這份 WOW Class 清單');
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy(); expect(matchedLink()).toBeNull();
  view.rerender(<SchoolCourseReconciliation {...original} />);
  expect(screen.queryByRole('alert')).toBeNull(); expect(matchedLink()).toBeTruthy();
});
it('帳號切換後即使再切回，舊帳號未完成回應也不能復活', async () => {
  const pending = deferred<AcademicSnapshot<'courses'>>(); vi.mocked(loadAcademicRecords).mockReturnValueOnce(pending.promise);
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  view.rerender(<SchoolCourseReconciliation {...original} uid="two" />);
  view.rerender(<SchoolCourseReconciliation {...original} />);
  await act(async () => { pending.resolve(academic()); });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull(); await start();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});
it('新 LMS 快照本身不觸發未經操作的校方讀取', () => {
  const original = props(); const view = render(<SchoolCourseReconciliation {...original} lms={null} lmsStatus="loading" />);
  view.rerender(<SchoolCourseReconciliation {...original} />);
  view.rerender(<SchoolCourseReconciliation {...original} lms={snapshot(201)} />);
  expect(loadAcademicRecords).not.toHaveBeenCalled(); expect(matchedLink()).toBeNull();
});
it('StrictMode 生命週期清理後仍可核對，不重複發出請求', async () => {
  render(<StrictMode><SchoolCourseReconciliation {...props()} /></StrictMode>);
  await start(); expect(loadAcademicRecords).toHaveBeenCalledTimes(1); expect(matchedLink()).toBeTruthy();
});
