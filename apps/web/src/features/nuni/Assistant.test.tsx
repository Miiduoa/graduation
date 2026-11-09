import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';
import { personalImportsStorageKey, readPersonalImports } from '@/lib/personalImports';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { V2Card } from './assistant/types';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
const state = vi.hoisted(() => ({
  context: 'a'.repeat(43),
  school: 'pu',
  pending: false,
  authenticated: true,
}));
vi.mock('./Session', () => ({
  useNuniSession: () => ({
    loading: false,
    error: '',
    pendingLogout: state.pending,
    session: state.authenticated ? { context: state.context, platformAccountId: 'alice' } : null,
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.school }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  sessionStorage.clear();
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_key: string, action: () => unknown) => {
      const task = lock.then(action);
      lock = task.then(() => undefined, () => undefined);
      return task;
    },
  } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.context = 'a'.repeat(43);
  state.school = 'pu';
  state.pending = false;
  state.authenticated = true;
});
const json = (value: object) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

const calendarCard = (id = 'calendar-event-1', title = '精確作業安排', startTime = '20:00'): V2Card => ({
  tool: 'propose_personal_event', token: 'token-' + id, mutationId: id, schoolId: 'pu',
  destination: '個人行事曆', args: { title, date: '2030-11-04', allDay: false, startTime,
    endTime: startTime === '20:00' ? '21:00' : '22:00' },
});
const receiptFor = (card: V2Card, replay = false, revision = 1) => createAssistantCalendarReceipt({
  schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
  revision, verifiedAt: '2026-11-07T11:00:00.000Z', replay,
  record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
    schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-07T10:59:00.000Z',
    source: { type: 'paste', line: 1, rawText: '', name: '助理確認' } },
});
const checkFor = (card: V2Card, status: 'absent' | 'conflict' | 'revoked', retryable = false) => ({
  version: 1, operation: 'calendar.create', status, schoolId: card.schoolId,
  mutationId: card.mutationId, storage: 'synced', revision: 0,
  checkedAt: '2026-11-07T11:00:00.000Z', authorizationValid: retryable, retryable,
  ...(status === 'revoked' ? { alreadyRevoked: false } : {}),
});

async function askForPlan() {
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '幫我排作業' } });
  fireEvent.click(screen.getByText('送出'));
  return question;
}

it('v2 opens a scoped service while the provider is unavailable and without model consent', async () => {
  const fetch = vi.fn(async () => json({ enabled: true, ready: false, version: 2 }));
  vi.stubGlobal('fetch', fetch);
  state.school = 'nthu';
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.change(question, { target: { value: '開啟助理權限' } });
  expect((screen.getByText('送出') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByText('送出'));
  expect((await screen.findByRole('link', { name: /開啟助理權限/ })).getAttribute('href'))
    .toBe('/settings?section=assistant&schoolId=nthu');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

it('v2 keeps local grades out of subsequent cloud history and clears them on scope change', async () => {
  localStorage.setItem(personalImportsStorageKey({ owner: 'platform:alice', schoolId: 'pu' }), JSON.stringify({
    version: 1, records: [{ id: 'grade-a', kind: 'grades', title: '個人成績專用課名',
      schoolId: 'pu', academicYear: '115', semester: '1', grade: '87', credits: 3,
      batchId: 'import-a', importedAt: '2026-11-07T10:00:00.000Z',
      source: { type: 'paste', line: 1, rawText: '不可帶入模型的原始文字' } }],
  }));
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    bodies.push(JSON.parse(String(init?.body)));
    return json({ answer: '一般查詢回覆', steps: [], cards: [] });
  }));
  const view = render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.change(question, { target: { value: '查看我的匯入成績' } });
  fireEvent.click(screen.getByText('送出'));
  expect(await screen.findByText(/個人成績專用課名/)).toBeTruthy();
  expect(bodies).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '附近餐廳有哪些' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('一般查詢回覆');
  expect(bodies[0].history).toEqual([]);
  expect(JSON.stringify(bodies)).not.toContain('個人成績專用課名');
  state.school = 'nthu';
  view.rerender(<Assistant />);
  await screen.findByLabelText('問題');
  expect(screen.queryByText(/個人成績專用課名/)).toBeNull();
});

it('excludes provider-selected academic reads with nonnumeric grades from subsequent history', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    bodies.push(JSON.parse(String(init?.body)));
    return json(bodies.length === 1
      ? { answer: '私人課名甲：免修；私人課名乙：缺考',
        steps: [{ name: 'get_imported_academics', status: 'ok', summary: '已核對個人紀錄' }], cards: [] }
      : { answer: '一般餐點資訊', steps: [], cards: [] });
  }));
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '比較本學期匯入的成績和其他紀錄' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText(/私人課名甲/);
  fireEvent.change(question, { target: { value: '附近餐廳有哪些' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('一般餐點資訊');
  expect(bodies[1].history).toEqual([]);
  expect(JSON.stringify(bodies[1])).not.toContain('私人課名');
});
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
  state.context = 'b'.repeat(43);
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
  const card = calendarCard();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if (url.endsWith('confirm')) return json(receiptFor(card));
      return json({
        answer: 'v2 回答',
        steps: [{ name: 'get_schedule', status: 'ok', summary: '已查課表' }],
        cards: [card],
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
  await screen.findByText('已核對並加入個人行事曆');
  expect(bodies[1].token).toBe(card.token);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([receiptFor(card).record]);
  expect(screen.getByRole('link', { name: '開啟這筆行程' }).getAttribute('href')).toBe('/calendar?schoolId=pu&eventId=calendar-event-1');
  fireEvent.change(question, { target: { value: '接續安排' } });
  fireEvent.click(screen.getByText('送出'));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies[2].history).toEqual([
    { role: 'user', content: '幫我排作業' },
    { role: 'assistant', content: expect.stringContaining('已讀回核對並儲存個人行程「精確作業安排」') },
  ]);
  expect(JSON.stringify(bodies[2].history)).not.toContain(card.token);
  expect(JSON.stringify(bodies[2].history)).not.toContain(card.mutationId);
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
  state.context = 'b'.repeat(43);
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
        return json(checkFor({ ...calendarCard('calendar-event-2', '安排2'), token: 'card-2' }, 'revoked'));
      }
      if (!body.routeToken) return json({ bootstrap: true, conversationId: 'server-conversation', routeToken: 'signed-route' });
      expect(body.routeToken).toBe('signed-route');
      expect(body.conversationId).toBe('server-conversation');
      const seq = ++asks;
      return json({
        issuer: 'machine-A',
        answer: '提議' + seq,
        steps: [],
        cards: [{ ...calendarCard('calendar-event-' + seq, '安排' + seq), token: 'card-' + seq }],
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
  await screen.findByText('已撤銷未執行提議');
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

it('does not treat HTTP success or a bare confirmed flag as a completed calendar task', async () => {
  const card = calendarCard();
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('confirm') || url.endsWith('reconcile')) return json({ confirmed: true });
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('確認'));
  await screen.findByText(/尚未核對執行結果/);
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  expect(screen.queryByText('取消')).toBeNull();
  expect(screen.queryByText('確認')).toBeNull();
  expect(screen.getByRole('button', { name: '重新核對結果' })).toBeTruthy();
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([]);
  expect(calls.filter((url) => url.endsWith('confirm'))).toHaveLength(1);
  expect(calls.filter((url) => url.endsWith('reconcile'))).toHaveLength(1);
});

it.each(['schoolId', 'mutationId', 'title'] as const)('rejects a receipt with a different %s before mirroring local data', async (field) => {
  const card = calendarCard();
  const receipt = receiptFor(card);
  const changed = field === 'title'
    ? { ...receipt, record: { ...receipt.record, title: '不是使用者確認的行程' } }
    : { ...receipt, [field]: field === 'schoolId' ? 'nthu' : 'different-event-id' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('confirm') || url.endsWith('reconcile')) return json(changed);
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('確認'));
  await screen.findByText(/尚未核對執行結果/);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([]);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'nthu' })).toEqual([]);
});

it('recovers a committed write with a lost response through one read-only check and no duplicate confirm', async () => {
  const card = calendarCard();
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('confirm')) throw new TypeError('response lost');
    if (url.endsWith('reconcile')) return json(receiptFor(card, true));
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  const confirm = await screen.findByText('確認');
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByText('已核對並加入個人行事曆');
  expect(calls.filter((url) => url.endsWith('confirm'))).toHaveLength(1);
  expect(calls.filter((url) => url.endsWith('reconcile'))).toHaveLength(1);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toHaveLength(1);
});

it('keeps verified items when a batch stops, then resumes only after the uncertain item is read back', async () => {
  const cards = [calendarCard('calendar-event-1', '英文讀書'), calendarCard('calendar-event-2', '程式練習', '21:00'),
    { ...calendarCard('calendar-event-3', '資料庫練習'), args: { title: '資料庫練習', date: '2030-11-05', allDay: false, startTime: '20:00', endTime: '21:00' } }];
  const confirmed: string[] = [];
  let canReconcile = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    const body = JSON.parse(String(init?.body));
    const card = cards.find((value) => value.token === body.token);
    if (url.endsWith('confirm')) {
      confirmed.push(body.token);
      if (card === cards[1]) throw new TypeError('lost response');
      return json(receiptFor(card!, false, card === cards[2] ? 3 : 1));
    }
    if (url.endsWith('reconcile')) {
      if (!canReconcile) throw new TypeError('network unavailable');
      return json(receiptFor(card!, true, 2));
    }
    return json({ answer: '三項安排', steps: [], cards });
  }));
  render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('依序全部確認'));
  await screen.findByText(/尚未核對執行結果/);
  expect(confirmed).toEqual([cards[0].token, cards[1].token]);
  expect(screen.getByLabelText('行程執行進度').textContent).toContain('已核對 1/3 項');
  expect(screen.getByLabelText('行程執行進度').textContent).toContain('待核對 1 項');
  expect((screen.getByText('確認') as HTMLButtonElement).disabled).toBe(true);
  canReconcile = true;
  // The first button belongs to the already verified first item.
  fireEvent.click(screen.getAllByRole('button', { name: '重新核對結果' })[1]);
  await waitFor(() => expect(screen.getByLabelText('行程執行進度').textContent).toContain('已核對 2/3 項'));
  fireEvent.click(screen.getByText('確認'));
  await waitFor(() => expect(screen.getByLabelText('行程執行進度').textContent).toContain('已核對 3/3 項'));
  expect(confirmed).toEqual(cards.map((card) => card.token));
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toHaveLength(3);
});

it('cancellation reads an already committed row as verified instead of claiming it was removed', async () => {
  const card = calendarCard();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('cancel')) return json(receiptFor(card, true));
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('取消'));
  await screen.findByText('已核對並加入個人行事曆');
  expect(screen.queryByText('已撤銷未執行提議')).toBeNull();
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toHaveLength(1);
});

it('records partial cancellation immediately and never retries a revoked earlier card', async () => {
  const cards = [calendarCard('calendar-event-1', '英文讀書'), calendarCard('calendar-event-2', '程式練習', '21:00')];
  const cancelled: string[] = [];
  let recovered = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    const body = JSON.parse(String(init?.body));
    const card = cards.find((value) => value.token === body.token);
    if (url.endsWith('cancel')) {
      cancelled.push(body.token);
      if (card === cards[1]) throw new TypeError('lost cancellation response');
      return json(checkFor(card!, 'revoked'));
    }
    if (url.endsWith('reconcile')) {
      if (!recovered) throw new TypeError('offline');
      return json(checkFor(card!, 'revoked'));
    }
    return json({ answer: '兩項安排', steps: [], cards });
  }));
  render(<Assistant />);
  await askForPlan();
  fireEvent.click((await screen.findAllByText('取消'))[0]);
  await screen.findByText(/尚未核對執行結果/);
  expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(1);
  expect(cancelled).toEqual(cards.map((card) => card.token));
  recovered = true;
  fireEvent.click(screen.getByRole('button', { name: '重新核對結果' }));
  await waitFor(() => expect(screen.getAllByText('已撤銷未執行提議')).toHaveLength(2));
  expect(cancelled).toEqual(cards.map((card) => card.token));
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([]);
});

it('retains remote success when local persistence fails and recovery never creates another remote event', async () => {
  const card = calendarCard();
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('confirm') || url.endsWith('reconcile')) return json(receiptFor(card));
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  const storage: Storage = Object.hasOwn(localStorage, 'setItem') ? localStorage : Object.getPrototypeOf(localStorage);
  const originalSetItem = localStorage.setItem;
  const persist = vi.spyOn(storage, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === localStorage) throw new Error('quota');
    return originalSetItem.call(this, key, value);
  });
  fireEvent.click(await screen.findByText('確認'));
  await screen.findByText(/帳號中已儲存，此裝置尚未更新/);
  expect(screen.queryByRole('link', { name: '開啟這筆行程' })).toBeNull();
  persist.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '重新核對並更新此裝置' }));
  await screen.findByRole('link', { name: '開啟這筆行程' });
  expect(calls.filter((url) => url.endsWith('confirm'))).toHaveLength(1);
  expect(calls.filter((url) => url.endsWith('reconcile'))).toHaveLength(1);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toHaveLength(1);
});

it('drops a late execution receipt after a session or school change without mirroring either ledger', async () => {
  const card = calendarCard();
  let finish: (response: Response) => void = () => {};
  let confirmationSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('confirm')) {
      confirmationSignal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  const view = render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('確認'));
  await waitFor(() => expect(confirmationSignal).toBeDefined());
  state.context = 'c'.repeat(43);
  state.school = 'nthu';
  view.rerender(<Assistant />);
  expect(confirmationSignal?.aborted).toBe(true);
  finish(json(receiptFor(card)));
  await screen.findByLabelText('問題');
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([]);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'nthu' })).toEqual([]);
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
});

it('keeps the last verified receipt when a later read-only check is unavailable', async () => {
  const card = calendarCard();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('confirm')) return json(receiptFor(card));
    if (url.endsWith('reconcile')) throw new TypeError('temporary network failure');
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('確認'));
  await screen.findByRole('link', { name: '開啟這筆行程' });
  fireEvent.click(screen.getByRole('button', { name: '重新核對結果' }));
  await screen.findByText(/這次查核未完成/);
  expect(screen.getByText('已核對並加入個人行事曆')).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟這筆行程' })).toBeTruthy();
  expect(screen.getByLabelText('行程執行進度').textContent).toContain('已核對 1/1 項');
});

it('saves a scoped recovery card before dispatch and resumes a reload with the original conversation read-only', async () => {
  const card = calendarCard();
  const confirmations: Record<string, unknown>[] = [];
  const reconciliations: Record<string, unknown>[] = [];
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    const body = JSON.parse(String(init?.body));
    if (url.endsWith('confirm')) {
      confirmations.push(body);
      const journal = readAssistantExecutionJournal({ owner: 'platform:alice', schoolId: 'pu', context: state.context });
      expect(journal).toHaveLength(1);
      expect(journal[0].conversationId).toBe(body.conversationId);
      expect(journal[0].card.token).toBe(card.token);
      return new Promise<Response>((resolve) => { finish = resolve; });
    }
    if (url.endsWith('reconcile')) {
      reconciliations.push(body);
      return json(receiptFor(card, true));
    }
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  const first = render(<Assistant />);
  await askForPlan();
  fireEvent.click(await screen.findByText('確認'));
  await waitFor(() => expect(confirmations).toHaveLength(1));
  first.unmount();
  render(<Assistant />);
  await screen.findByRole('link', { name: '開啟這筆行程' });
  expect(confirmations).toHaveLength(1);
  expect(reconciliations).toHaveLength(1);
  expect(reconciliations[0].conversationId).toBe(confirmations[0].conversationId);
  expect(reconciliations[0].token).toBe(card.token);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(readAssistantExecutionJournal({ owner: 'platform:alice', schoolId: 'pu', context: state.context })).toEqual([]);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toHaveLength(1);
  finish(json(receiptFor(card)));
});

it('does not dispatch a write when recovery storage cannot be saved', async () => {
  const card = calendarCard();
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    return json({ answer: '請核對安排', steps: [], cards: [card] });
  }));
  render(<Assistant />);
  await askForPlan();
  const storage: Storage = Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage);
  const originalSetItem = sessionStorage.setItem;
  const persist = vi.spyOn(storage, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === sessionStorage) throw new Error('quota');
    return originalSetItem.call(this, key, value);
  });
  fireEvent.click(await screen.findByText('確認'));
  await screen.findByText('重試原確認');
  expect(calls.some((url) => url.endsWith('confirm'))).toBe(false);
  expect(calls.some((url) => url.endsWith('reconcile'))).toBe(false);
  expect(readPersonalImports({ owner: 'platform:alice', schoolId: 'pu' })).toEqual([]);
  persist.mockRestore();
});

it('pauses automatic recovery after the first unavailable result and keeps local services usable', async () => {
  const scope = { owner: 'platform:alice', schoolId: 'pu', context: state.context };
  for (const card of [calendarCard('calendar-event-1', '英文'), calendarCard('calendar-event-2', '程式', '21:00')])
    saveAssistantExecutionJournal(scope, { conversationId: 'prior-conversation', card }, () => true);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('capability')) return json({ enabled: true, ready: false, version: 2 });
    throw new TypeError('network unavailable');
  }));
  render(<Assistant />);
  await screen.findByText(/尚未核對執行結果/);
  const question = screen.getByLabelText('問題');
  fireEvent.change(question, { target: { value: '開啟校園地圖' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByRole('link', { name: /開啟校園地圖/ });
  expect(calls.filter((url) => url.endsWith('reconcile'))).toHaveLength(1);
  expect(calls.some((url) => url.endsWith('confirm'))).toBe(false);
  expect(readAssistantExecutionJournal(scope)).toHaveLength(2);
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

it('keeps the next draft typed while a cloud answer is pending', async () => {
  let resolveAnswer: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    return new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  }));
  render(<Assistant />);
  const field = await screen.findByLabelText('問題') as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '幫我整理專題介紹的流程' } });
  await waitFor(() => expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(field.value).toBe(''));
  fireEvent.change(field, { target: { value: '也幫我找校園活動' } });
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  resolveAnswer(json({ answer: '已整理專題說明流程', steps: [], cards: [] }));
  await screen.findByText('已整理專題說明流程');
  expect(field.value).toBe('也幫我找校園活動');
});

it('keeps an unsuccessful question recoverable without discarding a later draft', async () => {
  let resolveAnswer: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    return new Promise<Response>((resolve) => { resolveAnswer = resolve; });
  }));
  render(<Assistant />);
  const field = await screen.findByLabelText('問題') as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '請核對明天的專題會議' } });
  await waitFor(() => expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(field.value).toBe(''));
  fireEvent.change(field, { target: { value: '新的草稿不能消失' } });
  resolveAnswer(new Response(JSON.stringify({ message: '查詢服務暫時無法連線' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  }));
  await screen.findByRole('group', { name: '未完成的問題' });
  expect(field.value).toBe('新的草稿不能消失');
  expect(screen.getByText('請核對明天的專題會議')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(field.value).toBe('請核對明天的專題會議');
  expect(screen.getByText('新的草稿不能消失')).toBeTruthy();
});

it('stops only an in-flight model read, ignores late transport data, and keeps the next draft', async () => {
  let lateAnswer: (response: Response) => void = () => {};
  let stoppedSignal: AbortSignal | undefined;
  let asks = 0;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push(url);
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('/ask')) {
      asks += 1;
      if (asks === 1) {
        stoppedSignal = options?.signal as AbortSignal;
        return new Promise<Response>((resolve) => { lateAnswer = resolve; });
      }
      return json({ answer: '新問題已回答', steps: [], cards: [] });
    }
    throw new Error('unexpected mutation endpoint');
  }));
  render(<Assistant />);
  const field = await screen.findByLabelText('問題') as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '先幫我規劃本週作業' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  const stop = await screen.findByRole('button', { name: '停止這次回答' });
  fireEvent.change(field, { target: { value: '下一句已先寫好了' } });
  fireEvent.click(stop);
  await screen.findByRole('group', { name: '未完成的問題' });
  expect(stoppedSignal?.aborted).toBe(true);
  expect(field.value).toBe('下一句已先寫好了');
  expect(screen.getByText('先幫我規劃本週作業')).toBeTruthy();
  lateAnswer(json({ answer: '取消後晚到的舊答案', steps: [], cards: [] }));
  await waitFor(() => expect(screen.queryByText('取消後晚到的舊答案')).toBeNull());
  expect(calls.every((path) => !/\/(confirm|cancel|reconcile)$/.test(path))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('新問題已回答');
  expect(asks).toBe(2);
  expect(field.value).toBe('');
});

it('stopping a cloud read never treats action confirmation as cancelled', async () => {
  let lateAnswer: (response: Response) => void = () => {};
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url.endsWith('/ask')) {
      calls += 1;
      if (calls === 1) return new Promise<Response>((resolve) => { lateAnswer = resolve; });
      return json({ answer: '已再次核對需求', steps: [], cards: [] });
    }
    throw new Error('should never call a write endpoint');
  }));
  render(<Assistant />);
  const field = await screen.findByLabelText('問題') as HTMLTextAreaElement;
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '請給我行程建議' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止這次回答' }));
  await screen.findByText(/已停止這次回答/);
  lateAnswer(json({ answer: '這筆不是可執行的回執', steps: [], cards: [] }));
  expect(screen.queryByText('這筆不是可執行的回執')).toBeNull();
  expect(screen.queryByRole('button', { name: '停止這次回答' })).toBeNull();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});
