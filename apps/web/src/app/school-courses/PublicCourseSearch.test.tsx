import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicCourseSearch } from './PublicCourseSearch';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
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
function response(courses: PublicCatalogCourse[], extra = {}) {
  return Response.json({ schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/', fetchedAt: '2026-11-06T08:00:00.000Z', truncated: false, courses, ...extra });
}
function submit(query: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  fireEvent.submit(screen.getByRole('search', { name: '搜尋校方開課資料' }));
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
      schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/', truncated: false, courses: [course],
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
