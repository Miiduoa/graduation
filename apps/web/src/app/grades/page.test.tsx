import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import GradesPage from './page';
vi.mock('@/features/nuni/StudentGrades', () => ({
  StudentGradesPage: () => <h1>nuni 課程成績</h1>,
}));
it('opens nuni grades by default', () => {
  render(<GradesPage />);
  expect(screen.getByRole('heading', { name: 'nuni 課程成績' })).toBeTruthy();
});
