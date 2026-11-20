import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StudentCardEntry } from './StudentCardEntry';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('campus=fcu&schoolId=fcu'),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: () => null }));
it('opens the card for the campus shown on the home page', () => {
  render(<StudentCardEntry />);
  const link = screen.getByRole('link', { name: /數位學生證/ });
  const url = new URL(link.getAttribute('href')!, 'https://nuni.test');
  expect(url.pathname).toBe('/student-card');
  expect(url.searchParams.get('campus')).toBe('fcu');
  expect(url.searchParams.get('schoolId')).toBe('fcu');
});
