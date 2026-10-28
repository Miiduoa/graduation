import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GradesPage from './page';
import type { AcademicGrade, AcademicGradeResponse } from '@/lib/academicRecords';

let records: AcademicGradeResponse;
let tab = '';
const fetchedAt = '2026-10-28T00:00:00.000Z';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(tab ? `tab=${tab}` : '') }));
vi.mock('@/components/academic/AcademicPage', () => ({
  AcademicPage: ({ children }: { children: (value: { records: AcademicGradeResponse; fetchedAt: string }) => ReactNode }) => children({ records, fetchedAt }),
}));
vi.mock('@/components/academic/GradesTabs', () => ({ GradesTabs: () => null, isGradesFeedbackTab: (value: string | null) => value === 'feedback' }));
vi.mock('@/components/academic/SchoolSemesterSummary', () => ({ SchoolSemesterSummary: () => <p>校方學期摘要保留</p> }));
vi.mock('@/features/nuni/StudentGrades', () => ({ StudentGradesPage: () => <p>課堂回饋保留</p> }));

function row(id: string, overrides: Partial<AcademicGrade> = {}): AcademicGrade {
  return { id, semester: '1151', courseName: `課程${id}`, courseNameEn: '', class: '資管三B', courseType: '必修', credits: 3, score: 86, ...overrides };
}
function fixture(grades: AcademicGrade[]): AcademicGradeResponse {
  const semesters = [...new Set(grades.map(item => item.semester))];
  return { grades, semesters, allSemesters: semesters, summary: {} };
}

beforeEach(() => {
  tab = '';
  records = fixture([
    row('zero', { courseName: '程式設計', courseNameEn: 'PROGRAMMING', credits: 0.5, score: 0 }),
    row('pass', { courseName: '服務學習', courseType: '選修', score: 'Pass' }),
    row('blank', { courseName: '專題實作', score: '' }),
  ]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('searches the English source name with fullwidth input', () => {
  render(<GradesPage />);
  fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: 'ＰＲＯＧＲＡＭＭＩＮＧ' } });
  expect(screen.getByRole('heading', { name: '程式設計' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '服務學習' })).toBeNull();
  expect(screen.getByText('符合 1 筆 · 已顯示 1 筆')).toBeTruthy();
});

it('distinguishes zero, text grades and missing grades without assuming a passing threshold', () => {
  render(<GradesPage />);
  fireEvent.change(screen.getByLabelText('成績類型'), { target: { value: 'numeric' } });
  expect(screen.getByRole('heading', { name: '程式設計' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '專題實作' })).toBeNull();
  fireEvent.change(screen.getByLabelText('成績類型'), { target: { value: 'missing' } });
  expect(screen.getByRole('heading', { name: '專題實作' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '程式設計' })).toBeNull();
  fireEvent.change(screen.getByLabelText('成績類型'), { target: { value: 'text' } });
  expect(screen.getByText('Pass')).toBeTruthy();
});

it('clears all filters and retains the school-provided semester summary', () => {
  render(<GradesPage />);
  fireEvent.change(screen.getByLabelText('修別'), { target: { value: '選修' } });
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('校方學期摘要保留')).toBeTruthy();
});

it('progressively reveals large transcripts and resets the list after a filter changes', () => {
  records = fixture(Array.from({ length: 85 }, (_, index) => row(String(index))));
  render(<GradesPage />);
  const list = screen.getByRole('list', { name: '成績明細' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(40);
  fireEvent.click(screen.getByRole('button', { name: '再顯示 40 筆成績' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(80);
  fireEvent.click(screen.getByRole('button', { name: '再顯示 5 筆成績' }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(85);
  fireEvent.change(screen.getByLabelText('成績類型'), { target: { value: 'numeric' } });
  expect(within(list).getAllByRole('listitem')).toHaveLength(40);
});

it('disables export when the filter has no results', () => {
  render(<GradesPage />);
  fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '沒有這門課' } });
  expect((screen.getByRole('button', { name: '匯出符合條件的 0 筆 CSV' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('沒有符合條件的成績。')).toBeTruthy();
});

it('exports all matched rows only after a click and releases the temporary file', () => {
  vi.useFakeTimers();
  records = fixture(Array.from({ length: 85 }, (_, index) => row(String(index))));
  const create = vi.fn(() => 'blob:fixture');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<GradesPage />);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '匯出符合條件的 85 筆 CSV' }));
  expect(create).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByText('已產生 85 筆成績的 CSV，請查看瀏覽器下載項目。')).toBeTruthy();
  expect(document.querySelector('a[download]')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10_000);
  expect(revoke).toHaveBeenCalledWith('blob:fixture');
});

it('does not claim success when the browser cannot create a file', () => {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => { throw new Error('not available'); } }));
  render(<GradesPage />);
  fireEvent.click(screen.getByRole('button', { name: '匯出符合條件的 3 筆 CSV' }));
  expect(screen.getByText('目前無法產生檔案，請重新讀取資料後再試。')).toBeTruthy();
  expect(document.querySelector('a[download]')).toBeNull();
});

it('retains the separate classroom feedback route', () => {
  tab = 'feedback';
  render(<GradesPage />);
  expect(screen.getByText('課堂回饋保留')).toBeTruthy();
  expect(screen.queryByRole('list', { name: '成績明細' })).toBeNull();
});
