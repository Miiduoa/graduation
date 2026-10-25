import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import CareerPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /career to the current home page', () => {
  CareerPage();
  expect(redirect).toHaveBeenCalledWith('/');
});
