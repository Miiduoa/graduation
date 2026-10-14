import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BusPage from './page';

const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, schoolName }: { children: React.ReactNode; schoolName?: string }) => (
    <main>
      <p>{schoolName}</p>
      {children}
    </main>
  ),
}));
vi.mock('@/components/TransitExplorer', () => ({
  TransitExplorer: ({ schoolId }: { schoolId: string }) => (
    <output data-testid="bus-school">{schoolId}</output>
  ),
}));

beforeEach(() => {
  navigation.query = '';
});
afterEach(cleanup);

it('uses campus over a stale schoolId when locating bus stops', () => {
  navigation.query = '?campus=cgu&schoolId=pu';
  render(<BusPage />);
  expect(screen.getByTestId('bus-school').textContent).toBe('cgu');
  expect(screen.getByText('長庚大學')).toBeTruthy();
});

it('keeps a not-yet-integrated university isolated from the previous school', () => {
  navigation.query = '?campus=remote-university-12&schoolId=pu';
  render(<BusPage />);
  expect(screen.getByTestId('bus-school').textContent).toBe('remote-university-12');
  expect(screen.getByText('所選校園尚未接入')).toBeTruthy();
});

it('prompts for a school rather than querying any campus when none is chosen', () => {
  navigation.query = '?campus=all&schoolId=pu';
  render(<BusPage />);
  expect(screen.getByText('請先選擇一所學校')).toBeTruthy();
  expect(screen.queryByTestId('bus-school')).toBeNull();
  expect(screen.queryByText('靜宜大學')).toBeNull();
});
