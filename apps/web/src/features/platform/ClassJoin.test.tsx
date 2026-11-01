import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { ClassJoin } from './ClassJoin';
import { JOIN_PATH } from './constants';

const mocks = vi.hoisted(() => ({
  join: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
  session: null as null | {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
  },
  loading: false,
  pendingLogout: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: mocks.session,
    loading: mocks.loading,
    error: '',
    pendingLogout: mocks.pendingLogout,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/features/nuni/CourseUI', () => ({
  useClasses: () => ({ join: mocks.join, create: mocks.create }),
}));

beforeEach(() => {
  mocks.join.mockReset();
  mocks.replace.mockReset();
  mocks.session = null;
  mocks.loading = false;
  mocks.pendingLogout = false;
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('shows the join form for guests and sends them to account login on submit', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  render(<ClassJoin />);
  expect(screen.getByRole('heading', { name: '加入課班' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往登入' }).getAttribute('href')).toBe(
    `/auth/account?returnUrl=${encodeURIComponent(JOIN_PATH)}`,
  );
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC123' } });
  fireEvent.submit(screen.getByLabelText('邀請碼').closest('form')!);
  expect(replace).toHaveBeenCalledWith(`/auth/account?returnUrl=${encodeURIComponent(JOIN_PATH)}`);
  expect(mocks.join).not.toHaveBeenCalled();
});

it('joins with the existing class-workspace API and opens the new workspace page', async () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: false,
  };
  mocks.join.mockResolvedValue({ id: 'cw_11111111-1111-4111-8111-111111111111' });
  render(<ClassJoin />);
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'abc-123' } });
  fireEvent.submit(screen.getByLabelText('邀請碼').closest('form')!);
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
    ),
  );
  expect(mocks.join).toHaveBeenCalledWith('ABC123', expect.stringMatching(/^web-join-/));
});

it('sends an expired session back to account login', async () => {
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: false,
  };
  mocks.join.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  render(<ClassJoin />);
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC123' } });
  fireEvent.submit(screen.getByLabelText('邀請碼').closest('form')!);
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      `/auth/account?returnUrl=${encodeURIComponent(JOIN_PATH)}`,
    ),
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it.each(['success', 'expired'] as const)(
  'ignores a join %s from the previous account',
  async (outcome) => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    const pending = deferred<{ id: string }>();
    mocks.join.mockReturnValue(pending.promise);
    mocks.session = {
      platformAccountId: 'pa_1',
      context: 'a'.repeat(43),
      isPlatformOperator: false,
    };
    const view = render(<ClassJoin />);
    fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC123' } });
    fireEvent.submit(screen.getByLabelText('邀請碼').closest('form')!);
    mocks.session = { ...mocks.session, context: 'b'.repeat(43) };
    view.rerender(<ClassJoin />);
    await act(async () => {
      if (outcome === 'success') pending.resolve({ id: 'cw_11111111-1111-4111-8111-111111111111' });
      else pending.reject(new NuniError(401, 'SIGN_IN_REQUIRED'));
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect((screen.getByLabelText('邀請碼') as HTMLInputElement).value).toBe('');
  },
);
