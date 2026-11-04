import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';
const state = vi.hoisted(() => ({
  context: 'session-a',
  school: 'pu',
  pending: false,
  authenticated: true,
}));
vi.mock('./Session', () => ({
  useNuniSession: () => ({
    loading: false,
    error: '',
    pendingLogout: state.pending,
    session: state.authenticated ? { context: state.context } : null,
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.school }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  state.context = 'session-a';
  state.school = 'pu';
  state.pending = false;
  state.authenticated = true;
});
const json = (value: object) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
it('disabled shows existing unavailable message without Firebase requests', async () => {
  const fetch = vi.fn(async (..._args: [string]) => {
    void _args;
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  render(<Assistant />);
  expect(await screen.findByText('雲端助理尚未啟用。')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/nuni/assistant/capability');
});
it('two explicit confirmations precede public service link', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('capability')) return json({ enabled: true, ready: true });
      if (url.endsWith('preview'))
        return json({
          intent: 'map',
          summary: '公開地圖摘要',
          confirmation: 'first',
          simulation: true,
        });
      if (url.endsWith('ask'))
        return json({
          intent: 'map',
          answer: '公開地圖回答',
          confirmation: 'second',
          simulation: true,
        });
      return json({ href: '/map?schoolId=pu' });
    }),
  );
  render(<Assistant />);
  fireEvent.click(await screen.findByText('校園地圖'));
  await screen.findByText('公開地圖摘要');
  expect(calls).toHaveLength(2);
  fireEvent.click(screen.getByText('同意外送上述公開資料並查詢'));
  await screen.findByText('公開地圖回答');
  expect(calls).toHaveLength(3);
  fireEvent.click(screen.getByText('確認服務，取得站內入口'));
  expect((await screen.findByText('開啟服務頁面')).getAttribute('href')).toBe('/map?schoolId=pu');
  expect(screen.getByText(/私人課表、作業與借閱快照尚未支援/)).toBeTruthy();
});
it('school and account changes abort in-flight work and discard late responses', async () => {
  let resolvePreview: (value: Response) => void = () => {};
  let previewSignal: AbortSignal | undefined;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true });
    previewSignal = init.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      resolvePreview = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(<Assistant />);
  fireEvent.click(await screen.findByText('校園地圖'));
  await waitFor(() => expect(previewSignal).toBeDefined());
  state.school = 'other';
  state.context = 'session-b';
  view.rerender(<Assistant />);
  expect(previewSignal?.aborted).toBe(true);
  resolvePreview(json({ intent: 'map', summary: '舊帳號內容', confirmation: 'old' }));
  await screen.findByText('校園地圖');
  expect(screen.queryByText('舊帳號內容')).toBeNull();
  state.pending = true;
  view.rerender(<Assistant />);
  expect(screen.queryByText('校園地圖')).toBeNull();
});

it('provider unavailable preserves deterministic entries and disables model consent', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('capability')
        ? json({ enabled: true, ready: false })
        : json({ intent: 'map', summary: '公開摘要', confirmation: 'first', simulation: false }),
    ),
  );
  render(<Assistant />);
  expect(await screen.findByText('模型目前無法使用，可直接開啟公開服務入口。')).toBeTruthy();
  expect(screen.getByText('直接開啟校園地圖').getAttribute('href')).toBe('/map?schoolId=pu');
  fireEvent.click(screen.getByText('校園地圖'));
  const consent = await screen.findByText('同意外送上述公開資料並查詢');
  expect((consent as HTMLButtonElement).disabled).toBe(true);
});

it('v2 uses conversation consent, memory, data steps and separate card confirmation', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if (url.endsWith('confirm')) return json({ confirmed: true });
      return json({
        answer: 'v2 回答',
        steps: [{ name: 'get_schedule', status: 'ok', summary: '已查課表' }],
        cards: [
          {
            tool: 'propose_personal_event',
            token: 'synthetic-card',
            mutationId: 'm1',
            schoolId: 'pu',
            destination: '個人行事曆',
            args: {
              title: '精確作業安排',
              date: '2026-11-04',
              startTime: '20:00',
              endTime: '21:00',
            },
          },
        ],
      });
    }),
  );
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.change(question, { target: { value: '幫我排作業' } });
  expect((screen.getByText('送出') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('v2 回答');
  expect(bodies).toHaveLength(1);
  expect(bodies[0].history).toEqual([]);
  expect(bodies[0].consent).toBe(true);
  expect(screen.getByText('查了哪些資料')).toBeTruthy();
  expect(screen.getByText('精確作業安排')).toBeTruthy();
  fireEvent.click(screen.getByText('確認'));
  await screen.findByText('已加入個人行事曆');
  expect(bodies[1].token).toBe('synthetic-card');
  fireEvent.change(question, { target: { value: '接續安排' } });
  fireEvent.click(screen.getByText('送出'));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2].history).toEqual([
    { role: 'user', content: '幫我排作業' },
    { role: 'assistant', content: 'v2 回答' },
  ]);
});

it('v2 aborts on school/account changes and drops late answers and cards', async () => {
  let finish: (r: Response) => void = () => {};
  let oldSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      oldSignal = init.signal as AbortSignal;
      return new Promise<Response>((r) => {
        finish = r;
      });
    }),
  );
  const view = render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '舊問題' } });
  fireEvent.click(screen.getByText('送出'));
  await waitFor(() => expect(oldSignal).toBeDefined());
  state.context = 'session-b';
  state.school = 'other';
  view.rerender(<Assistant />);
  expect(oldSignal?.aborted).toBe(true);
  finish(json({ answer: '舊的私人內容', steps: [], cards: [] }));
  await screen.findByLabelText('問題');
  expect(screen.queryByText('舊的私人內容')).toBeNull();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

it('v2 replaces old cards and cancellation waits for server revocation', async () => {
  let asks = 0;
  const cancellations: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      const body = JSON.parse(init.body as string);
      if (url.endsWith('cancel')) {
        cancellations.push(body);
        return json({ revoked: true });
      }
      if (!body.routeToken) return json({ bootstrap: true, conversationId: 'server-conversation', routeToken: 'signed-route' });
      expect(body.routeToken).toBe('signed-route');
      expect(body.conversationId).toBe('server-conversation');
      const seq = ++asks;
      return json({
        issuer: 'machine-A',
        answer: '提議' + seq,
        steps: [],
        cards: [
          {
            tool: 'propose_personal_event',
            token: 'card-' + seq,
            mutationId: 'm-' + seq,
            schoolId: 'pu',
            destination: '個人曆',
            args: { title: '安排' + seq },
          },
        ],
      });
    }),
  );
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '今晚' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('提議1');
  fireEvent.change(question, { target: { value: '改成明晚' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('已被新提議取代');
  expect(screen.getAllByText('確認')).toHaveLength(1);
  fireEvent.click(screen.getByText('取消'));
  await screen.findByText('已取消');
  expect(cancellations).toHaveLength(1);
  expect(cancellations[0]).toMatchObject({ token: 'card-2' });
});
