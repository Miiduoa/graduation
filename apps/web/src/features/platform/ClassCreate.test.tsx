import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassCreate } from './ClassCreate';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  replace: vi.fn(),
  session: null as null | { platformAccountId: string; context: string; isPlatformOperator: boolean },
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
  useClasses: () => ({ create: mocks.create, join: vi.fn() }),
}));

const fetcher = vi.fn();

beforeEach(() => {
  mocks.create.mockReset();
  mocks.replace.mockReset();
  mocks.session = {
    platformAccountId: 'pa_1',
    context: 'a'.repeat(43),
    isPlatformOperator: false,
  };
  fetcher.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ code: 'INVITE1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('creates a workspace then asks the existing invite endpoint for 100 uses', async () => {
  mocks.create.mockResolvedValue({ id: 'cw_11111111-1111-4111-8111-111111111111' });
  render(<ClassCreate />);
  fireEvent.change(screen.getByLabelText('課班名稱'), { target: { value: '設計專題' } });
  fireEvent.submit(screen.getByLabelText('課班名稱').closest('form')!);
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      '/auth/platform/class-workspace/cw_11111111-1111-4111-8111-111111111111?invite=INVITE1',
    ),
  );
  expect(mocks.create).toHaveBeenCalledWith('設計專題', expect.stringMatching(/^web-create-/));
  expect(fetcher.mock.calls[0][0]).toContain(
    '/auth/platform/class-workspaces/cw_11111111-1111-4111-8111-111111111111/invites',
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ maxUses: 100 });
});
