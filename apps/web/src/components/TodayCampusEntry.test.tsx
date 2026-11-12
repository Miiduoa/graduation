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

const deviceVoice = { name: '裝置中文', lang: 'zh-TW', localService: true };
const networkVoice = { name: '雲端中文', lang: 'zh-TW', localService: false };
class TestUtterance {
  voice: typeof deviceVoice | null = null;
  onend?: () => void;
  onerror?: () => void;
  constructor(public text: string) {}
}
function installSpeech() {
  const synthesis = {
    getVoices: vi.fn(() => [networkVoice, { ...deviceVoice, lang: 'zh-CN' }, deviceVoice]),
    speak: vi.fn<(utterance: TestUtterance) => void>(),
    cancel: vi.fn(),
  };
  vi.stubGlobal('SpeechSynthesisUtterance', TestUtterance);
  vi.stubGlobal('speechSynthesis', synthesis);
  return synthesis;
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
  const synthesis = installSpeech();
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
  await screen.findByText(/無法判定當天是否有課/);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '下一堂課是什麼？' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('下一堂是資料庫。');
  expect(ask.mock.calls[0][0]).toMatchObject({
    schoolId: 'pu',
    question: '下一堂課是什麼？',
    history: [],
    consent: true,
  });
  expect(synthesis.speak).not.toHaveBeenCalled();
  const cloudReply = screen.getByText('下一堂是資料庫。').closest('article')!;
  fireEvent.click(cloudReply.querySelector('button')!);
  expect(synthesis.speak).toHaveBeenCalledOnce();
  expect(synthesis.speak.mock.calls[0][0]).toMatchObject({
    text: '下一堂是資料庫。',
    voice: deviceVoice,
  });
  fireEvent.change(field, { target: { value: '在哪裡上課？' } });
  expect(field.value).toBe('在哪裡上課？');
  fireEvent.click(screen.getByRole('button', { name: '停止朗讀', pressed: true }));
  expect(synthesis.cancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('在主顧樓。');
  expect(synthesis.speak).toHaveBeenCalledOnce();
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
  const synthesis = installSpeech();
  synthesis.getVoices.mockReturnValue([networkVoice]);
  state.context = null;
  state.uid = 'alice';
  vi.mocked(callCampusAssistant).mockResolvedValue({ content: '你有兩份作業。' });
  const view = render(entry(false));
  fireEvent.click(await screen.findByRole('button', { name: '找校園服務' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '今天有幾份作業？' } });
  fireEvent.click(screen.getByRole('button', { name: '詢問校園助理' }));
  expect(
    (await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '你的問題' })).value,
  ).toBe('今天有幾份作業？');
  expect(callCampusAssistant).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('你有兩份作業。');
  const play = screen.getByRole('button', { name: '朗讀回覆' });
  expect(synthesis.speak).not.toHaveBeenCalled();
  fireEvent.click(play);
  expect(await screen.findByText(/沒有可用的中文朗讀語音/)).toBeTruthy();
  expect(synthesis.speak).not.toHaveBeenCalled();
  synthesis.getVoices.mockReturnValue([networkVoice, deviceVoice]);
  fireEvent.click(play);
  expect(synthesis.speak.mock.calls[0][0]).toMatchObject({
    text: '你有兩份作業。',
    voice: deviceVoice,
  });
  state.uid = 'bob';
  view.rerender(entry(false));
  expect(synthesis.cancel).toHaveBeenCalledOnce();
  expect(screen.queryByText('你有兩份作業。')).toBeNull();
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

it('keeps the visible answer and follow-up input usable without a speech engine', async () => {
  vi.stubGlobal('speechSynthesis', undefined);
  vi.stubGlobal('SpeechSynthesisUtterance', undefined);
  mockNuniAsk(() => reply('下一堂是資料庫。'));
  render(entry());
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '下一堂課' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('下一堂是資料庫。');
  fireEvent.click(screen.getByRole('button', { name: '朗讀回覆' }));
  expect(screen.getByText(/此瀏覽器不支援朗讀回覆/)).toBeTruthy();
  fireEvent.change(field, { target: { value: '教室在哪裡？' } });
  expect(field.value).toBe('教室在哪裡？');
});

it('stops a spoken reply on a new submission and ignores late speech events on a different turn', async () => {
  const synthesis = installSpeech();
  mockNuniAsk((body) =>
    reply(body.history instanceof Array && body.history.length ? '在主顧樓。' : '下一堂是資料庫。'),
  );
  render(entry());
  const field = await screen.findByRole('textbox', { name: '問題' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '下一堂課' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  fireEvent.click(await screen.findByRole('button', { name: '朗讀回覆' }));
  const staleEnd = synthesis.speak.mock.calls[0][0].onend!;
  fireEvent.change(field, { target: { value: '在哪裡上課？' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  expect(synthesis.cancel).toHaveBeenCalledOnce();
  await screen.findByText('在主顧樓。');
  fireEvent.click(screen.getAllByRole('button', { name: '朗讀回覆' })[1]);
  act(() => staleEnd());
  expect(screen.getByRole('button', { name: '停止朗讀', pressed: true })).toBeTruthy();
  const current = synthesis.speak.mock.calls[1][0];
  expect(current.text).toBe('在主顧樓。');
  act(() => current.onerror?.());
  expect(screen.getByText(/朗讀暫時無法使用/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '朗讀回覆' })[1]);
  fireEvent(window, new Event('pagehide'));
  expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: '停止朗讀' })).toBeNull();
});

it('keeps the draft and ignores a late bootstrap after stopping a question and asking again', async () => {
  let finishOld!: (response: Response) => void;
  let firstSignal: AbortSignal | null | undefined;
  const ask = vi.fn((_body: Record<string, unknown>, signal?: AbortSignal | null) => {
    if (!firstSignal) {
      firstSignal = signal;
      return new Promise<Response>((resolve) => { finishOld = resolve; });
    }
    return reply('這週要交資料庫報告。');
  });
  mockNuniAsk(ask);
  render(entry());
  const first = await screen.findByRole('button', { name: '下一堂課在哪裡？' });
  fireEvent.click(first);
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  expect(input.value).toBe('下一堂課在哪裡？');
  expect(document.activeElement).toBe(input);
  expect(ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止回答' }));
  expect(firstSignal?.aborted).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: '切換到這個問題' }));
  expect(input.value).toBe('下一堂課在哪裡？');
  expect(input.readOnly).toBe(false);
  fireEvent.change(input, { target: { value: '這週有哪些作業？' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('這週要交資料庫報告。');
  await act(async () => finishOld(Response.json({ bootstrap: true, conversationId: 'stale', routeToken: 'stale' })));
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1][0].history).toEqual([]);
  const settings = screen.getByText('本次對話的資料使用設定').closest('details')!;
  expect(settings.open).toBe(false);
  settings.open = true;
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(input, { target: { value: '還有其他作業嗎？' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '送出' }).disabled).toBe(true);
});

it('stops a school query without clearing previous answers or letting the cancelled result appear', async () => {
  state.context = null;
  state.uid = 'alice';
  let finishOld!: (value: { content: string }) => void;
  const ask = vi.mocked(callCampusAssistant)
    .mockResolvedValueOnce({ content: '上一題的回答' })
    .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
  render(entry(false));
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '你的問題' });
  fireEvent.change(field, { target: { value: '問第一題' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('上一題的回答');
  fireEvent.change(field, { target: { value: '問第二題' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止回答' }));
  expect(ask.mock.calls[1][1]?.aborted).toBe(true);
  await act(async () => finishOld({ content: '舊回覆不應顯示' }));
  expect(screen.queryByText('舊回覆不應顯示')).toBeNull();
  expect(field.value).toBe('問第二題');
  expect(screen.getByText('上一題的回答')).toBeTruthy();
});
