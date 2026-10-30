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
function snapshot(): SchoolLmsSnapshot {
  return { ownerUid: 'one', schoolId: 'pu', source: 'pu-tronclass', status: 'ongoing',
    fetchedAt: '2026-10-28T00:01:00Z', courses: [{ id: 100, name: '資料庫課堂', code: '1234',
      teachers: ['測試教師'], semester: '1151', status: 'ongoing', href: 'https://tronclass.pu.edu.tw/course/100/content' }],
  };
}
function props() {
  return { uid: 'one', schoolId: 'pu' as const, lms: snapshot(),
    returnUrl: '/school-courses?schoolId=pu&campus=pu', canReconnect: true };
}
beforeEach(() => {
  vi.mocked(loadAcademicRecords).mockReset().mockResolvedValue(academic());
});
async function start() {
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  return screen.findByRole('heading', { name: '資料庫管理' });
}

it('等使用者主動核對才讀取本人課表，不在開頁或搜尋時重登', async () => {
  render(<SchoolCourseReconciliation {...props()} />);
  expect(loadAcademicRecords).not.toHaveBeenCalled();
  await start();
  expect(loadAcademicRecords).toHaveBeenCalledWith('courses', 'one', 'pu');
  expect(screen.getByText('三 2–4 · 1655')).toBeTruthy();
  expect(screen.getByText('1 / 1 門')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往 資料庫管理 的對應課堂' }).getAttribute('href')).toBe('https://tronclass.pu.edu.tw/course/100/content');
  fireEvent.change(screen.getByLabelText('搜尋校方課程'), { target: { value: '１２３４' } });
  expect(screen.getByRole('heading', { name: '資料庫管理' })).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});

it('等待中防止連點產生重複請求', async () => {
  let finish!: (value: AcademicSnapshot<'courses'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<SchoolCourseReconciliation {...props()} />);
  const button = screen.getByRole('button', { name: '核對校方課表' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  await act(async () => { finish(academic()); });
  expect(await screen.findByRole('heading', { name: '資料庫管理' })).toBeTruthy();
});

it('校方小計未知時不補零或從 LMS 課程推算', async () => {
  const value = academic(); value.records.sourceTotalCredits = null;
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />);
  await start();
  expect(screen.getByText('校方未提供')).toBeTruthy();
  expect(screen.queryByText('0 學分')).toBeNull();
  expect(screen.getByText('2.5 學分')).toBeTruthy();
});

it('來源失敗不顯示零學分，重新核對可以恢復', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  expect((await screen.findByRole('alert')).textContent).toContain('校方課表暫時無法核對');
  expect(screen.queryByText('0 學分')).toBeNull();
  await start();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('官方課表無法取得時不顯示零學分也不要求重新登入', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('officialUnavailable'));
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('官方課表暫時無法取得');
  expect(screen.queryByText('0 學分')).toBeNull();
  expect(screen.queryByRole('link', { name: '重新連線 e 校園' })).toBeNull();
});

it('重新核對失敗不繼續顯示先前的成功對照', async () => {
  render(<SchoolCourseReconciliation {...props()} />); await start();
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('permission'));
  fireEvent.click(screen.getByRole('button', { name: '重新核對校方課表' }));
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  await screen.findByRole('alert');
  const target = new URL(screen.getByRole('link', { name: '重新連線 e 校園' }).getAttribute('href')!, 'https://campus.local');
  expect(target.searchParams.get('returnUrl')).toBe('/school-courses?schoolId=pu&campus=pu');
});

it('登入功能關閉時不提供無效的重新登入按鈕', async () => {
  vi.mocked(loadAcademicRecords).mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  render(<SchoolCourseReconciliation {...props()} canReconnect={false} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('link', { name: '重新連線 e 校園' })).toBeNull();
  expect(screen.getByRole('link', { name: '前往 e 校園 ↗' })).toBeTruthy();
});

it('帳號切換立即移除資料，A→B→A 不恢復舊對照', async () => {
  const original = props();
  const view = render(<SchoolCourseReconciliation {...original} />); await start();
  view.rerender(<SchoolCourseReconciliation {...original} uid="two" />);
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  view.rerender(<SchoolCourseReconciliation {...original} />);
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});

it('切換 WOW Class 快照後忽略舊核對回應', async () => {
  let finish!: (value: AcademicSnapshot<'courses'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const original = props();
  const view = render(<SchoolCourseReconciliation {...original} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  view.rerender(<SchoolCourseReconciliation {...original} lms={{ ...snapshot(), status: 'completed' }} />);
  await act(async () => { finish(academic()); });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(screen.getByRole('button', { name: '核對校方課表' }).hasAttribute('disabled')).toBe(false);
});

it('相同時間戳但內容不同的新快照不沿用舊對照', async () => {
  const original = props();
  const view = render(<SchoolCourseReconciliation {...original} />); await start();
  view.rerender(<SchoolCourseReconciliation {...original} lms={{ ...original.lms, courses: [] }} />);
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});

it('錯誤 owner 或跨校資料不能出現在核對畫面', async () => {
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce({ ...academic(), ownerUid: 'other' });
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  await screen.findByRole('alert');
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

it('超過第一批的課程仍可完整展開，不增加來源讀取', async () => {
  const value = academic(); value.records.courses = Array.from({ length: 15 }, (_, index) => ({ ...value.records.courses[0], id: String(index), code: String(2000 + index), name: `測試課程 ${index}` }));
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  await screen.findByRole('heading', { name: '測試課程 0' });
  expect(screen.queryByRole('heading', { name: '測試課程 14' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '顯示更多校方課程（還有 3 門）' }));
  expect(screen.getByRole('heading', { name: '測試課程 14' })).toBeTruthy();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
});

it('多時段不重複學分，模糊配對不生成直接關聯', async () => {
  const value = academic(); value.records.courses.push({ ...value.records.courses[0], id: 'second-time', timePlaceRaw: '五 2' });
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  const source = snapshot(); source.courses.push({ ...source.courses[0], id: 101 });
  render(<SchoolCourseReconciliation {...props()} lms={source} />); await start();
  expect(screen.getByText('三 2–4 · 1655')).toBeTruthy();
  expect(screen.getByText('五 2 · 1655')).toBeTruthy();
  expect(screen.getByText('0 / 1 門')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '前往 資料庫管理 的對應課堂' })).toBeNull();
  expect(screen.getByText('同課號有多筆資料，需核對')).toBeTruthy();
});

it('空的官方選課回應維持明確邊界', async () => {
  const value = academic(); value.records.courses = []; value.records.sourceTotalCredits = null;
  vi.mocked(loadAcademicRecords).mockResolvedValueOnce(value);
  render(<SchoolCourseReconciliation {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  expect(await screen.findByText('這次校方回應沒有可核對的選課列；不表示沒有修課，也不據此判定零學分。')).toBeTruthy();
  const panel = screen.getByRole('region', { name: '校方課表與 WOW Class 對照' });
  expect(within(panel).queryByText('0 學分')).toBeNull();
});


it('WOW Class 失敗時仍可讀取 e 校園，不把另一來源偽裝成空清單', async () => {
  render(<SchoolCourseReconciliation {...props()} lms={null} />); await start();
  expect(screen.getByText('三 2–4 · 1655')).toBeTruthy();
  expect(screen.getByText('尚未對照')).toBeTruthy();
  expect(screen.getByText('WOW Class 未連線，尚未對照')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '前往 資料庫管理 的對應課堂' })).toBeNull();
  expect(screen.queryByText('0 / 1 門')).toBeNull();
});


it('來源 A→B→A 不恢復舊結果，晚到回應也不復活', async () => {
  const original = props();
  const view = render(<SchoolCourseReconciliation {...original} />); await start();
  let finish!: (value: AcademicSnapshot<'courses'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '重新核對校方課表' }));
  view.rerender(<SchoolCourseReconciliation {...original} lms={null} />);
  view.rerender(<SchoolCourseReconciliation {...original} />);
  await act(async () => { finish(academic()); });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(screen.getByRole('button', { name: '核對校方課表' }).hasAttribute('disabled')).toBe(false);
  await start();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(3);
});

it('離頁後回應不帶入重新開啟的工作區', async () => {
  let finish!: (value: AcademicSnapshot<'courses'>) => void;
  vi.mocked(loadAcademicRecords).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const original = props();
  const view = render(<SchoolCourseReconciliation {...original} />);
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  view.unmount();
  render(<SchoolCourseReconciliation {...original} />);
  await act(async () => { finish(academic()); });
  expect(screen.queryByRole('heading', { name: '資料庫管理' })).toBeNull();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(1);
  await start();
  expect(loadAcademicRecords).toHaveBeenCalledTimes(2);
});
