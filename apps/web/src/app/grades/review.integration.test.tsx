import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GradesPage from './page';
import type { AcademicGrade, AcademicGradeResponse } from '@/lib/academicRecords';
import { buildTranscriptCsv } from '@/lib/gradeTranscript';

let records: AcademicGradeResponse;
const fetchedAt = '2026-10-28T00:00:00.000Z';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/academic/AcademicPage', () => ({
  AcademicPage: ({ children }: { children: (value: { records: AcademicGradeResponse; fetchedAt: string }) => ReactNode }) => children({ records, fetchedAt }),
}));
vi.mock('@/components/academic/GradesTabs', () => ({ GradesTabs: () => null, isGradesFeedbackTab: () => false }));
vi.mock('@/components/academic/SchoolSemesterSummary', () => ({ SchoolSemesterSummary: () => <p>校方學期摘要</p> }));
vi.mock('@/features/nuni/StudentGrades', () => ({ StudentGradesPage: () => null }));
vi.mock('@/lib/gradeTranscript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gradeTranscript')>();
  return { ...actual, buildTranscriptCsv: vi.fn(actual.buildTranscriptCsv) };
});
const row = (id: string, score: number | string, semester = '1151'): AcademicGrade => ({
  id, score, semester, credits: 0.5, courseName: id, courseNameEn: '', class: '資管三B', courseType: '選修',
});
const fixture = (grades: AcademicGrade[]): AcademicGradeResponse => ({ grades, semesters: [...new Set(grades.map(row => row.semester))], allSemesters: [...new Set(grades.map(row => row.semester))], summary: {} });

beforeEach(() => {
  records = fixture([row('待核對代碼', 'SAT'), row('未提供結果', ''), row('真正零分', 0), row('明確通過', 'Pass'), row('先前學期', 'SAT', '1142')]);
  vi.mocked(buildTranscriptCsv).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('opens review results in the selected semester and clears conflicting detail filters', () => {
  render(<GradesPage />);
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1151' } });
  fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '不存在' } });
  fireEvent.change(screen.getByLabelText('成績類型'), { target: { value: 'numeric' } });
  fireEvent.click(screen.getByRole('button', { name: '核對 2 筆成績' }));
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('1151');
  expect((screen.getByLabelText('搜尋科目') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('成績類型') as HTMLSelectElement).value).toBe('all');
  const list = within(screen.getByRole('list', { name: '成績明細' }));
  expect(list.getAllByRole('listitem')).toHaveLength(2);
  expect(list.getByText('SAT')).toBeTruthy();
  expect(list.queryByRole('heading', { name: '真正零分' })).toBeNull();
  expect(list.queryByRole('heading', { name: '先前學期' })).toBeNull();
});

it('does not modify semester metrics or school summaries when showing review rows', () => {
  render(<GradesPage />);
  const metric = screen.getByText('紀錄中的修課學分').parentElement;
  const before = metric?.textContent;
  fireEvent.click(screen.getByRole('button', { name: '核對 3 筆成績' }));
  expect(metric?.textContent).toBe(before);
  expect(screen.getByText('校方學期摘要')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回全部明細' }));
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(5);
});

it('clears the pending-only filter with the existing reset control', () => {
  render(<GradesPage />);
  fireEvent.click(screen.getByRole('button', { name: '核對 3 筆成績' }));
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByRole('heading', { name: '真正零分' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '核對 3 筆成績' }).getAttribute('aria-pressed')).toBe('false');
});

it('exports all pending rows, not only the first screenful and not known results', () => {
  vi.useFakeTimers();
  records = fixture([...Array.from({ length: 45 }, (_, i) => row(`待核對${i}`, 'SAT')), row('不應匯出', 'Pass')]);
  const create = vi.fn(() => 'blob:review');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<GradesPage />);
  fireEvent.click(screen.getByRole('button', { name: '核對 45 筆成績' }));
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(40);
  expect(buildTranscriptCsv).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '匯出符合條件的 45 筆 CSV' }));
  const args = vi.mocked(buildTranscriptCsv).mock.calls[0][0];
  expect(args.rows).toHaveLength(45);
  expect(args.rows.every(row => row.score === 'SAT')).toBe(true);
  expect(args.fetchedAt).toBe(fetchedAt);
  expect(create).toHaveBeenCalledTimes(1);
});

it('lets users leave the pending filter after a refresh resolves every item', () => {
  const { rerender } = render(<GradesPage />);
  fireEvent.click(screen.getByRole('button', { name: '核對 3 筆成績' }));
  records = fixture([row('已更新結果', 'Pass')]);
  rerender(<GradesPage />);
  expect(screen.getByRole('heading', { name: '目前範圍沒有待核對的成績' })).toBeTruthy();
  expect(screen.queryByText('SAT')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回全部明細' }));
  expect(screen.getByRole('heading', { name: '已更新結果' })).toBeTruthy();
});
