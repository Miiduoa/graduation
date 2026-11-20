import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import JoinPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /join to the unsigned login entry and keeps query parameters', async () => {
  await JoinPage({
    searchParams: Promise.resolve({ school: 'pu', schoolId: 'tw-pu', code: 'invite-1' }),
  });
  expect(redirect).toHaveBeenCalledWith('/login?school=pu&schoolId=tw-pu&code=invite-1');
});

it('sends a bare /join to /login', async () => {
  await JoinPage({});
  expect(redirect).toHaveBeenCalledWith('/login');
});
