import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import TodayPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /today to the home page', () => {
  TodayPage();
  expect(redirect).toHaveBeenCalledWith('/');
});
