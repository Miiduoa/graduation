import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicCourseSearch } from './PublicCourseSearch';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import type { PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';

import {
  personalImportDraftKey, personalImportPartialDraftKey, readPersonalImportDraft, writePersonalImportDraft,
  writePersonalImportPartialDraft, type PersonalImportDraft,
} from '@/lib/personalImportDrafts';
import { readPersonalImports } from '@/lib/personalImports';

const importContext = vi.hoisted(() => ({ scope: { owner: 'guest', schoolId: 'ncnu' }, canPrepareSchoolDraft: true }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/usePersonalImports', async (load) => ({
  ...await load<typeof import('@/lib/usePersonalImports')>(),
  usePersonalImportScope: () => ({ ...importContext, loading: false, scopeKey: importContext.scope.owner + ':' + importContext.scope.schoolId, schoolName: '國立暨南國際大學' }),
}));
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  importContext.scope = { owner: 'guest', schoolId: 'ncnu' };
  importContext.canPrepareSchoolDraft = true;
  push.mockReset();
});

const course: PublicCatalogCourse = {
  semester: '1151', code: '005076', section: 'a', title: '專業實習（一）', teacher: '林妙容',
  department: '諮人系', room: 'A307系會議室', time: '5bcd', credits: '3.0',
};
const props = { schoolId: 'ncnu' as const, schoolName: '國立暨南國際大學', schoolSearch: '?campus=ncnu' };
const nthuCourse: PublicCatalogCourse = {
  semester: '1151', code: '11510AES 520300', section: '00', title: '環境化學',
  department: 'AES', teacher: '董瑞安\tDOONG, RUEY-AN', credits: '3',
  time: 'M3M4\nF3F4', room: 'BMES醫環618\nBMES醫環501',
  meetings: [{ time: 'M3M4', room: 'BMES醫環618' }, { time: 'F3F4', room: 'BMES醫環501' }],
};
const nthuProps = { schoolId: 'nthu' as const, schoolName: '國立清華大學', schoolSearch: '?campus=nthu' };
function response(courses: PublicCatalogCourse[], extra: Record<string, unknown> = {}) {
  const sourceUrl = extra.schoolId === 'nthu'
    ? 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json'
    : 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall';
  return Response.json({ schoolId: 'ncnu', sourceUrl, fetchedAt: '2026-11-06T08:00:00.000Z', truncated: false, courses, ...extra });
}
function filteredResponse(courses: PublicCatalogCourse[], filters: PublicCourseFilters, extra: Record<string, unknown> = {}) {
  const schoolId = extra.schoolId === 'nthu' ? 'nthu' : 'ncnu';
  return response(courses, {
    filters, unresolvedCount: 0,
    operation: { id: `${schoolId}.courses.search`, version: 2, responseSchemaVersion: 2, access: 'anonymous-public' },
    ...extra,
  });
}
function submit(query: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  fireEvent.submit(screen.getByRole('search', { name: '搜尋校方開課資料' }));
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('carries linked weekday and credits into a verified search and imports every meeting of a matching course', async () => {
  const multiDay = { ...course, time: '3cd4i' };
  const fetcher = vi.fn().mockResolvedValue(filteredResponse([multiDay], { weekday: 3, credits: 3 }, { unresolvedCount: 2 }));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} queryParameters={['005076']} weekdayParameters={['3']} creditsParameters={['3']} />);
  expect(await screen.findByRole('heading', { name: course.title })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=ncnu&q=005076&weekday=3&credits=3', expect.objectContaining({ credentials: 'omit' }));
  expect((screen.getByRole('combobox', { name: '上課星期' }) as HTMLSelectElement).value).toBe('3');
  expect((screen.getByLabelText('學分（完全符合）') as HTMLInputElement).value).toBe('3');
  expect(screen.getByText('已套用條件：關鍵字「005076」 · 星期三有課 · 3 學分')).toBeTruthy();
  expect(screen.getByText(/也可能在其他天上課/)).toBeTruthy();
  expect(screen.getByText(/另有 2 筆資料無法確認/)).toBeTruthy();
  expect(screen.getByText(/星期三 c、d 節.*星期四 i 節/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '帶入課表核對' }));
  expect(readPersonalImportDraft(importContext.scope)?.rows.map(row => row.dayOfWeek)).toEqual([3, 4]);
  expect(readPersonalImports(importContext.scope)).toEqual([]);
});

it('allows filter-only links and distinguishes zero credits from an unlimited search', async () => {
  const fetcher = vi.fn().mockResolvedValue(filteredResponse([{ ...course, credits: '0' }], { credits: 0 }));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} creditsParameters={['0']} />);
  expect(await screen.findByRole('heading', { name: course.title })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=ncnu&credits=0', expect.anything());
  expect(screen.getByText('已套用條件：關鍵字不限 · 0 學分')).toBeTruthy();
});

it.each([
  { weekdayParameters: ['3', '4'], creditsParameters: ['3'] },
  { weekdayParameters: [''], creditsParameters: [] },
  { weekdayParameters: ['8'], creditsParameters: [] },
  { weekdayParameters: ['3'], creditsParameters: ['3', '2'] },
  { weekdayParameters: [], creditsParameters: [''] },
  { weekdayParameters: [], creditsParameters: ['3.001'] },
])('does not silently drop invalid linked filters: %j', async (parameters) => {
  const fetcher = vi.fn().mockResolvedValue(response([]));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} queryParameters={['資料庫']} {...parameters} />);
  expect(screen.getByRole('alert').textContent).toContain('篩選條件無效或重複');
  expect(fetcher).not.toHaveBeenCalled();
  submit('老師姓名');
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  await screen.findByText(/沒有找到「老師姓名」課程/);
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=ncnu&q=' + encodeURIComponent('老師姓名'), expect.anything());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('已套用條件：關鍵字「老師姓名」 · 星期與學分不限')).toBeTruthy();
});

it('validates edited credits without converting invalid text to an unlimited query', async () => {
  const fetcher = vi.fn().mockResolvedValue(filteredResponse([], { weekday: 7, credits: 2.5 }));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: '上課星期' }), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('學分（完全符合）'), { target: { value: '3abc' } });
  submit('資料庫');
  expect(screen.getByRole('alert').textContent).toContain('學分請填 0～40');
  expect((screen.getByLabelText('學分（完全符合）') as HTMLInputElement).value).toBe('3abc');
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('學分（完全符合）'), { target: { value: '2.50' } });
  fireEvent.submit(screen.getByRole('search', { name: '搜尋校方開課資料' }));
  await screen.findByText(/沒有找到「資料庫」課程/);
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=ncnu&q=' + encodeURIComponent('資料庫') + '&weekday=7&credits=2.5', expect.anything());
  expect(screen.getByText('已套用條件：關鍵字「資料庫」 · 星期日有課 · 2.5 學分')).toBeTruthy();
});

it.each(['fetch', 'body'])('cancels a same-keyword lookup when a filter is edited and ignores its late %s', async (stage) => {
  let finish!: () => void;
  const original = filteredResponse([course], { weekday: 5, credits: 3 });
  const originalBody = await original.clone().json();
  const delayed = new Promise<unknown>((resolve) => {
    finish = () => resolve(stage === 'fetch' ? original : originalBody);
  });
  const fetcher = vi.fn()
    .mockReturnValueOnce(stage === 'fetch' ? delayed : Promise.resolve({ ok: true, json: () => delayed }))
    .mockResolvedValueOnce(filteredResponse([], { weekday: 3, credits: 3 }));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} queryParameters={['005076']} weekdayParameters={['5']} creditsParameters={['3']} />);
  fireEvent.change(screen.getByRole('combobox', { name: '上課星期' }), { target: { value: '3' } });
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.queryByText(/正在查詢/)).toBeNull();
  expect(screen.queryByText(/已套用條件|本次查詢條件/)).toBeNull();
  fireEvent.submit(screen.getByRole('search', { name: '搜尋校方開課資料' }));
  await screen.findByText(/沒有找到「005076」課程/);
  expect(fetcher.mock.calls[1][0]).toBe('/api/public-course-catalog?schoolId=ncnu&q=005076&weekday=3&credits=3');
  expect(screen.getByText('已套用條件：關鍵字「005076」 · 星期三有課 · 3 學分')).toBeTruthy();
  await act(async () => { finish(); });
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.queryByText(/星期五有課/)).toBeNull();
});

it('uses the full URL filter scope and cancels an old request when only the linked credits change', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(filteredResponse([], { weekday: 5, credits: 2 }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} queryParameters={['005076']} weekdayParameters={['5']} creditsParameters={['3']} />);
  view.rerender(<PublicCourseSearch {...props} queryParameters={['005076']} weekdayParameters={['5']} creditsParameters={['2']} />);
  await screen.findByText(/沒有找到「005076」課程/);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect((screen.getByLabelText('學分（完全符合）') as HTMLInputElement).value).toBe('2');
  expect(screen.getByText('已套用條件：關鍵字「005076」 · 星期五有課 · 2 學分')).toBeTruthy();
  await act(async () => { finish(filteredResponse([course], { weekday: 5, credits: 3 })); });
  expect(screen.queryByText(course.title)).toBeNull();
});

it('clears both filters while retaining keyword and campus and aborts the filtered request', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(response([], { schoolId: 'nthu' }));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...nthuProps} queryParameters={['環境化學']} weekdayParameters={['1']} creditsParameters={['3']} />);
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  await screen.findByText(/沒有找到「環境化學」課程/);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetcher.mock.calls[1][0]).toBe('/api/public-course-catalog?schoolId=nthu&q=' + encodeURIComponent('環境化學'));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('環境化學');
  expect((screen.getByRole('combobox', { name: '上課星期' }) as HTMLSelectElement).value).toBe('');
  expect((screen.getByLabelText('學分（完全符合）') as HTMLInputElement).value).toBe('');
  await act(async () => { finish(filteredResponse([nthuCourse], { weekday: 1, credits: 3 }, { schoolId: 'nthu' })); });
  expect(screen.queryByRole('heading', { name: nthuCourse.title })).toBeNull();
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
});

it.each(['missing-receipt', 'different-filters', 'nonmatching-course'])('rejects a filtered response with %s instead of presenting broader results', async (reason) => {
  const data = reason === 'missing-receipt' ? response([course])
    : reason === 'different-filters' ? filteredResponse([], { weekday: 3, credits: 3 })
      : filteredResponse([{ ...course, credits: '2' }], { weekday: 5, credits: 3 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(data));
  render(<PublicCourseSearch {...props} queryParameters={['005076']} weekdayParameters={['5']} creditsParameters={['3']} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.getByText('本次查詢條件：關鍵字「005076」 · 星期五有課 · 3 學分')).toBeTruthy();
  expect(screen.queryByText(/已套用條件/)).toBeNull();
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
});

it.each(['資料庫', '', '𠮷'.repeat(80)])('reads a single linked query without creating a timetable draft: %s', async (query) => {
  const fetcher = vi.fn().mockResolvedValue(response([]));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} queryParameters={[query]} />);
  await screen.findByText(/這次查詢沒有找到/);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(query);
  const url = new URL(fetcher.mock.calls[0][0], 'https://campus.local');
  expect(url.searchParams.get('schoolId')).toBe('ncnu');
  expect(url.searchParams.get('q') ?? '').toBe(query);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
  view.rerender(<PublicCourseSearch {...props} queryParameters={[query]} />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
  expect(readPersonalImports(importContext.scope)).toEqual([]);
});

it.each([
  { parameters: ['課'.repeat(81)], notice: /最多 80 個字/ },
  { parameters: ['𠮷'.repeat(81)], notice: /最多 80 個字/ },
  { parameters: [' '.repeat(81)], notice: /最多 80 個字/ },
  { parameters: ['第一個查詢', '第二個查詢'], notice: /多個查詢條件/ },
  { parameters: ['', ''], notice: /多個查詢條件/ },
])('keeps invalid linked queries editable and waits for an explicit corrected search: $parameters', async ({ parameters, notice }) => {
  const fetcher = vi.fn().mockResolvedValue(response([course]));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} queryParameters={parameters} />);
  expect(screen.getByRole('alert').textContent).toMatch(notice);
  const field = screen.getByRole('searchbox') as HTMLInputElement;
  expect(field.value).toBe(parameters[0]);
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(fetcher).not.toHaveBeenCalled();
  submit('005076');
  expect(await screen.findByRole('heading', { name: course.title })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('validates manually edited queries by Unicode code point without truncating input', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([]));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} />);
  const tooLong = '𠮷'.repeat(81);
  submit(tooLong);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(tooLong);
  expect(screen.getByRole('alert').textContent).toContain('最多 80 個字');
  expect(fetcher).not.toHaveBeenCalled();
  const boundary = '𠮷'.repeat(80);
  submit(boundary);
  await screen.findByText(/這次查詢沒有找到/);
  expect(new URL(fetcher.mock.calls[0][0], 'https://campus.local').searchParams.get('q')).toBe(boundary);
});

it.each(['fetch', 'body'])('cancels a linked query when the URL query changes and ignores the old %s', async (stage) => {
  let finish!: () => void;
  const delayed = new Promise<unknown>((resolve) => {
    finish = () => resolve(stage === 'fetch' ? response([course]) : {
      schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall', truncated: false, courses: [course],
    });
  });
  const fetcher = vi.fn()
    .mockReturnValueOnce(stage === 'fetch' ? delayed : Promise.resolve({ ok: true, json: () => delayed }))
    .mockResolvedValueOnce(response([]));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} queryParameters={['前一筆']} />);
  view.rerender(<PublicCourseSearch {...props} queryParameters={['下一筆']} />);
  expect(await screen.findByText(/沒有找到「下一筆」課程/)).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('下一筆');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { finish(); });
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.getByText(/沒有找到「下一筆」課程/)).toBeTruthy();
});

it.each([
  { parameters: undefined },
  { parameters: ['課'.repeat(81)] },
  { parameters: ['第一個', '第二個'] },
])('cancels an ongoing lookup when the link has no usable query: $parameters', async ({ parameters }) => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} queryParameters={['005076']} />);
  view.rerender(<PublicCourseSearch {...props} queryParameters={parameters} />);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(parameters?.[0] ?? '');
  expect(screen.queryByText(/正在查詢/)).toBeNull();
  if (parameters) expect(screen.getByRole('alert')).toBeTruthy();
  await act(async () => { finish(response([course])); });
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.queryByText(/顯示.*開課資料/)).toBeNull();
});

it('cancels the previous campus lookup before following the same linked query at another school', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(response([nthuCourse], { schoolId: 'nthu' }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} queryParameters={['化學']} />);
  view.rerender(<PublicCourseSearch {...nthuProps} queryParameters={['化學']} />);
  expect(await screen.findByRole('heading', { name: nthuCourse.title })).toBeTruthy();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(new URL(fetcher.mock.calls[1][0], 'https://campus.local').searchParams.get('schoolId')).toBe('nthu');
  await act(async () => { finish(response([course])); });
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.getByRole('heading', { name: nthuCourse.title })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '帶入課表核對' }));
  expect(screen.getByText(/請先確認目前帳號和所選校園為國立清華大學/)).toBeTruthy();
  expect(push).not.toHaveBeenCalled();
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
});

it('searches the public endpoint, distinguishes sections and copies a school-scoped reviewable row', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([course, { ...course, section: 'b', time: '' }]));
  vi.stubGlobal('fetch', fetcher);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<PublicCourseSearch {...props} />);
  expect(fetcher).not.toHaveBeenCalled();
  submit('005076');
  const rows = await screen.findAllByRole('listitem');
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=ncnu&q=005076', expect.objectContaining({ credentials: 'omit' }));
  expect(rows).toHaveLength(2);
  expect(screen.getByText('校方資料擷取：2026-11-06 16:00（台灣時間；非校方更新時間）')).toBeTruthy();
  expect(rows[0].textContent).toContain('115 學年度第 1 學期 · 課號 005076 · 班別 a');
  expect(rows[0].textContent).toContain('星期五 b、c、d 節');
  expect(rows[1].textContent).toMatch(/班別 b.*校方節次未提供/);
  fireEvent.click(within(rows[0]).getByRole('button', { name: '複製課表匯入資料' }));
  expect((await screen.findByRole('link', { name: '前往課表匯入' })).getAttribute('href')).toBe('/import?kind=timetable&campus=ncnu');
  expect(within(rows[1]).queryByRole('button')).toBeNull();
  expect(writeText).toHaveBeenCalledWith(ncnuTimetableImportCsv(course));
});


it('serializes course clipboard writes and shows confirmation only for the latest selected class', async () => {
  const second = { ...course, code: '005077', title: '資料科學實作', time: '3cd4i' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([course, second])));
  let finishFirst!: () => void;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<PublicCourseSearch {...props} />);
  submit('課');
  const cards = await screen.findAllByRole('listitem');
  expect(cards).toHaveLength(2);
  fireEvent.click(within(cards[0]).getByRole('button', { name: '複製課表匯入資料' }));
  await act(async () => { await Promise.resolve(); });
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(ncnuTimetableImportCsv(course));
  fireEvent.click(within(cards[1]).getByRole('button', { name: '複製課表匯入資料' }));
  expect(within(cards[0]).queryByText(/已複製/)).toBeNull();
  await act(async () => { finishFirst(); });
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText).toHaveBeenLastCalledWith(ncnuTimetableImportCsv(second));
  expect(within(cards[0]).queryByText(/已複製/)).toBeNull();
  expect(within(cards[1]).getByText(/已複製/)).toBeTruthy();
  expect(within(cards[0]).queryByRole('link', { name: '前往課表匯入' })).toBeNull();
  expect(within(cards[1]).getByRole('link', { name: '前往課表匯入' })).toBeTruthy();
});

it('skips an obsolete queued copy before it reaches the clipboard, even across two classes', async () => {
  const second = { ...course, code: '005077', title: '資料科學實作', time: '3cd4i' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([course, second])));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<PublicCourseSearch {...props} />);
  submit('課');
  const cards = await screen.findAllByRole('listitem');
  fireEvent.click(within(cards[0]).getByRole('button', { name: '複製課表匯入資料' }));
  fireEvent.click(within(cards[1]).getByRole('button', { name: '複製課表匯入資料' }));
  expect(await within(cards[1]).findByText(/已複製/)).toBeTruthy();
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(ncnuTimetableImportCsv(second));
  expect(within(cards[0]).queryByText(/已複製/)).toBeNull();
});


it('does not resurrect copied feedback from an older search after its clipboard write completes', async () => {
  // Each fetch needs its own body: Response.json() can only be consumed once.
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response([course])));
  vi.stubGlobal('fetch', fetcher);
  let finish!: () => void;
  const clipboardWrite = new Promise<void>(resolve => { finish = resolve; });
  const writeText = vi.fn().mockReturnValue(clipboardWrite);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<PublicCourseSearch {...props} />);
  try {
    submit('第一個查詢');
    await screen.findByRole('heading', { name: course.title });
    fireEvent.click(screen.getByRole('button', { name: '複製課表匯入資料' }));
    await act(async () => { await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledTimes(1);
    submit('第二個查詢');
    await screen.findByRole('heading', { name: course.title });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/public-course-catalog?schoolId=ncnu&q=' + encodeURIComponent('第二個查詢'), expect.anything(),
    );
    await act(async () => { finish(); });
    expect(screen.queryByText(/已複製/)).toBeNull();
    expect(screen.queryByRole('link', { name: '前往課表匯入' })).toBeNull();
  } finally {
    // Release the shared clipboard queue even when an assertion fails.
    await act(async () => { finish(); });
  }
});

it('keeps only the latest result, including when the previous response arrives late', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(response([], { truncated: false }));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} />);
  submit('前一筆');
  expect(screen.getByRole('status').textContent).toContain('正在查詢');
  submit('下一筆');
  expect((await screen.findByText(/沒有找到「下一筆」課程/)).textContent).toContain('下一筆');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { finish(response([course])); });
  expect(screen.queryByText(course.title)).toBeNull();
});

it('handles malformed or wrong-campus replies as failure, retries, and explains the result limit', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([course], { schoolId: 'pu' }))
    .mockResolvedValueOnce(response([course], { truncated: true }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} />);
  submit('');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(course.title)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新查詢' }));
  expect(await screen.findByText('專業實習（一）')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('超過顯示上限');
  view.unmount();
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
});

it.each(['fetch', 'body'])('times out a stalled %s, retries the same query and ignores the late result', async (stage) => {
  vi.useFakeTimers();
  let finish!: () => void;
  const delayed = new Promise<unknown>((resolve) => {
    finish = () => resolve(stage === 'fetch' ? response([course]) : {
      schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall', truncated: false, courses: [course],
    });
  });
  const fetcher = vi.fn()
    .mockReturnValueOnce(stage === 'fetch' ? delayed : Promise.resolve({ ok: true, json: () => delayed }))
    .mockResolvedValueOnce(response([]));
  vi.stubGlobal('fetch', fetcher);
  render(<PublicCourseSearch {...props} />);
  await act(async () => { submit('005076'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(24_999); });
  expect(screen.getByRole('status').textContent).toContain('正在查詢');
  expect(screen.getByRole('button', { name: '查詢課程' }).hasAttribute('disabled')).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.getByRole('alert')).toBeTruthy();
  const retry = screen.getByRole('button', { name: '重新查詢' });
  expect(retry.hasAttribute('disabled')).toBe(false);
  await act(async () => { fireEvent.click(retry); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[0][0]);
  expect(screen.getByRole('status').textContent).toContain('沒有找到「005076」課程');
  await act(async () => { finish(); });
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('沒有找到「005076」課程');
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the request deadline when a pending search is unmounted', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>(() => undefined));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicCourseSearch {...props} />);
  await act(async () => { submit('005076'); });
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('round-trips exact weekdays, school period letters, section and term through the real importer', () => {
  const csv = ncnuTimetableImportCsv({ ...course, time: '3cd4i' });
  const imported = parsePersonalImport(csv!, { kind: 'timetable', schoolId: 'ncnu', academicYear: '999', semester: '2' });
  expect(imported.rows).toHaveLength(2);
  const row = { schoolId: 'ncnu', academicYear: '115', semester: '1', courseCode: '005076', className: 'a', location: course.room, teacher: course.teacher, credits: 3 };
  expect(imported.rows[0]).toMatchObject({ ...row, dayOfWeek: 3, periodLabel: 'cd' });
  expect(imported.rows[1]).toMatchObject({ ...row, dayOfWeek: 4, periodLabel: 'i' });
  expect(imported.issues.filter(issue => issue.severity === 'error')).toEqual([]);
  expect(imported.rows[0]).toMatchObject({ startTime: '10:10', endTime: '12:00' });
  expect(imported.rows[1]).toMatchObject({ startTime: '17:30', endTime: '18:20' });
  expect(imported.rows[1].startPeriod).toBeUndefined();
  expect(ncnuCourseMeetings('7z')?.[0].label).toBe('星期日 z 節');
  expect(ncnuTimetableImportCsv({ ...course, semester: '未提供' })).toBeNull();
  for (const time of ['', '另訂', '8abc', '1b2?', '1c2']) {
    expect(ncnuTimetableImportCsv({ ...course, time })).toBeNull();
  }
});


async function chooseCourse(schoolId: PublicCourseCatalogResponse['schoolId'] = 'ncnu') {
  const selected = schoolId === 'nthu' ? nthuCourse : { ...course, time: '3cd4i' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([selected], { schoolId })));
  const view = render(<PublicCourseSearch {...(schoolId === 'nthu' ? nthuProps : props)} />);
  submit(selected.code);
  fireEvent.click(await screen.findByRole('button', { name: '帶入課表核對' }));
  return view;
}

it('prepares both meetings for the current owner and opens the review section without saving any classes', async () => {
  importContext.scope.owner = 'platform:student';
  await chooseCourse();
  expect(push).toHaveBeenCalledWith('/import?kind=timetable&campus=ncnu#import-review');
  const draft = readPersonalImportDraft(importContext.scope);
  expect(draft?.rows.map(row => [row.schoolId, row.dayOfWeek, row.periodLabel])).toEqual([['ncnu', 3, 'cd'], ['ncnu', 4, 'i']]);
  expect(draft).toMatchObject({ kind: 'timetable', year: '115', semester: '1', rows: [{ courseCode: course.code }, { courseCode: course.code }] });
  expect(readPersonalImportDraft({ owner: 'guest', schoolId: 'ncnu' })).toBeNull();
  expect(readPersonalImports(importContext.scope)).toEqual([]);
});

it.each((['ncnu', 'nthu'] as const).flatMap((schoolId) =>
  ['full', 'partial', 'corrupt', 'wrong-school', 'unconfirmed', 'storage-error'].map((reason) => ({ schoolId, reason })),
))('preserves existing $schoolId work and offers manual copy when $reason', async ({ schoolId, reason }) => {
  importContext.scope.schoolId = schoolId;
  const scope = importContext.scope;
  const existing: PersonalImportDraft = { kind: 'grades', year: '115', semester: '1', text: '自己的成績草稿', source: { type: 'paste' }, rows: [], excluded: [], parseIssues: [], backup: null };
  if (reason === 'full') writePersonalImportDraft(scope, existing);
  if (reason === 'partial') writePersonalImportPartialDraft(scope, existing);
  if (reason === 'corrupt') sessionStorage.setItem(personalImportDraftKey(scope), '{broken');
  if (reason === 'wrong-school') scope.schoolId = 'pu';
  if (reason === 'unconfirmed') importContext.canPrepareSchoolDraft = false;
  const full = sessionStorage.getItem(personalImportDraftKey(scope));
  const partial = sessionStorage.getItem(personalImportPartialDraftKey(scope));
  const failed = reason === 'storage-error' ? vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }) : null;
  try {
    await chooseCourse(schoolId);
    expect(push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(personalImportDraftKey(scope))).toBe(full);
    expect(sessionStorage.getItem(personalImportPartialDraftKey(scope))).toBe(partial);
    expect(screen.getByText(/請先處理草稿|無法安全讀寫|請先確認目前帳號/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '複製課表匯入資料' })).toBeTruthy();
  } finally { failed?.mockRestore(); }
});

it.each(['ncnu', 'nthu'] as const)('restores the prepared %s draft in the actual import review workspace', async (schoolId) => {
  importContext.scope.schoolId = schoolId;
  const selected = schoolId === 'nthu' ? nthuCourse : course;
  const view = await chooseCourse(schoolId);
  const href = push.mock.calls[0][0];
  view.unmount();
  window.history.replaceState(null, '', href);
  try {
    const { PersonalImportCenter } = await import('@/components/imports/PersonalImportCenter');
    render(<PersonalImportCenter />);
    const review = await screen.findByRole('region', { name: '核對匯入資料' });
    expect(within(review).getAllByDisplayValue(selected.title.normalize('NFKC'))).toHaveLength(2);
    expect(within(review).getAllByDisplayValue(selected.code)).toHaveLength(2);
    if (schoolId === 'nthu') {
      expect(within(review).getByDisplayValue('BMES醫環618')).toBeTruthy();
      expect(within(review).getByDisplayValue('BMES醫環501')).toBeTruthy();
      expect(within(review).getAllByDisplayValue('10:10')).toHaveLength(2);
      expect(within(review).getAllByDisplayValue('12:00')).toHaveLength(2);
    }
    expect(readPersonalImports(importContext.scope)).toEqual([]);
  } finally { window.history.replaceState(null, '', '/'); }
});

it('keeps each NTHU meeting paired with its room and prepares the draft for the current owner', async () => {
  importContext.scope = { owner: 'platform:alice', schoolId: 'nthu' };
  const fetcher = vi.fn().mockResolvedValue(response([nthuCourse], { schoolId: 'nthu' }));
  vi.stubGlobal('fetch', fetcher);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const view = render(<PublicCourseSearch {...nthuProps} />);
  submit('環境化學');
  expect(await screen.findByRole('heading', { name: '環境化學' })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('/api/public-course-catalog?schoolId=nthu&q=' + encodeURIComponent('環境化學'), expect.objectContaining({ credentials: 'omit' }));
  expect(screen.getByText('星期一 3、4 節 · 10:10–12:00 · BMES醫環618')).toBeTruthy();
  expect(screen.getByText('星期五 3、4 節 · 10:10–12:00 · BMES醫環501')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '複製課表匯入資料' }));
  expect((await screen.findByRole('link', { name: '前往課表匯入' })).getAttribute('href')).toBe('/import?kind=timetable&campus=nthu');
  const copied = parsePersonalImport(writeText.mock.calls[0][0], { kind: 'timetable', schoolId: 'nthu', academicYear: '', semester: '' });
  expect(copied.issues.filter(issue => issue.severity === 'error')).toEqual([]);
  expect(copied.rows.map(row => [row.dayOfWeek, row.location, row.startTime, row.endTime])).toEqual([
    [1, 'BMES醫環618', '10:10', '12:00'], [5, 'BMES醫環501', '10:10', '12:00'],
  ]);
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
  importContext.scope = { owner: 'platform:bob', schoolId: 'nthu' };
  view.rerender(<PublicCourseSearch {...nthuProps} />);
  fireEvent.click(screen.getByRole('button', { name: '帶入課表核對' }));
  expect(push).toHaveBeenCalledWith('/import?kind=timetable&campus=nthu#import-review');
  const draft = readPersonalImportDraft(importContext.scope);
  expect(draft?.source.name).toBe('國立清華大學本學期開設課程');
  expect(draft?.rows.map(row => [row.courseCode, row.className, row.dayOfWeek, row.location])).toEqual([
    ['11510AES 520300', '00', 1, 'BMES醫環618'], ['11510AES 520300', '00', 5, 'BMES醫環501'],
  ]);
  expect(readPersonalImportDraft({ owner: 'platform:alice', schoolId: 'nthu' })).toBeNull();
  expect(readPersonalImportDraft({ owner: 'platform:bob', schoolId: 'ncnu' })).toBeNull();
  expect(readPersonalImports(importContext.scope)).toEqual([]);
});

it('keeps unpublished NTHU meeting times visible without importing only the known portion', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{
    ...nthuCourse, meetings: [{ time: 'M3M4', room: 'BMES醫環618' }, { time: '', room: 'BMES醫環501' }],
  }], { schoolId: 'nthu' })));
  render(<PublicCourseSearch {...nthuProps} />);
  submit('環境化學');
  expect(await screen.findByText('M3M4 · BMES醫環618')).toBeTruthy();
  expect(screen.getByText('時間未提供 · BMES醫環501')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '帶入課表核對' })).toBeNull();
  expect(screen.queryByRole('button', { name: '複製課表匯入資料' })).toBeNull();
});

it.each(['ncnu', 'nthu'] as const)('rejects a valid reply from the other public school while browsing %s', async (schoolId) => {
  const otherSchool = schoolId === 'nthu' ? 'ncnu' : 'nthu';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([otherSchool === 'nthu' ? nthuCourse : course], { schoolId: otherSchool })));
  render(<PublicCourseSearch {...(schoolId === 'nthu' ? nthuProps : props)} />);
  submit('');
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('link', { name: '校方課程目錄' }).getAttribute('href')).toContain(`.${schoolId}.edu.tw/`);
  expect(screen.queryByRole('listitem')).toBeNull();
});

it.each([
  { sourceUrl: 'https://example.test/unverified-courses' },
  { operation: { id: 'nthu.courses.search', version: 1, responseSchemaVersion: 1, access: 'anonymous-public' } },
  { operation: { id: 'ncnu.courses.search', version: 2, responseSchemaVersion: 1, access: 'anonymous-public' } },
])('does not offer timetable import for an unverified source or operation receipt: %j', async (extra) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([course], extra)));
  render(<PublicCourseSearch {...props} />);
  submit('005076');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(course.title)).toBeNull();
  expect(screen.queryByRole('button', { name: '帶入課表核對' })).toBeNull();
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
});

it.each(['ncnu', 'nthu'] as const)('keeps a public %s course readable but blocks a duplicate weekday-period import', async (schoolId) => {
  const original = schoolId === 'ncnu' ? course : nthuCourse;
  const invalid = schoolId === 'ncnu'
    ? { ...original, time: '5bc5cd', title: '重複節次測試課程' }
    : { ...original, title: '重複節次測試課程', time: 'M3M4\nM4M5', room: '教室甲\n教室乙', meetings: [
        { time: 'M3M4', room: '教室甲' }, { time: 'M4M5', room: '教室乙' },
      ] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(filteredResponse([invalid], { weekday: schoolId === 'ncnu' ? 5 : 1 }, { schoolId })));
  render(<PublicCourseSearch {...(schoolId === 'ncnu' ? props : nthuProps)} weekdayParameters={[schoolId === 'ncnu' ? '5' : '1']} />);
  submit('重複');
  const heading = await screen.findByRole('heading', { name: '重複節次測試課程' });
  const card = heading.closest('li')!;
  expect(within(card).getByText(/上課節次尚無法安全匯入/)).toBeTruthy();
  expect(within(card).queryByRole('button', { name: '帶入課表核對' })).toBeNull();
  expect(within(card).queryByRole('button', { name: '複製課表匯入資料' })).toBeNull();
  expect(readPersonalImportDraft(importContext.scope)).toBeNull();
});
