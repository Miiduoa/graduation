import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { ClassCreate } from './ClassCreate';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  invite: vi.fn(),
  replace: vi.fn(),
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
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/features/nuni/CourseUI', () => ({
  useClasses: () => ({ create: mocks.create, invite: mocks.invite, join: vi.fn() }),
}));

beforeEach(() => {
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
      '/auth/platform/class-workspace/cw_11111111-1111-4111-8111-111111111111?invite=INVITE1',
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
