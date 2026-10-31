import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }));
vi.mock('@/components/academic/AcademicPage', () => ({ AcademicPage: () => <h1>學期成績頁</h1> }));
import GradesPage from './page';
vi.mock('@/features/nuni/StudentGrades', () => ({
  StudentGradesPage: () => <h1>nuni 課程成績</h1>,
}));
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
it('opens the feedback tab explicitly', () => {
  navigation.search = 'tab=feedback';
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: 'nuni 課程成績' })).toBeTruthy();
  navigation.search = '';
});
