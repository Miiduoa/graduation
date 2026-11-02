import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QuickCampusEntry } from './QuickCampusEntry';
import { interpretCampusRequest } from '@/lib/campusIntentClient';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  schoolId: 'pu',
  loading: false,
  callbacks: [] as Array<(value: string) => void>,
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null }),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: state.schoolId ? { id: state.schoolId } : null,
    loading: state.loading,
    catalogStatus: 'ready',
  }),
}));
vi.mock('@/lib/campusIntentClient', () => ({ interpretCampusRequest: vi.fn() }));
vi.mock('./VoiceDictationButton', () => ({
  VoiceDictationButton: ({ onTranscript }: { onTranscript: (value: string) => void }) => {
    state.callbacks.push(onTranscript);
    return (
      <button type="button" onClick={() => onTranscript('明天沒課，我想讀書再吃飯')}>
        模擬語音輸入
      </button>
    );
  },
}));

const result = {
  status: 'understood' as const,
  source: 'model' as const,
  summary: '想確認空堂，再找地方讀書和吃飯。',
  destinations: ['/timetable', '/library', '/cafeteria'] as [
    '/timetable',
    '/library',
    '/cafeteria',
  ],
  clarifyingQuestion: null,
  checkedAt: '2026-11-01T16:30:00.000Z',
};
function confirm() {
  fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我同意將以上文字與校園代碼傳給 Groq' }));
  fireEvent.click(screen.getByRole('button', { name: '確認並找入口' }));
}
beforeEach(() => {
  state.uid = 'alice';
  state.schoolId = 'pu';
  state.loading = false;
  state.callbacks = [];
  vi.clearAllMocks();
  vi.mocked(interpretCampusRequest).mockResolvedValue(result);
});

it('keeps a finished transcript editable and makes no request before data confirmation', async () => {
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  const input = screen.getByRole('searchbox', { name: '想做什麼？' });
  expect((input as HTMLInputElement).value).toBe('明天沒課，我想讀書再吃飯');
  fireEvent.change(input, { target: { value: '先看課表，再去圖書館' } });
  confirm();
  expect(interpretCampusRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      uid: 'alice',
      schoolId: 'pu',
      utterance: '先看課表，再去圖書館',
      consent: expect.objectContaining({
        provider: 'groq',
        schoolId: 'pu',
        utterance: '先看課表，再去圖書館',
      }),
    }),
  );
  expect(await screen.findByText(result.summary)).toBeTruthy();
  expect(screen.getByText('AI 建議先開啟')).toBeTruthy();
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
});

it('keeps examples, basic actions and search usable without cloud confirmation', () => {
  render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '圖書館' } });
  expect(screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')).toContain(
    'schoolId=pu',
  );
  expect(screen.getByRole('link', { name: '搜尋更多服務' }).getAttribute('href')).toContain(
    encodeURIComponent('圖書館'),
  );
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('canceling a preview preserves editable draft but clears consent', () => {
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    '明天沒課，我想讀書再吃飯',
  );
  fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it.each(['account', 'school', 'loading'] as const)(
  'clears draft and ignores delayed results across %s A-B-A',
  async (kind) => {
    let resolve!: (value: typeof result) => void;
    vi.mocked(interpretCampusRequest).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<QuickCampusEntry />);
    fireEvent.click(screen.getByText('模擬語音輸入'));
    const oldVoice = state.callbacks.at(-1)!;
    confirm();
    if (kind === 'account') state.uid = 'bob';
    if (kind === 'school') state.schoolId = 'nthu';
    if (kind === 'loading') state.loading = true;
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    state.uid = 'alice';
    state.schoolId = 'pu';
    state.loading = false;
    view.rerender(<QuickCampusEntry />);
    await act(async () => {
      oldVoice('舊帳號的語音');
      resolve(result);
    });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(result.summary)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  },
);

it('ignores delayed interpretation after a draft edit', async () => {
  let resolve!: (value: typeof result) => void;
  vi.mocked(interpretCampusRequest).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  confirm();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要交作業' } });
  await act(async () => resolve(result));
  expect(screen.queryByText(result.summary)).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('link', { name: /課程空間/ })).toBeTruthy();
});

it.each(['signed-out', 'no-school', 'loading'] as const)(
  'retains voice drafts and basic links when %s',
  (kind) => {
    if (kind === 'signed-out') state.uid = null;
    if (kind === 'no-school') state.schoolId = '';
    if (kind === 'loading') state.loading = true;
    render(<QuickCampusEntry />);
    fireEvent.click(screen.getByText('模擬語音輸入'));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      '明天沒課，我想讀書再吃飯',
    );
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '確認並找入口' })).toBeNull();
    expect(screen.getByRole('link', { name: '搜尋更多服務' })).toBeTruthy();
  },
);

it.each([false, true])('retains school service visibility with enabled=%s', async (enabled) => {
  vi.mocked(interpretCampusRequest).mockResolvedValue(
    JSON.parse(
      JSON.stringify({
        ...result,
        summary: '查看作業',
        destinations: ['/school-lms', '/classroom'],
      }),
    ),
  );
  render(
    <SchoolLmsReadonlyProvider enabled={enabled}>
      <QuickCampusEntry />
    </SchoolLmsReadonlyProvider>,
  );
  fireEvent.click(screen.getByText('模擬語音輸入'));
  confirm();
  await screen.findByText('查看作業');
  expect(Boolean(screen.queryByRole('link', { name: /玩課雲作業與教材/ }))).toBe(enabled);
  expect(screen.getByRole('link', { name: /課程空間/ }).getAttribute('href')).toContain(
    '/classroom',
  );
});

it('keeps quota cooldown across quick-entry draft remounts until a new consented manual retry', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(interpretCampusRequest).mockResolvedValueOnce({
      ...result, status: 'unavailable', source: 'fallback', destinations: [],
      reason: 'rate_limited', retryAfterSeconds: 2,
    });
    render(<QuickCampusEntry />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要借書' } });
    confirm();
    await act(async () => { await Promise.resolve(); });
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    const firstId = vi.mocked(interpretCampusRequest).mock.calls[0][0].requestId;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要找公車' } });
    fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
    const consent = screen.getByRole('checkbox') as HTMLInputElement;
    expect(consent.checked).toBe(false);
    fireEvent.click(consent);
    const submit = screen.getByRole('button', { name: '確認並找入口' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(submit.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(submit.disabled).toBe(false);
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(submit));
    expect(interpretCampusRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(interpretCampusRequest).mock.calls[1][0]).toMatchObject({
      utterance: '我要找公車', consent: { utterance: '我要找公車' },
    });
    expect(vi.mocked(interpretCampusRequest).mock.calls[1][0].requestId).not.toBe(firstId);
  } finally {
    vi.useRealTimers();
  }
});

it('does not retain quota cooldown, drafts or consent across campus A-B-A', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(interpretCampusRequest).mockResolvedValueOnce({
      ...result, status: 'unavailable', source: 'fallback', destinations: [],
      reason: 'rate_limited', retryAfterSeconds: 60,
    });
    const view = render(<QuickCampusEntry />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要借書' } });
    confirm();
    await act(async () => { await Promise.resolve(); });
    state.schoolId = 'nthu';
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('checkbox')).toBeNull();
    state.schoolId = 'pu';
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '新的借閱查詢' } });
    fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    const submit = screen.getByRole('button', { name: '確認並找入口' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(submit));
    expect(interpretCampusRequest).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
