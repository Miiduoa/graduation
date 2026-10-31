import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PersonalImportSummary } from './PersonalImportSummary';
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({ scope: 'student-a', loading: false }),
  usePersonalImports: () => ({ records: [{ id: 'grade-1', title: '個人成績', kind: 'grades', academicYear: '115', semester: '1', credits: 2, grade: '待公布', importedAt: '2026-10-30T04:00:00Z' }], error: null }),
}));
it('shows personal provenance, import time and a return link without turning pending grades into zero', () => {
  render(<PersonalImportSummary kind="grades" />);
  expect(screen.getByText(/來源：個人匯入 · 匯入時間/)).toBeTruthy();
  expect(screen.getByText(/待公布/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '個人成績' }).getAttribute('href')).toBe('/import?kind=grades#record-grade-1');
});
