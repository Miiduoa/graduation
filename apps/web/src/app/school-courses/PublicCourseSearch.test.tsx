import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicCourseSearch } from './PublicCourseSearch';
import type { PublicCatalogCourse } from '@campus/shared/src/publicCourseCatalog';
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
function response(courses: PublicCatalogCourse[], extra = {}) {
  return Response.json({ schoolId: 'ncnu', sourceUrl: 'https://ccweb6.ncnu.edu.tw/', truncated: false, courses, ...extra });
}
function submit(query: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  fireEvent.submit(screen.getByRole('search', { name: '搜尋校方開課資料' }));
}
afterEach(() => vi.unstubAllGlobals());

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

it('round-trips exact weekdays, school period letters, section and term through the real importer', () => {
  const csv = ncnuTimetableImportCsv({ ...course, time: '3cd4i' });
  const imported = parsePersonalImport(csv!, { kind: 'timetable', schoolId: 'ncnu', academicYear: '999', semester: '2' });
  expect(imported.rows).toHaveLength(2);
  const row = { schoolId: 'ncnu', academicYear: '115', semester: '1', courseCode: '005076', className: 'a', location: course.room, teacher: course.teacher, credits: 3 };
  expect(imported.rows[0]).toMatchObject({ ...row, dayOfWeek: 3, periodLabel: 'cd' });
  expect(imported.rows[1]).toMatchObject({ ...row, dayOfWeek: 4, periodLabel: 'i' });
  expect(imported.issues.filter(issue => issue.severity === 'error')).toEqual([]);
  expect(imported.rows[0].startTime).toBeUndefined();
  expect(imported.rows[1].startPeriod).toBeUndefined();
  expect(ncnuCourseMeetings('7z')?.[0].label).toBe('星期日 z 節');
  expect(ncnuTimetableImportCsv({ ...course, semester: '未提供' })).toBeNull();
  for (const time of ['', '另訂', '8abc', '1b2?', '1c2']) {
    expect(ncnuTimetableImportCsv({ ...course, time })).toBeNull();
  }
});


async function chooseCourse() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ ...course, time: '3cd4i' }])));
  const view = render(<PublicCourseSearch {...props} />);
  submit('005076');
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

it.each(['full', 'partial', 'corrupt', 'wrong-school', 'unconfirmed', 'storage-error'])('preserves existing work and offers manual copy when %s', async (reason) => {
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
    await chooseCourse();
    expect(push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(personalImportDraftKey(scope))).toBe(full);
    expect(sessionStorage.getItem(personalImportPartialDraftKey(scope))).toBe(partial);
    expect(screen.getByText(/請先處理草稿|無法安全讀寫|請先確認目前帳號/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '複製課表匯入資料' })).toBeTruthy();
  } finally { failed?.mockRestore(); }
});

it('restores the prepared draft in the actual import review workspace', async () => {
  const view = await chooseCourse();
  const href = push.mock.calls[0][0];
  view.unmount();
  window.history.replaceState(null, '', href);
  try {
    const { PersonalImportCenter } = await import('@/components/imports/PersonalImportCenter');
    render(<PersonalImportCenter />);
    const review = await screen.findByRole('region', { name: '核對匯入資料' });
    expect(within(review).getAllByDisplayValue(course.title.normalize('NFKC'))).toHaveLength(2);
    expect(within(review).getAllByDisplayValue(course.code)).toHaveLength(2);
    expect(readPersonalImports(importContext.scope)).toEqual([]);
  } finally { window.history.replaceState(null, '', '/'); }
});
