import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';
const state = vi.hoisted(() => ({
  context: 'session-a',
  school: 'pu',
  pending: false,
  authenticated: true,
  query: '',
}));
vi.mock('./Session', () => ({
  useNuniSession: () => ({
    loading: false,
    error: '',
    pendingLogout: state.pending,
    session: state.authenticated ? { context: state.context } : null,
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.school }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.context = 'session-a';
  state.school = 'pu';
  state.pending = false;
  state.authenticated = true;
  state.query = '';
});
const json = (value: object) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function publicCatalog(schoolId: 'ncnu' | 'nthu', changes: Record<string, unknown> = {}) {
  return json({
    schoolId,
    sourceUrl: schoolId === 'ncnu'
      ? 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall'
      : 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json',
    fetchedAt: '2026-11-07T08:00:00.000Z',
    operation: { id: `${schoolId}.courses.search`, version: 1, responseSchemaVersion: 1, access: 'anonymous-public' },
    courses: [{
      code: 'CS430000', section: '01', title: '公開資料庫課程', department: '資訊系',
      teacher: '公開授課老師', credits: '3', time: '一34', room: '資電館101', semester: '1151',
    }],
    truncated: false,
    ...changes,
  });
}
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

it('v2 consent names Groq only until capability reports a fallback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      return json({ answer: '', steps: [], cards: [] });
    }),
  );
  const off = render(<Assistant />);
  const offLabel = await screen.findByRole('checkbox');
  expect(offLabel.closest('label')?.textContent).toMatch(/傳送\s*Groq/);
  expect(offLabel.closest('label')?.textContent).not.toMatch(/Cloudflare Workers AI/);
  off.unmount();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('capability'))
        return json({ enabled: true, ready: true, version: 2, fallback: true });
      return json({ answer: '', steps: [], cards: [] });
    }),
  );
  render(<Assistant />);
  const onLabel = await screen.findByRole('checkbox');
  expect(onLabel.closest('label')?.textContent).toMatch(/Groq/);
  expect(onLabel.closest('label')?.textContent).toMatch(/Cloudflare Workers AI/);
});

it('v2 renders markdown, assignment rows and food cards without raw paths', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      return json({
        answer: '## 待繳\n- **樹與圖作業**（資訊課程）截止 2026-11-05T23:59:00+08:00\n社團請到 /clubs。',
        steps: [{ name: 'get_due_work', status: 'ok', summary: '已查作業' }],
        cards: [
          {
            tool: 'propose_food_order',
            token: 'food-card',
            mutationId: 'food-1',
            schoolId: 'pu',
            destination: '點餐頁',
            args: {
              reason: '帶到點餐頁',
              href: '/food?tenant=a&location=dining-a',
              summary: {
                store: '合成蔬食餐廳',
                totalMinor: 8000,
                requestedPickupAt: '2026-11-04T12:00:00+08:00',
                lines: [{ name: '蔬菜便當', quantity: 1, options: ['標準不辣'], unitMinor: 8000 }],
              },
            },
          },
        ],
      });
    }),
  );
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '作業和午餐' } });
  fireEvent.click(screen.getByText('送出'));
  expect(await screen.findByText('樹與圖作業')).toBeTruthy();
  expect(screen.getByText(/資訊課程/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟社團' }).getAttribute('href')).toBe('/clubs');
  expect(screen.queryByText('/clubs')).toBeNull();
  expect(screen.getByText('合成蔬食餐廳')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往點餐頁' }).getAttribute('href')).toContain('/food?');
  expect(screen.getByText('確認')).toBeTruthy();
});

it.each(['ncnu', 'nthu'] as const)('v2 reads %s public courses without model availability or cloud consent', async (schoolId) => {
  state.school = schoolId;
  const fetcher = vi.fn(async (url: string) => url.endsWith('capability')
    ? json({ enabled: true, ready: false, version: 2 }) : publicCatalog(schoolId));
  vi.stubGlobal('fetch', fetcher);
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.change(question, { target: { value: '幫我查資料庫課程' } });
  const send = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
  expect(send.disabled).toBe(false);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(send);
  await screen.findByText('公開資料庫課程');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const url = new URL(fetcher.mock.calls[1][0], 'https://nuni.tw');
  expect(url.pathname).toBe('/api/public-course-catalog');
  expect(url.searchParams.get('schoolId')).toBe(schoolId);
  expect(url.searchParams.get('q')).toBe('資料庫');
  expect(screen.getByRole('link', { name: '校方資料來源' })).toBeTruthy();
  expect(screen.getByText(/115 學年度第 1 學期/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  fireEvent.change(question, { target: { value: '我的下一堂課' } });
  expect(send.disabled).toBe(true);
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('v2 preserves the sign-in gate and seeds a shared q only as an editable draft', async () => {
  state.query = 'q=' + encodeURIComponent('幫我查清大資料庫課程');
  state.authenticated = false;
  const fetcher = vi.fn(async () => json({ enabled: true, ready: false, version: 2 }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Assistant />);
  const login = screen.getByRole('link', { name: '請先登入以使用校園助理' });
  const returnTo = new URL(login.getAttribute('href')!, 'https://nuni.tw').searchParams.get('returnTo');
  expect(new URL(returnTo!, 'https://nuni.tw').searchParams.get('q')).toBe('幫我查清大資料庫課程');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  state.authenticated = true;
  view.rerender(<Assistant />);
  expect((await screen.findByLabelText('問題') as HTMLTextAreaElement).value).toBe('幫我查清大資料庫課程');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByRole('link', { name: '查看課程與課表核對' })).toBeNull();
});

it('v2 retains signed proposal state and private conversation binding across another-campus public lookup', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.startsWith('/api/public-course-catalog?')) return publicCatalog('nthu');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    bodies.push(body);
    if (url.endsWith('confirm')) return json({ confirmed: true });
    if (!body.routeToken) return json({ bootstrap: true, conversationId: 'bound-conversation', routeToken: 'bound-route' });
    return json({ answer: '原校園私人提議', steps: [], cards: [{
      tool: 'propose_personal_event', token: 'signed-pu-card', mutationId: 'keep-card',
      schoolId: 'pu', destination: '個人行事曆', args: { title: '待確認的讀書安排' },
    }] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '幫我安排讀書時間' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('待確認的讀書安排');
  expect(bodies).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '幫我查清大資料庫課程' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('公開資料庫課程');
  const href = new URL(screen.getByRole('link', { name: '查看課程與課表核對' }).getAttribute('href')!, 'https://nuni.tw');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(bodies).toHaveLength(2);
  expect(screen.queryByText('已被新提議取代')).toBeNull();
  expect(screen.queryByText('已加入個人行事曆')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  await screen.findByText('已加入個人行事曆');
  expect(bodies[2]).toMatchObject({ schoolId: 'pu', token: 'signed-pu-card', conversationId: 'bound-conversation' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '接續安排' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(bodies).toHaveLength(4));
  expect(bodies[3]).toMatchObject({
    schoolId: 'pu', conversationId: 'bound-conversation', routeToken: 'bound-route',
    history: [{ role: 'user', content: '幫我安排讀書時間' }, { role: 'assistant', content: '原校園私人提議' }],
  });
});

it('v2 shows a source failure without treating it as an empty catalog or asking the model', async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith('capability')
    ? json({ enabled: true, ready: true, version: 2 })
    : publicCatalog('nthu', { sourceUrl: 'https://example.test/unreviewed-courses' }));
  vi.stubGlobal('fetch', fetcher);
  render(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: '幫我查清大資料庫課程' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText(/暫時無法取得可核對/);
  expect(screen.queryByText('公開資料庫課程')).toBeNull();
  expect(screen.queryByText(/沒有符合的開課資料/)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([url]) => !url.endsWith('/ask'))).toBe(true);
});

it.each(['account', 'school', 'logout'] as const)('v2 cancels public results when the %s changes', async (change) => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: false, version: 2 });
    signal = init.signal as AbortSignal;
    return new Promise<Response>((resolve) => { finish = resolve; });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Assistant />);
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: '幫我查清大資料庫課程' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(signal).toBeDefined());
  if (change === 'account') state.context = 'session-b';
  else if (change === 'school') state.school = 'ncnu';
  else state.pending = true;
  view.rerender(<Assistant />);
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(publicCatalog('nthu')); });
  expect(screen.queryByText('公開資料庫課程')).toBeNull();
  expect(screen.queryByRole('link', { name: '查看課程與課表核對' })).toBeNull();
  expect(fetcher.mock.calls.every(([url]) => !url.endsWith('/ask'))).toBe(true);
});
