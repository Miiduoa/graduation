import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SchoolAccountRequired } from './SchoolAccountRequired';

const nuni: { value: { session: unknown } | null } = { value: null };
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => nuni.value }));

beforeEach(() => {
  nuni.value = null;
});

it('tells a Google account user what switching to the school account keeps', () => {
  nuni.value = { session: { platformAccountId: 'g-1' } };
  render(<SchoolAccountRequired returnUrl="/appeals" />);
  expect(screen.getByRole('heading', { name: '這個功能要用學校帳號登入才能用' })).toBeTruthy();
  expect(
    screen.getByText('改用學校帳號登入不會登出你的 Google 帳號，這台瀏覽器上的課表也會留著。'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: '改用學校帳號登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fappeals',
  );
});

it('offers the school login without the switch note when nobody is signed in', () => {
  render(<SchoolAccountRequired returnUrl="/friends" />);
  expect(screen.getByRole('heading', { name: '這個功能要用學校帳號登入才能用' })).toBeTruthy();
  expect(screen.queryByText(/不會登出你的 Google 帳號/)).toBeNull();
  expect(screen.getByRole('link', { name: '用學校帳號登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Ffriends',
  );
});
