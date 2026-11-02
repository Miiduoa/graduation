import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { interpretCampusRequest, type CampusIntentResult } from '@/lib/campusIntentClient';
import { CampusIntentControl } from './CampusIntentControl';
vi.mock('@/lib/campusIntentClient', () => ({ interpretCampusRequest: vi.fn() }));
const QUERY = '找地方讀書再吃飯';
const result: CampusIntentResult = {
  status: 'understood',
  source: 'model',
  summary: '找讀書空間與餐廳',
  destinations: ['/library', '/cafeteria'],
  clarifyingQuestion: null,
  previews: [],
  checkedAt: '2026-11-01T16:30:00.000Z',
};
function props() {
  return {
    uid: 'alice',
    schoolId: 'pu',
    utterance: QUERY,
    onResult: vi.fn(),
    onReset: vi.fn(),
    onReview: vi.fn(),
  };
}
function deferred() {
  let resolve!: (value: CampusIntentResult) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<CampusIntentResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function review() {
  fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
}
function confirm() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '確認並找入口' }));
}
beforeEach(() => {
  vi.mocked(interpretCampusRequest).mockReset().mockResolvedValue(result);
});
afterEach(() => vi.useRealTimers());

it('shows exact fields and provider locally before a distinct consent and submit action', async () => {
  const p = props();
  render(<CampusIntentControl {...p} utterance={`  ${QUERY}  `} />);
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  review();
  const panel = screen.getByRole('region', { name: '確認傳送內容' });
  expect(within(panel).getByText(QUERY)).toBeTruthy();
  expect(within(panel).getByText('pu')).toBeTruthy();
  expect(within(panel).getByText('Groq（openai/gpt-oss-120b）')).toBeTruthy();
  expect(within(panel).getByText(/不附加帳號識別碼、個人資料、課表、作業或對話紀錄/)).toBeTruthy();
  expect(document.activeElement).toBe(within(panel).getByRole('heading'));
  expect(p.onReview).toHaveBeenCalledTimes(1);
  expect(p.onReset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認並找入口' }));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認並找入口' }));
  await screen.findByText('已取得服務入口建議，請自行開啟要使用的服務。');
  expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  expect(interpretCampusRequest).toHaveBeenCalledWith({
    uid: 'alice',
    schoolId: 'pu',
    utterance: QUERY,
    requestId: expect.any(String),
    consent: {
      version: 1,
      purpose: 'campus-service-entry',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      schoolId: 'pu',
      utterance: QUERY,
    },
    signal: expect.any(AbortSignal),
  });
  expect(p.onResult).toHaveBeenCalledWith(result);
  expect(screen.getByText(/本站處理時間/).textContent).toContain('這不是服務資料的更新時間');
});
it('canceling a preview revokes consent and restores focus without sending', () => {
  const p = props();
  render(<CampusIntentControl {...p} />);
  review();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(p.onReset).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '查看傳送內容' }));
  review();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});
it('locks repeated submissions while pending and can stop waiting without adopting a late receipt', async () => {
  const work = deferred();
  vi.mocked(interpretCampusRequest).mockReturnValue(work.promise);
  const p = props();
  render(<CampusIntentControl {...p} />);
  review();
  confirm();
  fireEvent.click(screen.getByRole('button', { name: '正在取得建議…' }));
  expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(interpretCampusRequest).mock.calls[0][0].signal;
  fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
  expect(signal?.aborted).toBe(true);
  expect(p.onReset).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('已送出的伺服器請求可能仍在處理');
  await act(async () => work.resolve(result));
  expect(p.onResult).not.toHaveBeenCalled();
  expect(screen.queryByText('已取得服務入口建議，請自行開啟要使用的服務。')).toBeNull();
});
it('returns keyboard focus to the enabled preview button after stopping a pending request', () => {
  const work = deferred();
  vi.mocked(interpretCampusRequest).mockReturnValue(work.promise);
  render(<CampusIntentControl {...props()} />);
  review();
  confirm();
  const stop = screen.getByRole('button', { name: '停止等待' });
  stop.focus();
  expect(document.activeElement).toBe(stop);
  fireEvent.click(stop);
  const preview = screen.getByRole('button', { name: '查看傳送內容' }) as HTMLButtonElement;
  expect(preview.disabled).toBe(false);
  expect(document.activeElement).toBe(preview);
});
it('ignores late failure after stopping and permits fresh consent', async () => {
  const work = deferred();
  vi.mocked(interpretCampusRequest).mockReturnValue(work.promise);
  const p = props();
  render(<CampusIntentControl {...p} />);
  review();
  confirm();
  fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
  await act(async () => work.reject(new Error('late failure')));
  expect(screen.queryByText(/雲端服務暫時無法回覆/)).toBeNull();
  review();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it.each(['uid', 'schoolId', 'utterance'] as const)(
  'invalidates consent and pending result across %s A→B→A',
  async (key) => {
    const work = deferred();
    vi.mocked(interpretCampusRequest).mockReturnValue(work.promise);
    const p = props();
    const view = render(<CampusIntentControl {...p} />);
    review();
    confirm();
    const changed = {
      ...p,
      [key]: key === 'uid' ? 'bob' : key === 'schoolId' ? 'nthu' : '新的需求',
    };
    view.rerender(<CampusIntentControl {...changed} />);
    view.rerender(<CampusIntentControl {...p} />);
    await act(async () => work.resolve(result));
    expect(p.onResult).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).toBeNull();
    review();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  },
);
it('aborts the wait on unmount', async () => {
  const work = deferred();
  vi.mocked(interpretCampusRequest).mockReturnValue(work.promise);
  const p = props();
  const view = render(<CampusIntentControl {...p} />);
  review();
  confirm();
  const signal = vi.mocked(interpretCampusRequest).mock.calls[0][0].signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => work.resolve(result));
  expect(p.onResult).not.toHaveBeenCalled();
});
it('keeps a manual quota retry on the same ID and never retries automatically', async () => {
  vi.useFakeTimers();
  vi.mocked(interpretCampusRequest).mockResolvedValueOnce({
    ...result,
    status: 'unavailable',
    source: 'fallback',
    summary: '請稍候',
    destinations: [],
    reason: 'rate_limited',
    retryAfterSeconds: 2,
  });
  const p = props();
  render(<CampusIntentControl {...p} />);
  review();
  confirm();
  await act(async () => {
    await Promise.resolve();
  });
  expect(p.onResult).not.toHaveBeenCalled();
  const id = vi.mocked(interpretCampusRequest).mock.calls[0][0].requestId;
  const retry = screen.getByRole('button', { name: '重新傳送' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(retry.disabled).toBe(false);
  expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await act(async () => {
    await Promise.resolve();
  });
  expect(interpretCampusRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(interpretCampusRequest).mock.calls[1][0].requestId).toBe(id);
  expect(p.onResult).toHaveBeenCalledTimes(1);
});

it.each(['review', 'cancel'] as const)('keeps the quota cooldown after %s without silently resending', async (action) => {
  vi.useFakeTimers();
  vi.mocked(interpretCampusRequest).mockResolvedValueOnce({
    ...result, status: 'unavailable', source: 'fallback', destinations: [],
    reason: 'rate_limited', retryAfterSeconds: 2,
  });
  render(<CampusIntentControl {...props()} />);
  review();
  await act(async () => confirm());
  if (action === 'cancel') {
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    review();
  } else {
    fireEvent.click(screen.getByRole('button', { name: '重新確認內容' }));
  }
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox'));
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
});
it.each(['not_configured', 'timeout', 'invalid_response', 'provider_error'] as const)(
  'shows %s failure without declaring success',
  async (reason) => {
    vi.mocked(interpretCampusRequest).mockResolvedValue({
      ...result,
      status: 'unavailable',
      source: 'fallback',
      summary: '不可用',
      destinations: [],
      reason,
    });
    const p = props();
    render(<CampusIntentControl {...p} />);
    review();
    confirm();
    await screen.findByRole('button', { name: '重新傳送' });
    expect(p.onResult).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).not.toContain('已取得');
  },
);
it.each(['permission_changed', 'account_changed'] as const)(
  'revokes consent on %s',
  async (reason) => {
    vi.mocked(interpretCampusRequest).mockResolvedValue({
      ...result,
      status: 'unavailable',
      source: 'fallback',
      summary: '不可用',
      destinations: [],
      reason,
    });
    const p = props();
    render(<CampusIntentControl {...p} />);
    review();
    confirm();
    await screen.findByRole('button', { name: '重新傳送' });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(p.onReset).toHaveBeenCalledTimes(1);
    expect(p.onResult).not.toHaveBeenCalled();
  },
);
it.each([
  { uid: '' },
  { schoolId: '' },
  { schoolId: 'x' },
  { utterance: 'a\nb' },
  { utterance: '文'.repeat(401) },
])('does not offer sending for an invalid scope or draft %#', (patch) => {
  render(<CampusIntentControl {...props()} {...patch} />);
  expect((screen.getByRole('button', { name: '查看傳送內容' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});
it('renders no control for an empty draft and does not reset its parent while rendering', () => {
  const p = props();
  const view = render(<CampusIntentControl {...p} utterance="   " />);
  expect(view.container.textContent).toBe('');
  expect(p.onReset).not.toHaveBeenCalled();
  expect(p.onReview).not.toHaveBeenCalled();
});
it('passes a clarification back without implying a service action completed', async () => {
  const clarify: CampusIntentResult = {
    ...result,
    status: 'clarify',
    summary: '想讀書或借書？',
    destinations: [],
    clarifyingQuestion: '要讀書還是借書？',
  };
  vi.mocked(interpretCampusRequest).mockResolvedValue(clarify);
  const p = props();
  render(<CampusIntentControl {...p} />);
  review();
  confirm();
  await screen.findByText('已取得需要補充的問題，請修改文字後重新確認。');
  expect(p.onResult).toHaveBeenCalledWith(clarify);
  expect(screen.queryByText(/已完成操作/)).toBeNull();
});
