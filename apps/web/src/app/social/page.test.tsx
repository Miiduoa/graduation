import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import SocialPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /social to the current campus wall', () => {
  SocialPage();
  expect(redirect).toHaveBeenCalledWith('/community');
});
