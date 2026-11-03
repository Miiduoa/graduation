import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import ShopsPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /shops to the existing dining entry instead of a blank login', () => {
  ShopsPage();
  expect(redirect).toHaveBeenCalledWith('/food');
  expect(redirect).not.toHaveBeenCalledWith('/login');
});
