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
  const { port, needsSignIn, capabilityStatus, retryCapability } = usePublicNavigationPort(
    school,
    '靜宜',
  );
  return (
    <>
      {needsSignIn && <p>請登入</p>}
      <p data-testid="capability">{capabilityStatus}</p>
      {capabilityStatus === 'error' && <button onClick={retryCapability}>重新查詢</button>}
      {port && <PublicNavigationTask port={port} />}
    </>
  );
}
const capability = (schoolId: string, modes = ['groq']) =>
  Response.json({
    schoolId,
    modes,
    source: modes.length ? { date: '2026-10-19', label: 'OSM' } : null,
  });
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
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability')) return capability('pu');
    return Response.json(null);
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
    if (url.endsWith('/capability')) return capability('pu');
    if (url.endsWith('/status')) return Response.json(null);
    if (url.endsWith('/prepareGroq'))
      return await new Promise<Response>((r) => {
        resolve = r;
      });
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<View />);
  const input = await screen.findByLabelText('起點與終點');
  fireEvent.change(input, { target: { value: '從甲樓到乙館' } });
  fireEvent.click(screen.getByRole('button', { name: '檢視傳送內容' }));
  state.session = { platformAccountId: 'pa_b', context: 'context-b' };
  view.rerender(<View />);
  await waitFor(() =>
    expect((screen.getByLabelText('起點與終點') as HTMLInputElement).value).toBe(''),
  );
  await act(async () => resolve(Response.json({ request: {}, receipt: {}, checkedAt: 1 })));
  expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
  vi.unstubAllGlobals();
});
it('does not expose a Groq port when the selected school only supports deterministic navigation', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability')) return capability('pu', ['deterministic']);
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  render(<View />);
  await waitFor(() => expect(screen.getByTestId('capability').textContent).toBe('unavailable'));
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false);
  vi.unstubAllGlobals();
});
it('shows an unavailable state for an unknown school and a retry for a temporary error', async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability'))
      return ++attempts === 1
        ? Response.json({ error: 'PUBLIC_AGENT_SOURCE_UNAVAILABLE' }, { status: 503 })
        : capability('other', []);
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  render(<View school="other" />);
  await screen.findByRole('button', { name: '重新查詢' });
  fireEvent.click(screen.getByRole('button', { name: '重新查詢' }));
  await waitFor(() => expect(screen.getByTestId('capability').textContent).toBe('unavailable'));
  expect(attempts).toBe(2);
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  vi.unstubAllGlobals();
});
it('drops a late capability after school or account switches, including returning to the same school', async () => {
  const pending: Array<{ school: string; context: string; resolve: (response: Response) => void }> =
    [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability'))
      return await new Promise<Response>((resolve) => {
        pending.push({
          school: JSON.parse(String(init?.body)).schoolId,
          context: new Headers(init?.headers).get('X-Campus-Session') ?? '',
          resolve,
        });
      });
    if (url.endsWith('/status')) return Response.json(null);
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<View />);
  await waitFor(() => expect(pending.length).toBe(1));
  view.rerender(<View school="other" />);
  await waitFor(() => expect(pending.length).toBe(2));
  state.session = { platformAccountId: 'pa_b', context: 'context-b' };
  view.rerender(<View school="pu" />);
  await waitFor(() => expect(pending.length).toBe(3));
  await act(async () => {
    pending[0]!.resolve(capability('pu'));
    pending[1]!.resolve(capability('other'));
  });
  expect(screen.getByTestId('capability').textContent).toBe('loading');
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  expect(pending[2]?.context).toBe('context-b');
  await act(async () => pending[2]!.resolve(capability('pu', [])));
  expect(screen.getByTestId('capability').textContent).toBe('unavailable');
  state.session = null;
  view.rerender(<View school="pu" />);
  expect(screen.getByTestId('capability').textContent).toBe('idle');
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  vi.unstubAllGlobals();
});
it('does not restore a previously enabled capability after A→B→A before the new check', async () => {
  const pending: Array<(response: Response) => void> = [];
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability'))
      return await new Promise<Response>((resolve) => pending.push(resolve));
    if (url.endsWith('/status')) return Response.json(null);
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<View />);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0]!(capability('pu')));
  await screen.findByLabelText('起點與終點');
  view.rerender(<View school="other" />);
  await waitFor(() => expect(pending).toHaveLength(2));
  view.rerender(<View school="pu" />);
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(screen.getByTestId('capability').textContent).toBe('loading');
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  await act(async () => pending[1]!(capability('other')));
  expect(screen.getByTestId('capability').textContent).toBe('loading');
  await act(async () => pending[2]!(capability('pu', [])));
  expect(screen.getByTestId('capability').textContent).toBe('unavailable');
  vi.unstubAllGlobals();
});
it('rejects a capability response for a different school', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability')) return capability('other');
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  render(<View />);
  await screen.findByRole('button', { name: '重新查詢' });
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  vi.unstubAllGlobals();
});
it('times out a stalled capability request and keeps late results from reopening it', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/availability')) return Response.json({ enabled: true });
    if (url.endsWith('/capability'))
      return await new Promise<Response>((done) => {
        resolve = done;
      });
    throw new Error('unexpected');
  });
  vi.stubGlobal('fetch', fetcher);
  vi.useFakeTimers();
  render(<View />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(resolve).toBeTypeOf('function');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000);
  });
  expect(screen.getByRole('button', { name: '重新查詢' })).toBeTruthy();
  await act(async () => resolve(capability('pu')));
  expect(screen.queryByRole('region', { name: '公開校園導航' })).toBeNull();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
