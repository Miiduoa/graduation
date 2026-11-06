import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { callCampusAssistant } from '@/lib/campusAssistantClient';
import { AssistantEnabledProvider } from './AssistantEnabledProvider';
import { TodayCampusEntry } from './TodayCampusEntry';

const state = vi.hoisted(() => ({
  context: 'session-a' as string | null,
  school: 'pu',
  uid: null as string | null,
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, error: null }),
}));
vi.mock('@/features/nuni/Session', () => {
  const session = () => ({
    session: state.context ? { context: state.context, platformAccountId: state.context } : null,
    loading: false,
    pendingLogout: false,
    error: '',
  });
  return { useOptionalNuniSession: session, useNuniSession: session };
});
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: { id: state.school, name: state.school },
    selectedSchoolId: state.school,
    catalogStatus: 'ready',
    loading: false,
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => true,
}));
vi.mock('@/lib/campusAssistantClient', async (original) => ({
  ...(await original<typeof import('@/lib/campusAssistantClient')>()),
  callCampusAssistant: vi.fn(),
  getCampusAssistantSnapshot: vi.fn().mockRejectedValue(new Error('snapshot offline')),
}));

function entry(enabled = true) {
  return (
    <AssistantEnabledProvider enabled={enabled}>
      <TodayCampusEntry />
    </AssistantEnabledProvider>
  );
}

function mockNuniAsk(
  ask: (body: Record<string, unknown>, signal?: AbortSignal | null) => Response | Promise<Response>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      if (url === '/api/nuni/assistant/capability')
        return Promise.resolve(Response.json({ version: 2, enabled: true, ready: true }));
      if (url === '/api/nuni/assistant/ask') return ask(JSON.parse(String(init.body)), init.signal);
      throw new Error('Unexpected request ' + url);
    }),
  );
}

function reply(answer: string) {
  return Response.json({ answer, steps: [], cards: [] });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/?campus=pu');
  Element.prototype.scrollIntoView = vi.fn();
  state.context = 'session-a';
  state.school = 'pu';
  state.uid = null;
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it('accepts a spoken question on Today, waits for consent and sends follow-ups in the same conversation', async () => {
  let dictate: (text: string) => void = () => {};
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      onresult?: (event: unknown) => void;
      start() {
        dictate = (text) =>
          this.onresult?.({ results: [{ isFinal: true, 0: { transcript: text } }] });
      }
      abort() {}
    },
  );
  const ask = vi
    .fn()
    .mockReturnValueOnce(reply('下一堂是資料庫。'))
    .mockReturnValueOnce(reply('在主顧樓。'));
  mockNuniAsk(ask);
  render(entry());
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  fireEvent.click(await screen.findByRole('button', { name: '使用語音輸入' }));
  act(() => dictate('下堂課'));
  expect(field.value).toBe('下堂課');
  fireEvent.change(field, { target: { value: '下一堂課是什麼？' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('下一堂是資料庫。');
  expect(ask.mock.calls[0][0]).toMatchObject({
    schoolId: 'pu',
    question: '下一堂課是什麼？',
    history: [],
    consent: true,
  });
  fireEvent.change(field, { target: { value: '在哪裡上課？' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('在主顧樓。');
  expect(ask.mock.calls[1][0]).toMatchObject({
    conversationId: ask.mock.calls[0][0].conversationId,
    question: '在哪裡上課？',
    history: [
      { role: 'user', content: '下一堂課是什麼？' },
      { role: 'assistant', content: '下一堂是資料庫。' },
    ],
  });
  expect(window.location.pathname + window.location.search).toBe('/?campus=pu');
});

it.each(['account', 'school'])(
  'drops an in-flight reply when the Today %s changes',
  async (scope) => {
    let finish!: (result: Response) => void;
    let requestSignal: AbortSignal | null | undefined;
    mockNuniAsk((_body, signal) => {
      requestSignal = signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const view = render(entry());
    const field = await screen.findByRole('textbox', { name: '問題' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(field, { target: { value: '舊校課表' } });
    fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
    await waitFor(() => expect(requestSignal).toBeDefined());
    if (scope === 'school') state.school = 'ncku';
    else state.context = 'session-b';
    view.rerender(entry());
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => finish(reply('舊的私人課表')));
    await screen.findByRole('textbox', { name: '問題' });
    expect(screen.queryByText('舊的私人課表')).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  },
);

it('carries a typed service search into the school assistant on Today without sending it until confirmed', async () => {
  state.context = null;
  state.uid = 'alice';
  vi.mocked(callCampusAssistant).mockResolvedValue({ content: '你有兩份作業。' });
  render(entry(false));
  fireEvent.click(await screen.findByRole('button', { name: '找校園服務' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '今天有幾份作業？' } });
  fireEvent.click(screen.getByRole('button', { name: '詢問校園助理' }));
  expect(
    (await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '你的問題' })).value,
  ).toBe('今天有幾份作業？');
  expect(callCampusAssistant).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('你有兩份作業。');
  expect(vi.mocked(callCampusAssistant).mock.calls[0][0]).toMatchObject({
    userId: 'alice',
    schoolId: 'pu',
  });
  expect(window.location.pathname + window.location.search).toBe('/?campus=pu');
});

it('leaves signed-out visitors with local shortcuts and makes no assistant requests', async () => {
  state.context = null;
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(entry());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要查課表' } });
  expect(screen.getByRole('link', { name: /課表/ })).toBeTruthy();
  expect(screen.queryByRole('form', { name: '傳送問題' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('keeps the public-service picker usable when free-form nuni questions are unavailable', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ enabled: true, ready: true }));
  vi.stubGlobal('fetch', fetch);
  render(entry());
  expect(await screen.findByRole('button', { name: '公車資訊' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '找校園服務' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我想搭公車' } });
  expect(screen.queryByRole('button', { name: '詢問校園助理' })).toBeNull();
  expect(screen.queryByRole('link', { name: '詢問校園助理' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: '問題' })).toBeNull();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/nuni/assistant/capability']);
});

it.each([
  { initialPath: '/life', micAllowed: false, reloads: 1 },
  { initialPath: '/', micAllowed: false, reloads: 0 },
  { initialPath: '/life', micAllowed: true, reloads: 0 },
])(
  'recovers an inherited microphone policy only on blocked soft visits: $initialPath, allowed=$micAllowed',
  ({ initialPath, micAllowed, reloads }) => {
    state.context = null;
    const reload = vi.fn();
    const original = window;
    const documentWindow = Object.create(original);
    Object.defineProperties(documentWindow, {
      top: { value: documentWindow },
      location: { value: { pathname: '/', reload } },
      SpeechRecognition: { value: class {} },
    });
    vi.stubGlobal('window', documentWindow);
    vi.stubGlobal(
      'performance',
      Object.assign(Object.create(performance), {
        getEntriesByType: () => [{ name: 'https://campus.test' + initialPath }],
      }),
    );
    Object.defineProperty(document, 'permissionsPolicy', {
      configurable: true,
      value: {
        allowsFeature: (name: string) => name === 'microphone' && micAllowed,
      },
    });
    try {
      render(entry());
      expect(reload).toHaveBeenCalledTimes(reloads);
    } finally {
      Reflect.deleteProperty(document, 'permissionsPolicy');
    }
  },
);
