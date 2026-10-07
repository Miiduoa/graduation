import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RequireAdmin } from './RequireAdmin';
import { getSupabaseClient } from '@/lib/supabaseClient';

const campusAuth = vi.hoisted(() => ({ uid: 'campus-alice' as string | null, loading: false }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({
    user: campusAuth.uid ? { uid: campusAuth.uid } : null,
    loading: campusAuth.loading,
  }),
}));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
const client = {
  auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() },
  from: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  campusAuth.uid = 'campus-alice';
  campusAuth.loading = false;
  vi.mocked(getSupabaseClient).mockReturnValue(client);
  client.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'unrelated-admin', email: 'private@example.test' } } },
  });
  client.auth.signOut.mockResolvedValue({ error: null });
});
it('does not mount children when the integration is unconfigured', () => {
  vi.mocked(getSupabaseClient).mockReturnValue(null);
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  expect(screen.queryByText('Private records')).toBeNull();
  expect(screen.getByText('教學管理尚未開放')).toBeTruthy();
});
it('never reads a separate account or mounts management readers without a verified binding', () => {
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  expect(screen.queryByText('Private records')).toBeNull();
  expect(screen.getByText('教學管理尚未完成帳號連結')).toBeTruthy();
  expect(client.auth.getSession).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});
it('a signed-out campus account cannot expose a persisted LMS session', () => {
  campusAuth.uid = null;
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  expect(screen.queryByText('Private records')).toBeNull();
  expect(screen.getByText('請先登入校園帳號')).toBeTruthy();
  expect(client.auth.getSession).not.toHaveBeenCalled();
});
it('provides an explicit local logout for any residual teaching session', async () => {
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  fireEvent.click(screen.getByRole('button', { name: '清除先前的教學服務登入' }));
  await waitFor(() => expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  expect(await screen.findByText('已清除這個瀏覽器的教學服務登入。')).toBeTruthy();
});
it.each(['resolve', 'reject'])(
  'does not expose an old identity after account switching with a delayed logout: %s',
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    client.auth.signOut.mockImplementationOnce(
      () =>
        new Promise((resolve, fail) => {
          finish = resolve;
          reject = fail;
        }),
    );
    const view = render(
      <RequireAdmin>
        <p>Private records</p>
      </RequireAdmin>,
    );
    fireEvent.click(screen.getByRole('button', { name: '清除先前的教學服務登入' }));
    campusAuth.uid = 'campus-bob';
    view.rerender(
      <RequireAdmin>
        <p>Private records</p>
      </RequireAdmin>,
    );
    await act(async () => {
      if (outcome === 'resolve') finish({ error: null });
      else reject(new Error('offline'));
    });
    expect(screen.queryByText(/private@example.test|Private records/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getSession).not.toHaveBeenCalled();
  },
);
