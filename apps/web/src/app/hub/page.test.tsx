import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import HubPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /hub to the home page', () => {
  HubPage();
  expect(redirect).toHaveBeenCalledWith('/');
});
