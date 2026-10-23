import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import ShopsPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /shops to the current login page', () => {
  ShopsPage();
  expect(redirect).toHaveBeenCalledWith('/login');
});
