import { beforeEach, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import ShopsPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it('sends /shops to the existing dining entry instead of a blank login', async () => {
  await ShopsPage({ searchParams: Promise.resolve({}) });
  expect(redirect).toHaveBeenCalledWith('/food');
  expect(redirect).not.toHaveBeenCalledWith('/login');
});

it.each<[Record<string, string>, string]>([
  [{ school: 'PU', schoolId: 'pu', campus: 'nthu' }, '/food?school=PU&schoolId=pu&campus=nthu'],
  [{ school: 'PU', schoolId: 'pu', campus: 'all' }, '/food?school=PU&schoolId=pu&campus=all'],
  [{ campus: 'unknown-campus' }, '/food?campus=unknown-campus'],
  [{ schoolId: 'ntu' }, '/food?schoolId=ntu'],
])('retains only the existing browsing hints: %j', async (params, expected) => {
  await ShopsPage({ searchParams: Promise.resolve(params) });
  expect(redirect).toHaveBeenCalledExactlyOnceWith(expected);
});

it('drops legacy role, account, credential, return and detail parameters', async () => {
  await ShopsPage({ searchParams: Promise.resolve({
    campus: 'nthu',
    role: 'merchant',
    accountId: 'other-account',
    token: 'private',
    password: 'private',
    returnUrl: '//attacker.example',
    redirect: '/admin',
    tenant: 'different-tenant',
    order: 'legacy-order',
    location: 'legacy-location',
    items: 'untrusted-cart',
    shopId: 'legacy-shop',
    tab: 'merchant',
  }) });
  expect(redirect).toHaveBeenCalledExactlyOnceWith('/food?campus=nthu');
});

it('keeps hint values inside the query and uses the same first-value rule as URLSearchParams', async () => {
  await ShopsPage({ searchParams: Promise.resolve({
    schoolId: ['nthu', 'pu'],
    campus: ['nthu&role=merchant#checkout', 'pu'],
  }) });
  const href = vi.mocked(redirect).mock.calls[0][0];
  const destination = new URL(href, 'https://campus.example');
  expect(destination.origin).toBe('https://campus.example');
  expect(destination.pathname).toBe('/food');
  expect([...destination.searchParams.keys()]).toEqual(['schoolId', 'campus']);
  expect(destination.searchParams.get('schoolId')).toBe('nthu');
  expect(destination.searchParams.get('campus')).toBe('nthu&role=merchant#checkout');
  expect(destination.hash).toBe('');
});
