import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AcademicGradeResponse } from '@/lib/academicRecords';
const navigation = vi.hoisted(() => ({ search: '' }));
const academic = vi.hoisted(() => ({ records: null as AcademicGradeResponse | null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }));
vi.mock('@/components/academic/AcademicPage', () => ({
  AcademicPage: ({ children }: { children: (snapshot: { records: AcademicGradeResponse }) => ReactNode }) => (
    <>
      <h1>學期成績頁</h1>
      {academic.records ? children({ records: academic.records }) : null}
    </>
  ),
}));
import GradesPage from './page';
vi.mock('@/features/nuni/StudentGrades', () => ({
  StudentGradesPage: () => <h1>nuni 課程成績</h1>,
}));

beforeEach(() => {
  navigation.search = '';
  academic.records = null;
});

function gradeRecords(): AcademicGradeResponse {
  const course = {
    id: 'programming',
    semester: '1151',
    courseName: '程式設計',
    courseNameEn: '',
    class: '資管二A',
    courseType: '必修',
    credits: 3,
    score: 80,
  };
  return {
    grades: [
      course,
      { ...course, id: 'statistics', courseName: '統計', credits: 1, score: 0 },
      { ...course, id: 'pe', semester: '1142', courseName: '體育', credits: 2, score: 'Pass' },
      { ...course, id: 'project', semester: '1142', courseName: '專題', credits: 2, score: '' },
      { ...course, id: 'seminar', semester: '1142', courseName: '實務講座', credits: 0, score: '尚未公布完整評量結果' },
    ],
    semesters: ['1151', '1142', '1141'],
    allSemesters: ['1151', '1142', '1141'],
    summary: {
      '1151': { semesterAverage: '82.35', classRanking: '3/40' },
      '1142': { semesterAverage: '待公告', departmentRanking: '20/100' },
    },
  };
}

it('opens nuni grades by default', () => {
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: 'nuni 課程成績' })).toBeTruthy();
});

it('opens the requested semester tab', () => {
  navigation.search = 'tab=semester&campus=pu';
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: '學期成績頁' })).toBeTruthy();
  navigation.search = '';
});

it('keeps the paper and filter focus stable except when the semester changes', () => {
  navigation.search = 'tab=semester';
  academic.records = gradeRecords();
  const view = render(<GradesPage />);
  const paper = screen.getByTestId('semester-grade-paper');
  const search = screen.getByRole('searchbox', { name: '搜尋科目' });
  const sort = screen.getByRole('combobox', { name: '排序' });
  const semester = screen.getByRole('combobox', { name: '學期' });

  search.focus();
  fireEvent.change(search, { target: { value: '程式' } });
  expect(screen.getByTestId('semester-grade-paper')).toBe(paper);
  expect(document.activeElement).toBe(search);
  expect(within(screen.getByRole('list', { name: '學期成績明細' })).getAllByRole('listitem')).toHaveLength(1);
  expect(within(paper).getByText('60.00')).toBeTruthy();

  fireEvent.change(search, { target: { value: '' } });
  sort.focus();
  fireEvent.change(sort, { target: { value: 'score' } });
  expect(screen.getByTestId('semester-grade-paper')).toBe(paper);
  expect(document.activeElement).toBe(sort);
  const firstRow = within(screen.getByRole('list', { name: '學期成績明細' })).getAllByRole('listitem')[0];
  expect(within(firstRow).getByRole('heading', { name: '程式設計' })).toBeTruthy();

  academic.records = gradeRecords();
  view.rerender(<GradesPage />);
  expect(screen.getByTestId('semester-grade-paper')).toBe(paper);
  expect(document.activeElement).toBe(sort);

  semester.focus();
  fireEvent.change(semester, { target: { value: '1151' } });
  const selectedPaper = screen.getByTestId('semester-grade-paper');
  expect(selectedPaper).not.toBe(paper);
  expect(document.activeElement).toBe(semester);
  expect(screen.getByRole('searchbox', { name: '搜尋科目' })).toBe(search);
  expect(screen.getByRole('combobox', { name: '排序' })).toBe(sort);
  fireEvent.change(semester, { target: { value: '1151' } });
  expect(screen.getByTestId('semester-grade-paper')).toBe(selectedPaper);

  search.focus();
  fireEvent.change(search, { target: { value: '找不到的科目' } });
  expect(screen.getByText('沒有符合條件的成績。')).toBeTruthy();
  expect(screen.getByTestId('semester-grade-paper')).toBe(selectedPaper);
  fireEvent.change(search, { target: { value: '程式' } });
  expect(screen.getByTestId('semester-grade-paper')).toBe(selectedPaper);
  expect(document.activeElement).toBe(search);
});

it('preserves zero, text and missing scores with separate school and calculated summaries', () => {
  navigation.search = 'tab=semester';
  academic.records = gradeRecords();
  render(<GradesPage />);
  const list = within(screen.getByRole('list', { name: '學期成績明細' }));
  expect(list.getByText('0')).toBeTruthy();
  expect(list.getByText('Pass')).toBeTruthy();
  expect(list.getByText('未提供')).toBeTruthy();
  expect(list.getByText('尚未公布完整評量結果')).toBeTruthy();
  for (const link of list.getAllByRole('link', { name: '查看校方原始紀錄' })) {
    expect(link.getAttribute('href')).toBe('https://ecampus.pu.edu.tw/');
  }
  expect(screen.getByText('60.00')).toBeTruthy();
  expect(screen.getByText('僅計 4 學分的數字成績')).toBeTruthy();
  const school = within(screen.getByRole('region', { name: '學校提供的學期摘要' }));
  expect(school.getByText('82.35')).toBeTruthy();
  expect(school.getByText('待公告')).toBeTruthy();
  expect(school.getByText('3/40')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1142' } });
  expect(screen.getByText('—')).toBeTruthy();
  expect(screen.getByText('僅計 0 學分的數字成績')).toBeTruthy();
  expect(screen.queryByText('3/40')).toBeNull();
  expect(screen.getByText('20/100')).toBeTruthy();
});

it('retains an empty semester paper when a later snapshot supplies its records', () => {
  navigation.search = 'tab=semester';
  const records = gradeRecords();
  academic.records = records;
  const view = render(<GradesPage />);
  const semester = screen.getByRole('combobox', { name: '學期' });
  semester.focus();
  fireEvent.change(semester, { target: { value: '1141' } });
  const paper = screen.getByTestId('semester-grade-paper');
  expect(screen.getByText('沒有符合條件的成績。')).toBeTruthy();

  academic.records = {
    ...records,
    grades: [
      ...records.grades,
      { ...records.grades[0], id: 'received', semester: '1141', courseName: '新讀取科目' },
    ],
  };
  view.rerender(<GradesPage />);
  expect(screen.getByRole('heading', { name: '新讀取科目' })).toBeTruthy();
  expect(screen.getByTestId('semester-grade-paper')).toBe(paper);
  expect(document.activeElement).toBe(semester);
});
it('opens the feedback tab explicitly', () => {
  navigation.search = 'tab=feedback';
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: 'nuni 課程成績' })).toBeTruthy();
  navigation.search = '';
});
