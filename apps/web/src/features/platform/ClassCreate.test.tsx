import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { ClassCreate } from './ClassCreate';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  invite: vi.fn(),
  replace: vi.fn(),
  loading: false,
  pendingLogout: false,
  session: null as null | {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
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
  useClasses: () => ({ create: mocks.create, invite: mocks.invite, join: vi.fn() }),
}));

beforeEach(() => {
  mocks.loading = false;
  mocks.pendingLogout = false;
  mocks.create.mockReset();
  mocks.invite.mockReset();
  mocks.replace.mockReset();
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: false,
  };
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('creates a workspace then asks the nuni invite API for 100 uses', async () => {
  mocks.create.mockResolvedValue({ id: 'cw_11111111-1111-4111-8111-111111111111' });
  mocks.invite.mockResolvedValue({ code: 'INVITE1' });
  render(<ClassCreate />);
  fireEvent.change(screen.getByLabelText('課班名稱'), { target: { value: '設計專題' } });
  fireEvent.submit(screen.getByLabelText('課班名稱').closest('form')!);
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      '/classroom/course/cw_11111111-1111-4111-8111-111111111111?invite=INVITE1',
    ),
  );
  expect(mocks.create).toHaveBeenCalledWith('設計專題', expect.stringMatching(/^web-create-/));
  expect(mocks.invite).toHaveBeenCalledWith(
    'cw_11111111-1111-4111-8111-111111111111',
    expect.stringMatching(/^web-invite-/),
    100,
  );
});

it('stays on the create page when invite fails with a non-401 error', async () => {
  mocks.create.mockResolvedValue({ id: 'cw_11111111-1111-4111-8111-111111111111' });
  mocks.invite.mockRejectedValue(new NuniError(422, 'INVALID_INPUT'));
  render(<ClassCreate />);
  fireEvent.change(screen.getByLabelText('課班名稱'), { target: { value: '設計專題' } });
  fireEvent.submit(screen.getByLabelText('課班名稱').closest('form')!);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: '開課班' })).toBeTruthy();
});

it('sends an expired session back to account login', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  mocks.create.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  render(<ClassCreate />);
  fireEvent.change(screen.getByLabelText('課班名稱'), { target: { value: '設計專題' } });
  fireEvent.submit(screen.getByLabelText('課班名稱').closest('form')!);
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      `/auth/account?returnUrl=${encodeURIComponent('/auth/platform/class-workspace/new')}`,
    ),
  );
  expect(mocks.replace).not.toHaveBeenCalled();
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

it('does not create an invite after the account context changes while creating a workspace', async () => {
  const pending = deferred<{ id: string }>();
  mocks.create.mockReturnValue(pending.promise);
  mocks.invite.mockResolvedValue({ code: 'PRIVATE1' });
  const view = render(<ClassCreate />);
  fireEvent.change(screen.getByLabelText('課班名稱'), { target: { value: '原帳號課班' } });
  fireEvent.submit(screen.getByLabelText('課班名稱').closest('form')!);
  mocks.session = { ...mocks.session!, context: 'b'.repeat(43) };
  view.rerender(<ClassCreate />);
  await act(async () => pending.resolve({ id: 'cw_11111111-1111-4111-8111-111111111111' }));
  expect(mocks.invite).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect((screen.getByLabelText('課班名稱') as HTMLInputElement).value).toBe('');
});

it('ignores an old invite failure after logout starts', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  const invite = deferred<{ code: string }>();
  mocks.create.mockResolvedValue({ id: 'cw_11111111-1111-4111-8111-111111111111' });
  mocks.invite.mockReturnValue(invite.promise);
  const view = render(<ClassCreate />);
  fireEvent.change(screen.getByLabelText('課班名稱'), { target: { value: '原帳號課班' } });
  fireEvent.submit(screen.getByLabelText('課班名稱').closest('form')!);
  await waitFor(() => expect(mocks.invite).toHaveBeenCalledOnce());
  mocks.pendingLogout = true;
  view.rerender(<ClassCreate />);
  await act(async () => invite.reject(new NuniError(401, 'SIGN_IN_REQUIRED')));
  expect(replace).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('課班名稱')).toBeNull();
});
