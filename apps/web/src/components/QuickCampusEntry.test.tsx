import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QuickCampusEntry } from './QuickCampusEntry';
import { interpretCampusRequest } from '@/lib/campusIntentClient';

const state = vi.hoisted(() => ({ uid: 'alice' as string | null }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null }),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => null,
}));
vi.mock('@/lib/campusIntentClient', () => ({
  interpretCampusRequest: vi.fn(),
}));
vi.mock('./VoiceDictationButton', () => ({
  VoiceDictationButton: ({ onTranscript }: { onTranscript: (value: string) => void }) => (
    <button type="button" onClick={() => onTranscript('明天沒課，我想讀書再吃飯')}>
      模擬語音輸入
    </button>
  ),
}));

beforeEach(() => {
  state.uid = 'alice';
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

it('sends the finished voice transcript through AI and renders multiple validated actions', async () => {
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood', source: 'model',
    summary: '想確認空堂，再找地方讀書和吃飯。',
    destinations: ['/timetable', '/library', '/cafeteria'],
    clarifyingQuestion: null,
  });
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  expect(interpretCampusRequest).toHaveBeenCalledWith({
    uid: 'alice', schoolId: '', utterance: '明天沒課，我想讀書再吃飯',
  });
  expect(await screen.findByText('想確認空堂，再找地方讀書和吃飯。')).toBeTruthy();
  expect(screen.getByText('AI 建議先開啟')).toBeTruthy();
  expect(screen.getByRole('link', { name: /課表/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
});

it('keeps manually typed questions private until the user asks for AI interpretation', async () => {
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'clarify', source: 'model',
    summary: '還需要再確認。', destinations: [],
    clarifyingQuestion: '要讀書還是借書？',
  });
  render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), { target: { value: '有點累' } });
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '用 AI 理解這句話' }));
  expect(await screen.findByText('要讀書還是借書？')).toBeTruthy();
});

it('never exposes a previous AI answer after a transcript change or logout', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof interpretCampusRequest>>) => void;
  vi.mocked(interpretCampusRequest).mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), { target: { value: '我要交作業' } });
  await act(async () => resolve({ status: 'understood', source: 'model', summary: '舊的結果', destinations: ['/map'], clarifyingQuestion: null }));
  expect(screen.queryByText('舊的結果')).toBeNull();
  state.uid = null;
  view.rerender(<QuickCampusEntry />);
  expect(screen.queryByText('用 AI 理解這句話')).toBeNull();
  expect(screen.getByText('目前為基本捷徑。登入學校帳號後，可使用 AI 理解較複雜的需求。')).toBeTruthy();
});

it('does not claim AI understanding if the provider is unavailable', async () => {
  vi.mocked(interpretCampusRequest).mockRejectedValue(new Error('offline'));
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  await waitFor(() => expect(screen.getByText(/AI 暫時無法使用/)).toBeTruthy());
  expect(screen.queryByText('AI 建議先開啟')).toBeNull();
});

it.each([false, true])('filters readonly destinations from voice results with enabled=%s', async (enabled) => {
  vi.mocked(interpretCampusRequest).mockResolvedValue(JSON.parse(JSON.stringify({
    status: 'understood', source: 'model', summary: '查看作業',
    destinations: ['/school-lms', '/classroom'], clarifyingQuestion: null,
  })));
  render(<SchoolLmsReadonlyProvider enabled={enabled}><QuickCampusEntry /></SchoolLmsReadonlyProvider>);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  await screen.findByText('查看作業');
  expect(
    Boolean(screen.queryByRole('link', { name: (_, el) => el.getAttribute('href') === '/school-lms' })),
  ).toBe(enabled);
  expect(
    screen.getByRole('link', { name: (_, el) => (el.getAttribute('href') || '').startsWith('/classroom') }).getAttribute('href'),
  ).toContain('/classroom');
});

it('keeps the quick-entry query after returning from a matched service', () => {
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  view.unmount();
  window.history.replaceState({}, '', '/library');
  const away = render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '',
  );
  away.unmount();
  window.history.replaceState({}, '', '/');
  render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
});

it('does not restore the quick-entry query after starting over', () => {
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  view.unmount();
  window.history.replaceState({}, '', '/');
  const home = render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  fireEvent.click(screen.getByRole('button', { name: '重新輸入' }));
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '',
  );
  home.unmount();
  render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '',
  );
});

it('offers semester grades and their preview when the model returns the shared grades destination', async () => {
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood', source: 'model', summary: '查詢學期成績',
    destinations: ['/grades'], clarifyingQuestion: null,
    previews: [{ destination: '/grades', status: 'available', source: 'campus-platform',
      message: '已匯入兩筆成績', items: [{ title: '資料庫', detail: '91 分' }] }],
  });
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  const grades = await screen.findByRole('link', { name: /已匯入兩筆成績/ });
  expect(grades.getAttribute('href')).toBe('/grades?tab=semester');
  expect(grades.textContent).toContain('資料庫 · 91 分');
});
