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
  const fetch = vi.fn(async (_url: string) => new Response('{}', { status: 404 }));
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
