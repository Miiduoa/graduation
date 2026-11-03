import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePublicNavigationPort } from './usePublicNavigationPort';
import { PublicNavigationTask } from './PublicNavigationTask';
const state = vi.hoisted(() => ({
  session: { platformAccountId: 'pa_a', context: 'context-a' } as {
    platformAccountId: string;
    context: string;
  } | null,
  loading: false,
  error: '',
  pendingLogout: false,
}));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => state }));
function View({ school = 'pu' }: { school?: string }) {
  const { port, needsSignIn } = usePublicNavigationPort(school, '靜宜');
  return (
    <>
      {needsSignIn && <p>請登入</p>}
      {port && <PublicNavigationTask port={port} />}
    </>
  );
}
beforeEach(() => {
  state.session = { platformAccountId: 'pa_a', context: 'context-a' };
  state.loading = false;
  state.error = '';
  state.pendingLogout = false;
});
it('leaves the existing map unchanged when the feature is not enabled', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  render(<View />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  vi.unstubAllGlobals();
});
it('requires a platform session and creates a scoped single-call BFF port', async () => {
  state.session = null;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    return url.endsWith('/availability') ? Response.json({ enabled: true }) : Response.json(null);
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<View />);
  await screen.findByText('請登入');
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  state.session = { platformAccountId: 'pa_a', context: 'context-a' };
  view.rerender(<View />);
  await screen.findByLabelText('起點與終點');
  const statusCall = fetcher.mock.calls.find((c) => String(c[0]).endsWith('/status'))!;
  expect(statusCall).toBeTruthy();
  const init = statusCall[1] as RequestInit;
  expect(new Headers(init.headers).get('x-campus-session')).toBe('context-a');
  expect(init.credentials).toBe('same-origin');
  vi.unstubAllGlobals();
});
it('clears old account draft and ignores a late preview on platform account switch', async () => {
  let resolve!: (v: Response) => void;
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/status')) return Response.json(null);
    if (url.endsWith('/preview'))
      return await new Promise<Response>((r) => {
        resolve = r;
      });
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<View />);
  const input = await screen.findByLabelText('起點與終點');
  fireEvent.change(input, { target: { value: '從甲樓到乙館' } });
  fireEvent.click(screen.getByRole('button', { name: '檢視路線' }));
  state.session = { platformAccountId: 'pa_b', context: 'context-b' };
  view.rerender(<View />);
  await waitFor(() =>
    expect((screen.getByLabelText('起點與終點') as HTMLInputElement).value).toBe(''),
  );
  await act(async () => resolve(Response.json({ request: {}, receipt: {}, checkedAt: 1 })));
  expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
  vi.unstubAllGlobals();
});
