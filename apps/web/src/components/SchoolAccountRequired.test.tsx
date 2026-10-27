import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SchoolAccountRequired, SCHOOL_FEATURE_CLOSED_COPY } from './SchoolAccountRequired';

const nuni: { value: { session: unknown } | null } = { value: null };
const options = { studentId: false, loading: false, error: false, retry: vi.fn() };
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => nuni.value }));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => options,
}));

beforeEach(() => {
  nuni.value = null;
  options.studentId = false;
  options.loading = false;
  options.error = false;
  options.retry.mockClear();
});

it('offers retry on a lookup failure instead of announcing the feature is closed', () => {
  options.error = true;
  render(<SchoolAccountRequired returnUrl="/friends" alternative="先向同學確認。" />);
  expect(screen.getByRole('alert').textContent).toContain('暫時無法確認學校服務');
  expect(screen.queryByText(SCHOOL_FEATURE_CLOSED_COPY)).toBeNull();
  expect(screen.queryByRole('link', { name: /學校帳號登入/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認' }));
  expect(options.retry).toHaveBeenCalledOnce();
});

it('does not open a school login form when student ID is unavailable', () => {
  nuni.value = { session: { platformAccountId: 'g-1' } };
  render(
    <SchoolAccountRequired returnUrl="/appeals" alternative="申訴請先向授課老師或系辦反映。" />,
  );
  expect(screen.getByRole('heading', { name: SCHOOL_FEATURE_CLOSED_COPY })).toBeTruthy();
  expect(screen.getByText('申訴請先向授課老師或系辦反映。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /學校帳號登入/ })).toBeNull();
});

it('tells a Google account user what switching to the school account keeps', () => {
  options.studentId = true;
  nuni.value = { session: { platformAccountId: 'g-1' } };
  render(
    <SchoolAccountRequired returnUrl="/appeals" alternative="申訴請先向授課老師或系辦反映。" />,
  );
  expect(screen.getByRole('heading', { name: '這個功能要用學校帳號登入才能用' })).toBeTruthy();
  expect(
    screen.getByText('改用學校帳號登入不會登出你的 Google 帳號，這台瀏覽器上的課表也會留著。'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: '改用學校帳號登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fappeals',
  );
});

it('offers the school login without the switch note when nobody is signed in', () => {
  options.studentId = true;
  render(
    <SchoolAccountRequired returnUrl="/friends" alternative="找同學請先用課堂或通訊軟體聯絡。" />,
  );
  expect(screen.getByRole('heading', { name: '這個功能要用學校帳號登入才能用' })).toBeTruthy();
  expect(screen.queryByText(/不會登出你的 Google 帳號/)).toBeNull();
  expect(screen.getByRole('link', { name: '用學校帳號登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Ffriends',
  );
});

it('preserves the school course destination and campus when opening school login', () => {
  options.studentId = true;
  const returnUrl = '/school-courses?school=pu&schoolId=pu&campus=pu';
  render(<SchoolAccountRequired returnUrl={returnUrl} alternative="請先至 WOW Class 查看課程。" />);
  const href = screen.getByRole('link', { name: '用學校帳號登入' }).getAttribute('href');
  expect(href).toBe(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
});
