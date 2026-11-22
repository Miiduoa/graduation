import { directoryStorageFailures, rejectDirectoryStorage } from '@/test/directoryStorageFailures';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { callCampusAssistant } from '@/lib/campusAssistantClient';
import { personalImportsStorageKey, readPersonalImports } from '@/lib/personalImports';
import {
  currentSemesterStartUtc,
  rocSchoolYear,
} from '@campus/shared/src/campusAnnouncementQuality';
import { AssistantEnabledProvider } from './AssistantEnabledProvider';
import { AppHeader } from './AppHeader';
import {
  TodayAssistantDisclosure,
  TodayCampusEntry,
  type TodayAssistantHandle,
} from './TodayCampusEntry';

const state = vi.hoisted(() => ({
  context: 'a'.repeat(43) as string | null,
  accountId: 'session-a',
  school: 'pu',
  uid: null as string | null,
  functionsConfigured: true,
  schoolLoading: false,
  campusLoading: false,
  nuniError: '',
  pendingLogout: false,
  pathname: '/',
  search: 'campus=pu',
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: state.schoolLoading,
    error: null,
  }),
}));
vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('@/features/nuni/Session', () => {
  const session = () => ({
    session: state.context ? { context: state.context, platformAccountId: state.accountId } : null,
    loading: false,
    pendingLogout: state.pendingLogout,
    error: state.nuniError,
  });
  return { useOptionalNuniSession: session, useNuniSession: session };
});
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: state.campusLoading ? null : { id: state.school, name: state.school },
    selectedSchoolId: state.campusLoading ? null : state.school,
    catalogStatus: 'ready',
    loading: state.campusLoading,
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => state.pathname,
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => state.functionsConfigured,
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
  mapRead?: (body: Record<string, unknown>, signal?: AbortSignal | null) => Response | Promise<Response>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      if (url === '/api/nuni/assistant/capability')
        return Promise.resolve(Response.json({ version: 2, enabled: true, ready: true }));
      if (url === '/api/nuni/assistant/ask') return ask(JSON.parse(String(init.body)), init.signal);
      if (url === '/api/nuni/assistant/map-read' && mapRead)
        return mapRead(JSON.parse(String(init.body)), init.signal);
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

function saveTodayLesson(now?: Date): string {
  // Preserve main's deterministic weekday clock for the UI tests while keeping
  // explicit historical instants available to the weekend boundary tests.
  // Only Date is faked: asynchronous React and Testing Library timers stay real.
  if (!now) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T02:30:00.000Z'));
    now = new Date();
  }
  // PU's verified timetable profile accepts Monday–Friday. At Taiwan midnight
  // on weekends, a same-day test lesson would be rejected as damaged storage.
  // Keep the fixture valid and ask for the next teaching day instead.
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = taipei.getUTCDay() || 7;
  const daysAhead = weekday === 6 ? 2 : weekday === 7 ? 1 : 0;
  const lessonDate = new Date(now.getTime() + daysAhead * 86_400_000);
  const lessonWeekday = new Date(lessonDate.getTime() + 8 * 60 * 60 * 1000).getUTCDay() || 7;
  const row = {
    id: 'today-entry-lesson',
    kind: 'timetable',
    title: '入口測試資料庫',
    schoolId: state.school,
    academicYear: String(rocSchoolYear(lessonDate)),
    semester: currentSemesterStartUtc(lessonDate).getUTCMonth() === 7 ? '1' : '2',
    dayOfWeek: lessonWeekday,
    startTime: '10:10',
    endTime: '11:00',
    location: '任垣305',
    batchId: 'entry-fixture',
    importedAt: now.toISOString(),
    source: { type: 'paste', line: 1, rawText: '來源原文不應外送' },
  };
  localStorage.setItem(
    personalImportsStorageKey({ owner: 'platform:' + state.accountId, schoolId: state.school }),
    JSON.stringify({ version: 1, records: [row] }),
  );
  return daysAhead === 2 ? '後天有哪些課？' : daysAhead === 1 ? '明天有哪些課？' : '今天有哪些課？';
}

beforeAll(async () => {
  // Compile the real lazy conversations before user-interaction assertions.
  // Their cold module transform should not consume a DOM query's wait window.
  await Promise.all([
    import('@/features/nuni/Assistant'),
    import('@/app/ai-assistant/LegacyAssistant'),
  ]);
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/?campus=pu');
  Element.prototype.scrollIntoView = vi.fn();
  state.context = 'a'.repeat(43);
  state.accountId = 'session-a';
  state.school = 'pu';
  state.uid = null;
  state.functionsConfigured = true;
  state.schoolLoading = false;
  state.campusLoading = false;
  state.nuniError = '';
  state.pendingLogout = false;
  state.pathname = '/';
  state.search = 'campus=pu';
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('pins the default PU lesson UI fixture to a valid Thursday without faking async timers', () => {
  expect(saveTodayLesson()).toBe('今天有哪些課？');
  expect(new Date().toISOString()).toBe('2026-11-12T02:30:00.000Z');
  const rows = readPersonalImports({ owner: 'platform:' + state.accountId, schoolId: state.school });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
    dayOfWeek: 4,
    title: '入口測試資料庫',
    startTime: '10:10',
    endTime: '11:00',
  });
});

it.each([
  ['Friday', '2026-11-13T17:30:00+08:00', '今天有哪些課？', 5],
  ['Saturday after midnight', '2026-11-14T00:02:00+08:00', '後天有哪些課？', 1],
  ['Sunday before midnight', '2026-11-15T23:59:00+08:00', '明天有哪些課？', 1],
])(
  'keeps %s PU Today lesson fixture readable and correctly dated',
  (_day, instant, question, weekday) => {
    expect(saveTodayLesson(new Date(instant))).toBe(question);
    // Use the production storage reader/validator: an invalid weekend PU
    // fixture must never be mistaken for a broken logged-in user's storage.
    const rows = readPersonalImports({
      owner: 'platform:' + state.accountId,
      schoolId: state.school,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schoolId: 'pu',
      academicYear: '115',
      semester: '1',
      dayOfWeek: weekday,
      title: '入口測試資料庫',
      startTime: '10:10',
      endTime: '11:00',
    });
  },
);

it.each([
  [
    'explanation',
    '資料庫索引',
    '請解釋什麼是資料庫索引？',
    '索引能加快資料查找。',
    '可以舉個例子嗎？',
    '例如先依學號找到資料。',
  ],
  [
    'planning',
    '明天下午讀書',
    '幫我安排明天下午讀書',
    '可以先找明天下午的空檔。',
    '可以排一小時嗎？',
    '我會先核對一小時的空檔。',
  ],
])(
  'accepts a spoken %s question on Today, waits for consent and sends follow-ups in the same conversation',
  async (_kind, spoken, question, firstReply, followup, secondReply) => {
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
      .mockReturnValueOnce(reply(firstReply))
      .mockReturnValueOnce(reply(secondReply));
    mockNuniAsk(ask);
    render(entry());
    // The first conversation imports the full assistant lazily. Parallel suites
    // may compile that module for longer than the default one-second DOM wait.
    const field = await screen.findByRole<HTMLTextAreaElement>(
      'textbox', { name: '問題' }, { timeout: 5000 },
    );
    fireEvent.click(await screen.findByRole('button', { name: '使用語音輸入' }));
    act(() => dictate(spoken));
    expect(field.value).toBe(spoken);
    fireEvent.change(field, { target: { value: question } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(ask).not.toHaveBeenCalled();
    expect(field.value).toBe(question);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
    await screen.findByText(firstReply);
    expect(ask.mock.calls[0][0]).toMatchObject({
      schoolId: 'pu',
      question: question,
      history: [],
      consent: true,
    });
    expect(synthesis.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '朗讀回覆' }));
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({
      text: firstReply,
      voice: deviceVoice,
    });
    fireEvent.change(field, { target: { value: followup } });
    expect(field.value).toBe(followup);
    fireEvent.click(screen.getByRole('button', { name: '停止朗讀', pressed: true }));
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
    await screen.findByText(secondReply);
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(ask.mock.calls[1][0]).toMatchObject({
      conversationId: ask.mock.calls[0][0].conversationId,
      question: followup,
      history: [
        { role: 'user', content: question },
        { role: 'assistant', content: firstReply },
      ],
    });
    expect(window.location.pathname + window.location.search).toBe('/?campus=pu');
  },
);

function saveDeviceTimetable(owner = 'platform:session-a') {
  localStorage.setItem(
    `campus-one-personal-timetable:${owner}:pu`,
    JSON.stringify({
      schoolId: 'pu',
      updatedAt: '2026-11-10T10:00:00.000Z',
      shareWithFriends: false,
      meta: { year: '115', semester: '1' },
      courses: [
        {
          id: 'device-only-course',
          name: '首頁裝置專用課程',
          day: 4,
          start: 1,
          end: 2,
          room: '裝置教室 305',
          teacher: '',
          color: 'blue',
        },
      ],
    }),
  );
}

it.each(['account', 'school'])(
  'answers saved Today data before and after consent, then clears it on %s changes',
  async (scope) => {
    saveDeviceTimetable();
    const ask = vi.fn(() => reply('不應查詢雲端'));
    mockNuniAsk(ask);
    const view = render(entry());
    const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
    fireEvent.change(field, { target: { value: '2026-11-12有什麼課' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText(/08:10–10:00.*首頁裝置專用課程.*裝置教室 305/)).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
    expect(field.value).toBe('');

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(field, { target: { value: '2026-11-12有什麼課' } });
    fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
    expect(await screen.findAllByText(/首頁裝置專用課程/)).toHaveLength(2);
    expect(ask).not.toHaveBeenCalled();

    if (scope === 'school') state.school = 'ncku';
    else { state.context = 'b'.repeat(43); state.accountId = 'session-b'; }
    view.rerender(entry());
    const newField = await screen.findByRole('textbox', { name: '問題' });
    expect(screen.queryByText(/首頁裝置專用課程/)).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
    fireEvent.change(newField, { target: { value: '2026-11-12有什麼課' } });
    fireEvent.keyDown(newField, { key: 'Enter' });
    await screen.findByText(/無法判定當天是否有課/);
    expect(screen.queryByText(/首頁裝置專用課程/)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  },
);

it('queries the cloud after a missing local Today source is resubmitted with consent, without forwarding private read history', async () => {
  const ask = vi
    .fn()
    .mockReturnValueOnce(
      Response.json({
        answer: '下一堂是雲端資料庫，教室主顧 305。',
        dataRead: true,
        steps: [{ name: 'get_schedule', status: 'ok', summary: '已核對同步課表' }],
        cards: [],
      }),
    )
    .mockReturnValueOnce(reply('已讀取校園餐廳資料。'));
  mockNuniAsk(ask);
  render(entry());
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  fireEvent.change(field, { target: { value: '下一堂課是什麼？' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await screen.findByText(/無法判定當天是否有課/);
  expect(field.value).toBe('');
  expect(ask).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '下一堂課是什麼？' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('下一堂是雲端資料庫，教室主顧 305。');
  expect(ask).toHaveBeenCalledOnce();
  expect(ask.mock.calls[0][0]).toMatchObject({
    question: '下一堂課是什麼？',
    consent: true,
    history: [],
    schoolId: 'pu',
  });
  fireEvent.change(field, { target: { value: '附近餐廳有哪些？' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('已讀取校園餐廳資料。');
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1][0]).toMatchObject({ question: '附近餐廳有哪些？', history: [] });
  expect(JSON.stringify(ask.mock.calls[1][0])).not.toContain('雲端資料庫');
});

it.each([false, true])(
  'keeps Today school-account reads on their live school source (device source: %s)',
  async (hasDeviceSource) => {
    state.context = null;
    state.uid = 'alice';
    if (hasDeviceSource) saveDeviceTimetable('school:alice');
    vi.mocked(callCampusAssistant).mockResolvedValue({ content: '校方課表：今天的課在主顧 402。' });
    render(entry(false));
    const field = await screen.findByRole('textbox', { name: '你的問題' });
    fireEvent.change(field, { target: { value: '我今天有什麼課' } });
    fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
    await screen.findByText('校方課表：今天的課在主顧 402。');
    expect(callCampusAssistant).toHaveBeenCalledOnce();
    expect(vi.mocked(callCampusAssistant).mock.calls[0][0]).toMatchObject({
      userId: 'alice',
      schoolId: 'pu',
    });
    expect(screen.queryByText(/首頁裝置專用課程/)).toBeNull();
    expect(screen.queryByText(/無法判定當天是否有課/)).toBeNull();
  },
);

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
    else { state.context = 'b'.repeat(43); state.accountId = 'session-b'; }
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

it('waits for the browsing campus before mounting an input or assistant and focuses once it is ready', async () => {
  state.campusLoading = true;
  const start = vi.fn();
  const ask = vi.fn(() => reply('不應自動送出'));
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      start = start;
      abort = vi.fn();
    },
  );
  mockNuniAsk(ask);
  const content = () => (
    <AssistantEnabledProvider enabled>
      <TodayCampusEntry focusRequest={1} />
    </AssistantEnabledProvider>
  );
  const view = render(content());
  expect(screen.getByText('正在確認瀏覽校園…')).toBeTruthy();
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  state.campusLoading = false;
  view.rerender(content());
  const field = await screen.findByRole('textbox', { name: '問題' });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(start).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('keeps the public-service picker and local question field usable when cloud free-form questions are unavailable', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ enabled: true, ready: true }));
  vi.stubGlobal('fetch', fetch);
  render(entry());
  expect(await screen.findByRole('button', { name: '公車資訊' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '找校園服務' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我想搭公車' } });
  expect(screen.queryByRole('button', { name: '詢問校園助理' })).toBeNull();
  expect(screen.queryByRole('link', { name: '詢問校園助理' })).toBeNull();
  expect(screen.getByRole('textbox', { name: '問題' })).toBeTruthy();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/nuni/assistant/capability']);
});

it.each([
  { initialPath: '/life', currentPath: '/', micAllowed: false },
  { initialPath: '/', currentPath: '/', micAllowed: false },
  { initialPath: '/life', currentPath: '/', micAllowed: true },
  { initialPath: '/library', currentPath: '/calendar', micAllowed: false },
])(
  'opens text without reloading after $initialPath → $currentPath, microphone allowed=$micAllowed',
  ({ initialPath, currentPath, micAllowed }) => {
    state.context = null;
    const reload = vi.fn();
    const original = window;
    const documentWindow = Object.create(original);
    Object.defineProperties(documentWindow, {
      top: { value: documentWindow },
      location: { value: { pathname: currentPath, reload } },
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
      expect(reload).not.toHaveBeenCalled();
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

it('closes the header panel for a same-page answer link opened in the current tab', async () => {
  state.pathname = '/map';
  state.search = 'campus=pu';
  window.history.replaceState({}, '', '/map?campus=pu');
  mockNuniAsk(() => reply(
    '[目前地圖](/map?campus=pu) [其他校園](/map?campus=nthu) [地圖區段](/map?campus=pu#places)',
  ));
  render(<AssistantEnabledProvider enabled><AppHeader /></AssistantEnabledProvider>);
  const trigger = screen.getByRole('button', { name: '開啟校園助理' });
  fireEvent.click(trigger);
  const field = await screen.findByRole('textbox', { name: '問題' }, { timeout: 5000 });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '校園地圖' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  const link = await screen.findByRole('link', { name: '目前地圖' });
  const panel = screen.getByRole('dialog', { name: '校園助理' });
  link.addEventListener('click', (event) => event.preventDefault(), { once: true });
  fireEvent.click(link);
  expect(panel.hidden).toBe(false);
  fireEvent.click(link, { ctrlKey: true });
  expect(panel.hidden).toBe(false);
  link.setAttribute('target', '_blank');
  fireEvent.click(link);
  expect(panel.hidden).toBe(false);
  link.removeAttribute('target');
  link.setAttribute('download', '');
  fireEvent.click(link);
  expect(panel.hidden).toBe(false);
  link.removeAttribute('download');
  for (const name of ['其他校園', '地圖區段']) {
    const other = screen.getByRole('link', { name });
    other.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(other);
    expect(panel.hidden).toBe(false);
  }
  fireEvent.click(link);
  expect(panel.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

it.each(directoryStorageFailures)('closes the header panel on a service click with storage %s', async (failure) => {
  state.pathname = '/map';
  state.search = 'campus=pu';
  window.history.replaceState({}, '', '/map?campus=pu');
  mockNuniAsk(() => reply(''));
  render(<AssistantEnabledProvider enabled><AppHeader /></AssistantEnabledProvider>);
  const trigger = screen.getByRole('button', { name: '開啟校園助理' });
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: '校園助理' });
  fireEvent.click(await within(panel).findByRole('button', { name: '找校園服務' }));
  fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: '借書' } });
  const link = within(panel).getByRole<HTMLAnchorElement>('link', { name: /圖書館/ });
  const storage = rejectDirectoryStorage(failure);
  try {
    expect(fireEvent.click(link)).toBe(true);
    expect(new URL(link.href).pathname).toBe('/library');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  } finally {
    storage.mockRestore();
  }
});

it('keeps a guest Today assistant login in the selected campus and returns to the same disclosure', () => {
  state.context = null;
  state.school = 'nthu';
  state.search = 'campus=nthu';
  window.history.replaceState({}, '', '/?campus=nthu');
  render(entry());
  const link = screen.getByRole('link', { name: '登入後，接著詢問校園助理' });
  const login = new URL(link.getAttribute('href')!, window.location.origin);
  const destination = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
  expect(destination.pathname).toBe('/');
  expect(destination.searchParams.get('schoolId')).toBe('nthu');
  expect(destination.searchParams.get('campus')).toBe('nthu');
  expect(destination.hash).toBe('#today-voice-entry');
  expect(login.searchParams.get('schoolId')).toBe('nthu');
});

it('reopens the Today assistant from a login anchor without sending a question or starting the microphone', async () => {
  const start = vi.fn();
  const ask = vi.fn(() => reply('不應自動送出'));
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      start = start;
      abort = vi.fn();
    },
  );
  mockNuniAsk(ask);
  window.history.replaceState({}, '', '/?campus=pu#today-voice-entry');
  const handle = createRef<TodayAssistantHandle>();
  const onOpenChange = vi.fn();
  render(
    <AssistantEnabledProvider enabled>
      <TodayAssistantDisclosure ref={handle} onOpenChange={onOpenChange} />
    </AssistantEnabledProvider>,
  );
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  const panel = screen.getByText('打字或語音詢問').closest('details')!;
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(panel.open).toBe(true);
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(start).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '先保留這段安排需求' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(panel.open).toBe(false);
  expect(window.location.hash).toBe('');
  act(() => handle.current?.openAssistant());
  expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' })).value).toBe(
    '先保留這段安排需求',
  );
  expect(start).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
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
      return new Promise<Response>((resolve) => {
        finishOld = resolve;
      });
    }
    return reply('交易具有原子性與一致性。');
  });
  mockNuniAsk(ask);
  render(entry());
  const first = await screen.findByRole('button', { name: '下一堂課在哪裡？' });
  fireEvent.click(first);
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  expect(input.value).toBe('下一堂課在哪裡？');
  expect(document.activeElement).toBe(input);
  expect(ask).not.toHaveBeenCalled();
  // Use a general question for the ask bootstrap; map cancellation has its own test.
  fireEvent.change(input, { target: { value: '請解釋資料庫索引？' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  fireEvent.click(await screen.findByRole('button', { name: '停止回答' }));
  expect(firstSignal?.aborted).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: '切換到這個問題' }));
  expect(input.value).toBe('請解釋資料庫索引？');
  expect(input.readOnly).toBe(false);
  fireEvent.change(input, { target: { value: '請解釋資料庫交易的特性？' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('交易具有原子性與一致性。');
  await act(async () =>
    finishOld(Response.json({ bootstrap: true, conversationId: 'stale', routeToken: 'stale' })),
  );
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1][0].history).toEqual([]);
  const settings = screen.getByText('本次對話的資料使用設定').closest('details')!;
  expect(settings.open).toBe(false);
  settings.open = true;
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(input, { target: { value: '還能舉其他例子嗎？' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '送出' }).disabled).toBe(true);
});

it('stops a Today map read, preserves both drafts and ignores its late result after a new question', async () => {
  let finishMap!: (response: Response) => void;
  let mapSignal: AbortSignal | null | undefined;
  const ask = vi.fn<(body: Record<string, unknown>) => Response>(() => reply('交易具有原子性與一致性。'));
  const mapRead = vi.fn((_body: Record<string, unknown>, signal?: AbortSignal | null) => {
    mapSignal = signal;
    return new Promise<Response>((resolve) => { finishMap = resolve; });
  });
  mockNuniAsk(ask, mapRead);
  render(entry());
  fireEvent.click(await screen.findByRole('button', { name: '下一堂課在哪裡？' }));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(mapRead).toHaveBeenCalledOnce());
  expect(mapRead.mock.calls[0][0]).toEqual({
    schoolId: 'pu', conversationId: expect.any(String), task: { kind: 'next-class' },
  });
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  expect(ask).not.toHaveBeenCalled();

  const followup = '請解釋資料庫交易的特性？';
  fireEvent.change(input, { target: { value: followup } });
  fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
  await screen.findByText(/已停止這次地點查詢/);
  expect(mapSignal?.aborted).toBe(true);
  expect(input.value).toBe(followup);
  expect(input.readOnly).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(input.value).toBe('下一堂課在哪裡？');
  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(input.value).toBe(followup);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('交易具有原子性與一致性。');
  await act(async () => finishMap(Response.json({
    version: 2, modelCalls: 0, dataRead: true, answer: '舊地點不應顯示。', cards: [],
    steps: [{ name: 'get_campus_map', status: 'ok', summary: '舊地點來源已核對。' }],
    taskPlan: { version: 1, steps: [{ id: 'map', label: '查校園地點', serviceId: 'map',
      dependsOn: [], status: 'completed', summary: '舊地點來源已核對。', href: '/map?schoolId=pu' }] },
  })));
  expect(screen.queryByText('舊地點不應顯示。')).toBeNull();
  expect(screen.queryByText('舊地點來源已核對。')).toBeNull();
  expect(screen.getByText('交易具有原子性與一致性。')).toBeTruthy();
  expect(mapRead).toHaveBeenCalledOnce();
  expect(ask).toHaveBeenCalledOnce();
  expect(ask.mock.calls[0][0]).toMatchObject({ question: followup, history: [] });
});

it('stops a school query without clearing previous answers or letting the cancelled result appear', async () => {
  state.context = null;
  state.uid = 'alice';
  let finishOld!: (value: { content: string }) => void;
  const ask = vi
    .mocked(callCampusAssistant)
    .mockResolvedValueOnce({ content: '上一題的回答' })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
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

it('answers a saved lesson on Today without cloud consent or an assistant request', async () => {
  const ask = vi.fn(() => reply('不應使用模型回答'));
  mockNuniAsk(ask);
  const lessonQuestion = saveTodayLesson();
  render(entry());
  const field = await screen.findByRole('textbox', { name: '問題' });
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  fireEvent.change(field, { target: { value: lessonQuestion } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(await screen.findByText(/入口測試資料庫/)).toBeTruthy();
  expect(screen.getByText(/10:10–11:00.*任垣305/)).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  expect(ask).not.toHaveBeenCalled();
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it.each([null, 'school-a'])(
  'keeps verified platform reads reachable with cloud and Functions disabled (school user %s)',
  async (uid) => {
    state.uid = uid;
    state.functionsConfigured = false;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const lessonQuestion = saveTodayLesson();
    render(entry(false));
    const field = await screen.findByRole('textbox', { name: '問題' });
    fireEvent.change(field, { target: { value: lessonQuestion } });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByText(/入口測試資料庫/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '你的問題' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(callCampusAssistant).not.toHaveBeenCalled();
  },
);

it('keeps local platform reads available when there is no school account, even if Functions are configured', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(entry(false));
  expect(await screen.findByRole('textbox', { name: '問題' })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves the configured school engine for a dual account when cloud V2 is disabled', async () => {
  state.uid = 'school-a';
  state.functionsConfigured = true;
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(entry(false));
  expect(await screen.findByRole('textbox', { name: '你的問題' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '問題' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('does not wait for an unused school login when a verified platform session has no Functions engine', async () => {
  state.functionsConfigured = false;
  state.schoolLoading = true;
  vi.stubGlobal('fetch', vi.fn());
  render(entry(false));
  expect(await screen.findByRole('textbox', { name: '問題' })).toBeTruthy();
});

it.each(['error', 'logout'])(
  'does not open the local platform conversation with an unresolved session %s',
  async (reason) => {
    state.functionsConfigured = false;
    if (reason === 'error') state.nuniError = 'unverified';
    else state.pendingLogout = true;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(entry(false));
    expect(screen.queryByRole('textbox', { name: '問題' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('aborts an old cloud answer when the feature flag changes while keeping direct reads usable', async () => {
  state.functionsConfigured = false;
  let finish!: (response: Response) => void;
  let pendingSignal: AbortSignal | null | undefined;
  mockNuniAsk((_body, signal) => {
    pendingSignal = signal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const view = render(entry());
  const field = await screen.findByRole('textbox', { name: '問題' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '請解釋資料庫索引？' } });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(pendingSignal).toBeDefined());
  view.rerender(entry(false));
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => finish(reply('不應回流的雲端答案')));
  expect(screen.queryByText('不應回流的雲端答案')).toBeNull();
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  const lessonQuestion = saveTodayLesson();
  fireEvent.change(screen.getByRole('textbox', { name: '問題' }), {
    target: { value: lessonQuestion },
  });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(await screen.findByText(/入口測試資料庫/)).toBeTruthy();
});

it('uses the existing teacher homepage preference only for examples, without adding role authority to requests', async () => {
  const ask = vi.fn().mockReturnValue(reply('授課概況已整理。'));
  mockNuniAsk(ask);
  render(<AssistantEnabledProvider enabled><TodayCampusEntry preferredWorkContext="teacher" /></AssistantEnabledProvider>);
  expect((await screen.findByLabelText('目前處理的工作') as HTMLSelectElement).value).toBe('teacher');
  expect(screen.queryByRole('button', { name: '下一堂課在哪裡？' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查我的授課概況' }));
  expect(ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  await screen.findByText('授課概況已整理。');
  expect(ask.mock.calls[0][0]).toMatchObject({ question: '查我的授課概況', schoolId: 'pu', consent: true });
  expect(ask.mock.calls[0][0]).not.toHaveProperty('role');
  expect(ask.mock.calls[0][0]).not.toHaveProperty('preferredWorkContext');
  expect(ask.mock.calls[0][0]).not.toHaveProperty('isTeacher');
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    '/api/nuni/assistant/capability', '/api/nuni/assistant/ask',
  ]);
});


it('stops a Today map read, preserves both drafts and ignores its late result after a new question', async () => {
  let finishMap!: (response: Response) => void;
  let mapSignal: AbortSignal | null | undefined;
  const ask = vi.fn<(body: Record<string, unknown>) => Response>(() => reply('交易具有原子性與一致性。'));
  const mapRead = vi.fn((_body: Record<string, unknown>, signal?: AbortSignal | null) => {
    mapSignal = signal;
    return new Promise<Response>((resolve) => { finishMap = resolve; });
  });
  mockNuniAsk(ask, mapRead);
  render(entry());
  fireEvent.click(await screen.findByRole('button', { name: '下一堂課在哪裡？' }));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await waitFor(() => expect(mapRead).toHaveBeenCalledOnce());
  expect(mapRead.mock.calls[0][0]).toEqual({
    schoolId: 'pu', conversationId: expect.any(String), task: { kind: 'next-class' },
  });
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  expect(ask).not.toHaveBeenCalled();

  const followup = '請解釋資料庫交易的特性？';
  fireEvent.change(input, { target: { value: followup } });
  fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
  await screen.findByText(/已停止這次地點查詢/);
  expect(mapSignal?.aborted).toBe(true);
  expect(input.value).toBe(followup);
  expect(input.readOnly).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(input.value).toBe('下一堂課在哪裡？');
  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(input.value).toBe(followup);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  await screen.findByText('交易具有原子性與一致性。');
  await act(async () => finishMap(Response.json({
    version: 2, modelCalls: 0, dataRead: true, answer: '舊地點不應顯示。', cards: [],
    steps: [{ name: 'get_campus_map', status: 'ok', summary: '舊地點來源已核對。' }],
    taskPlan: { version: 1, steps: [{ id: 'map', label: '查校園地點', serviceId: 'map',
      dependsOn: [], status: 'completed', summary: '舊地點來源已核對。', href: '/map?schoolId=pu' }] },
  })));
  expect(screen.queryByText('舊地點不應顯示。')).toBeNull();
  expect(screen.queryByText('舊地點來源已核對。')).toBeNull();
  expect(screen.getByText('交易具有原子性與一致性。')).toBeTruthy();
  expect(mapRead).toHaveBeenCalledOnce();
  expect(ask).toHaveBeenCalledOnce();
  expect(ask.mock.calls[0][0]).toMatchObject({ question: followup, history: [] });
});

it.each([true, false].flatMap((sameUrl) =>
  ['mouse', 'Enter', 'Escape'].map((gesture) => ({ sameUrl, gesture })),
))('closes Today and restores focus ($gesture, same URL: $sameUrl)', async ({ sameUrl, gesture }) => {
  const synthesis = installSpeech();
  state.pathname = '/map';
  state.search = 'campus=pu';
  window.history.replaceState({}, '', '/map?campus=pu');
  const destination = sameUrl ? '/map?campus=pu' : '/map?campus=nthu';
  mockNuniAsk(() => reply(`[回覆連結](${destination})`));
  const handle = createRef<TodayAssistantHandle>();
  const onOpenChange = vi.fn();
  render(
    <AssistantEnabledProvider enabled>
      <TodayAssistantDisclosure ref={handle} onOpenChange={onOpenChange} />
    </AssistantEnabledProvider>,
  );
  act(() => handle.current?.openAssistant());
  const field = await screen.findByRole('textbox', { name: '問題' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(field, { target: { value: '目前校園' } });
  fireEvent.click(screen.getByRole('button', { name: /^送出/ }));
  const link = await screen.findByRole<HTMLAnchorElement>('link', { name: '回覆連結' });
  expect(link.href === window.location.href).toBe(sameUrl);
  fireEvent.click(screen.getByRole('button', { name: '朗讀回覆' }));
  expect(synthesis.speak).toHaveBeenCalledOnce();

  fireEvent.click(link, { metaKey: true });
  const panel = link.closest('details')!;
  expect(panel.open).toBe(true);
  expect(synthesis.cancel).not.toHaveBeenCalled();
  if (gesture !== 'mouse') {
    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: gesture });
  }
  if (gesture !== 'Escape') {
    // Emulate the native click that follows Enter in a real browser.
    fireEvent.click(link, { detail: gesture === 'Enter' ? 0 : 1 });
  }
  expect(panel.open).toBe(false);
  expect(document.activeElement).toBe(panel.querySelector('summary'));
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(synthesis.cancel).toHaveBeenCalledOnce();
});
