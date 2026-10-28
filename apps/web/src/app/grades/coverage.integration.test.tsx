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
vi.mock('@/features/nuni/StudentGrades', () => ({ StudentGradesPage: () => null }));
vi.mock('@/lib/gradeTranscript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gradeTranscript')>();
  return { ...actual, buildTranscriptCsv: vi.fn(actual.buildTranscriptCsv) };
});
const row = (id: string, semester: string, score: number | string = 80): AcademicGrade => ({
  id, semester, score, credits: 0.5, courseName: id, courseNameEn: '', class: '資管測試班', courseType: '選修',
});
function openCoverage() {
  fireEvent.click(screen.getByText(/查看 \d+ 個學期的讀取結果/));
}
function chooseSemester(label: string) {
  const panel = within(screen.getByRole('region', { name: '學期資料範圍' }));
  fireEvent.click(panel.getByRole('button', { name: new RegExp(`查看 ${label}`) }));
}

beforeEach(() => {
  records = {
    grades: [row('已讀到的新學期科目', '1151', 'SAT'), row('舊學期零分', '1142', 0)],
    semesters: ['1151', '1142', '1141'], allSemesters: ['1151', '1142', '1141'],
    summary: { '1141': { semesterAverage: '88.5' } },
  };
  vi.mocked(buildTranscriptCsv).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('warns about a named semester with no course rows rather than claiming zero earned credits', () => {
  render(<GradesPage />);
  expect(screen.getByText(/來源另列出 1 個學期/)).toBeTruthy();
  openCoverage();
  chooseSemester('114 學年度第 1 學期');
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('1141');
  expect(screen.getByText(/來源提到這個學期，但本次沒有取得科目明細/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '匯出符合條件的 0 筆 CSV' }) as HTMLButtonElement).disabled).toBe(true);
  const metric = screen.getByText('紀錄中的修課學分').parentElement;
  expect(metric?.querySelector('strong')?.textContent).toBe('—');
  expect(screen.getByText('88.5')).toBeTruthy();
});

it('clears conflicting detail filters when inspecting a source semester', () => {
  render(<GradesPage />);
  fireEvent.click(screen.getByRole('button', { name: '核對 1 筆成績' }));
  fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '不存在' } });
  fireEvent.change(screen.getByLabelText('成績類型'), { target: { value: 'text' } });
  openCoverage();
  chooseSemester('114 學年度第 2 學期');
  expect((screen.getByLabelText('搜尋科目') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('成績類型') as HTMLSelectElement).value).toBe('all');
  expect(screen.getByRole('heading', { name: '舊學期零分' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '已讀到的新學期科目' })).toBeNull();
});

it('shows summary-only semesters in both the coverage list and semester select', () => {
  records.semesters = ['1151', '1142'];
  records.allSemesters = ['1151', '1142'];
  render(<GradesPage />);
  openCoverage();
  chooseSemester('114 學年度第 1 學期');
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('1141');
  expect(screen.getByRole('option', { name: '114 學年度第 1 學期' })).toBeTruthy();
});

it('resets pagination when jumping to another semester', () => {
  records.grades = [...Array.from({ length: 45 }, (_, index) => row(`新${index}`, '1151')), ...Array.from({ length: 45 }, (_, index) => row(`舊${index}`, '1142'))];
  render(<GradesPage />);
  fireEvent.click(screen.getByRole('button', { name: '再顯示 40 筆成績' }));
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(80);
  openCoverage();
  chooseSemester('114 學年度第 2 學期');
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(40);
  expect(screen.getByRole('button', { name: '匯出符合條件的 45 筆 CSV' })).toBeTruthy();
});

it('exports only the selected source semester and only after a deliberate click', () => {
  vi.useFakeTimers();
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:coverage'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<GradesPage />);
  openCoverage();
  chooseSemester('114 學年度第 2 學期');
  expect(buildTranscriptCsv).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '匯出符合條件的 1 筆 CSV' }));
  const input = vi.mocked(buildTranscriptCsv).mock.calls[0][0];
  expect(input.rows).toHaveLength(1);
  expect(input.rows[0]).toMatchObject({ semester: '1142', score: 0 });
});

it('updates a missing semester in place when a refresh supplies the rows', () => {
  const { rerender } = render(<GradesPage />);
  openCoverage();
  chooseSemester('114 學年度第 1 學期');
  records = { ...records, grades: [...records.grades, row('更新後的科目', '1141')] };
  rerender(<GradesPage />);
  expect(screen.queryByText(/來源另列出/)).toBeNull();
  expect(screen.getByRole('heading', { name: '更新後的科目' })).toBeTruthy();
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('1141');
});

it('keeps source coverage independent of text-search results', () => {
  render(<GradesPage />);
  fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '不存在' } });
  expect(screen.getByText('2 個學期有明細')).toBeTruthy();
  expect(screen.getByText(/來源另列出 1 個學期/)).toBeTruthy();
  expect(screen.getByText('沒有符合條件的成績。')).toBeTruthy();
});

it('lets the user leave an empty semester via the existing clear-filter control', () => {
  render(<GradesPage />);
  openCoverage();
  chooseSemester('114 學年度第 1 學期');
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect((screen.getByLabelText('學期') as HTMLSelectElement).value).toBe('');
  expect(within(screen.getByRole('list', { name: '成績明細' })).getAllByRole('listitem')).toHaveLength(2);
});
