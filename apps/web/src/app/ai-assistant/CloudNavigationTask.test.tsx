import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCloudNavigationPreview, runCloudNavigationTask, type CloudNavigationPreviewResult, type CloudNavigationResult } from '@/lib/cloudNavigationClient';
import { CloudNavigationTask } from './CloudNavigationTask';

vi.mock('@/lib/cloudNavigationClient', () => ({ getCloudNavigationPreview: vi.fn(), runCloudNavigationTask: vi.fn() }));

const QUERY = '從圖書館走到活動中心';
const NAVIGATION_URL = 'https://www.google.com/maps/dir/?api=1&origin=24.226282%2C120.581377&destination=24.227%2C120.582&travelmode=walking';


function previewResult(schoolId = 'pu', query = QUERY): CloudNavigationPreviewResult {
  return {
    status: 'preview', provider: 'groq', model: 'openai/gpt-oss-120b', schoolId, query,
    checkedAt: '2026-11-01T03:04:00.000Z', sourceUpdatedAt: null,
    fingerprint: 'a'.repeat(64), cloudReady: true,
    places: [
      { ref: 'p0', name: '蓋夏圖書館', category: '圖書館', aliases: ['圖書館', '總圖'] },
      { ref: 'p1', name: '學生活動中心', category: '生活', aliases: ['活動中心'] },
    ],
  };
}

function completed(schoolId = 'pu'): CloudNavigationResult {
  return {
    status: 'completed', provider: 'groq', model: 'openai/gpt-oss-120b', schoolId,
    checkedAt: '2026-11-01T03:05:00.000Z', sourceUpdatedAt: null,
    route: {
      from: { id: 'library', name: '蓋夏圖書館', schoolId, lat: 24.226282, lng: 120.581377 },
      to: { id: 'activity', name: '學生活動中心', schoolId, lat: 24.227, lng: 120.582 },
      navigationUrl: NAVIGATION_URL,
    },
  };
}

function incomplete(reason: Exclude<CloudNavigationResult, { status: 'completed' }>['reason']): Exclude<CloudNavigationResult, { status: 'completed' }> {
  return {
    status: reason === 'ambiguous_places' ? 'clarify' : reason === 'source_changed' ? 'stale' : 'unavailable',
    provider: 'groq', schoolId: 'pu', checkedAt: '2026-11-01T03:05:00.000Z', reason,
  };
}

function deferred() {
  let resolve!: (result: CloudNavigationResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CloudNavigationResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function preview(query = QUERY) {
  fireEvent.change(screen.getByLabelText('出發地與目的地'), { target: { value: query } });
  fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
  return await screen.findByRole('region', { name: '雲端查詢預覽' });
}

function consentAndRun() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^(確認規劃|重試規劃)$/ }));
}

beforeEach(() => {
  vi.mocked(runCloudNavigationTask).mockReset();
  vi.mocked(getCloudNavigationPreview).mockReset().mockImplementation(async ({ schoolId, query }) => previewResult(schoolId, query));
});

afterEach(() => vi.useRealTimers());

describe('CloudNavigationTask', () => {
  it('never submits an initial draft or preview without explicit consent and confirmation', async () => {
    vi.mocked(runCloudNavigationTask).mockResolvedValue(completed());
    render(<CloudNavigationTask userId="alice" schoolId="pu" initialDraft={QUERY} />);
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    const panel = await screen.findByRole('region', { name: '雲端查詢預覽' });
    expect(within(panel).getByText(QUERY)).toBeTruthy();
    expect(within(panel).getByText('pu')).toBeTruthy();
    expect(within(panel).getByText('Groq（openai/gpt-oss-120b）')).toBeTruthy();
    expect(within(panel).getByText(/不會附加座標、帳號識別碼、課表、作業或對話紀錄/)).toBeTruthy();
    expect(document.activeElement).toBe(within(panel).getByRole('heading'));
    expect((screen.getByRole('button', { name: '確認規劃' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '確認規劃' }));
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確認規劃' }));
    await screen.findByRole('region', { name: '導航建議' });
    expect(runCloudNavigationTask).toHaveBeenCalledWith({
      userId: 'alice', schoolId: 'pu', query: QUERY, requestId: expect.any(String),
      consent: { provider: 'groq', version: 1, schoolId: 'pu', query: QUERY, fingerprint: 'a'.repeat(64) },
    }, expect.any(AbortSignal));
  });

  it('rejects empty input and overlong initial drafts without truncating or making a call', () => {
    const view = render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    fireEvent.change(screen.getByLabelText('出發地與目的地'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    expect(screen.getByRole('alert').textContent).toContain('請先輸入出發地與目的地');
    expect(document.activeElement).toBe(screen.getByLabelText('出發地與目的地'));
    const longQuery = '館'.repeat(241);
    view.rerender(<CloudNavigationTask userId="bob" schoolId="pu" initialDraft={longQuery} />);
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    expect(screen.getByRole('alert').textContent).toContain('240 字以內');
    expect((screen.getByLabelText('出發地與目的地') as HTMLTextAreaElement).value).toBe(longQuery);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it('locks repeated confirmation while the request is pending and only renders the validated route', async () => {
    const request = deferred();
    vi.mocked(runCloudNavigationTask).mockReturnValue(request.promise);
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    fireEvent.click(screen.getByRole('checkbox'));
    const confirm = screen.getByRole('button', { name: '確認規劃' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    expect(runCloudNavigationTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
    expect(screen.getByRole('region', { name: '本頁任務紀錄' }).getAttribute('aria-busy')).toBe('true');
    await act(async () => request.resolve(completed()));
    const route = screen.getByRole('region', { name: '導航建議' });
    expect(within(route).getByText('蓋夏圖書館')).toBeTruthy();
    expect(within(route).getByText('學生活動中心')).toBeTruthy();
    const link = within(route).getByRole('link', { name: '開啟 Google 地圖步行導航（另開分頁）' });
    expect(link.getAttribute('href')).toBe(NAVIGATION_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(route).getByText('地點來源未提供更新時間；這不是即時路況。')).toBeTruthy();
    expect(within(route).getByText(/2026\/11\/1 11:05/)).toBeTruthy();
    expect(route.textContent).not.toMatch(/已寫入|導航已完成/);
  });

  it('resets consent and plan after any input edit and assigns a new request ID', async () => {
    vi.mocked(runCloudNavigationTask).mockResolvedValue(completed());
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    await screen.findByRole('region', { name: '導航建議' });
    const firstId = vi.mocked(runCloudNavigationTask).mock.calls[0][0].requestId;
    fireEvent.change(screen.getByLabelText('出發地與目的地'), { target: { value: '從活動中心走到圖書館' } });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    await screen.findByRole('region', { name: '雲端查詢預覽' });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(runCloudNavigationTask).toHaveBeenCalledTimes(1);
    consentAndRun();
    await screen.findByRole('region', { name: '導航建議' });
    expect(vi.mocked(runCloudNavigationTask).mock.calls[1][0].requestId).not.toBe(firstId);
  });

  it.each(['account', 'campus'] as const)('clears old consent/results and ignores late responses after %s changes', async (scope) => {
    const request = deferred();
    vi.mocked(runCloudNavigationTask).mockReturnValue(request.promise);
    const view = render(<CloudNavigationTask userId="alice" schoolId="pu" initialDraft={QUERY} />);
    await preview();
    consentAndRun();
    const signal = vi.mocked(runCloudNavigationTask).mock.calls[0][1];
    view.rerender(<CloudNavigationTask userId={scope === 'account' ? 'bob' : 'alice'} schoolId={scope === 'campus' ? 'ntu' : 'pu'} initialDraft={QUERY} />);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('region', { name: '本頁任務紀錄' })).toBeNull();
    await act(async () => request.resolve(completed()));
    expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    await screen.findByRole('region', { name: '雲端查詢預覽' });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(runCloudNavigationTask).toHaveBeenCalledTimes(1);
  });

  it.each(['account', 'campus'] as const)('removes an already usable route on %s changes', async (scope) => {
    vi.mocked(runCloudNavigationTask).mockResolvedValue(completed());
    const view = render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    await screen.findByRole('region', { name: '導航建議' });
    view.rerender(<CloudNavigationTask userId={scope === 'account' ? 'bob' : 'alice'} schoolId={scope === 'campus' ? 'ntu' : 'pu'} />);
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores a canceled request that later %ss while a retry is pending', async (settlement) => {
    const first = deferred();
    const second = deferred();
    vi.mocked(runCloudNavigationTask).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    const firstCall = vi.mocked(runCloudNavigationTask).mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: '取消等待' }));
    expect(firstCall[1]?.aborted).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('不一定能立即中止');
    expect((screen.getByLabelText('出發地與目的地') as HTMLTextAreaElement).value).toBe(QUERY);
    expect(document.activeElement).toBe(screen.getByLabelText('出發地與目的地'));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    consentAndRun();
    expect(vi.mocked(runCloudNavigationTask).mock.calls[1][0].requestId).toBe(firstCall[0].requestId);
    await act(async () => {
      if (settlement === 'resolve') first.resolve(completed());
      else first.reject(new Error('late failure'));
    });
    expect(screen.getByRole('region', { name: '本頁任務紀錄' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '取消等待' })).toBeTruthy();
    await act(async () => second.resolve(completed()));
    expect(screen.getByRole('region', { name: '導航建議' })).toBeTruthy();
  });

  it('invalidates pending work immediately when the query changes', async () => {
    const request = deferred();
    vi.mocked(runCloudNavigationTask).mockReturnValue(request.promise);
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    fireEvent.change(screen.getByLabelText('出發地與目的地'), { target: { value: '新起點與終點' } });
    expect(vi.mocked(runCloudNavigationTask).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => request.resolve(completed()));
    expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('aborts on unmount and does not revive a late result', async () => {
    const request = deferred();
    vi.mocked(runCloudNavigationTask).mockReturnValue(request.promise);
    const view = render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    view.unmount();
    expect(vi.mocked(runCloudNavigationTask).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => request.resolve(completed()));
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
  });

  it('keeps the draft and request ID for a manual retry after transport failure', async () => {
    vi.mocked(runCloudNavigationTask).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completed());
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('出發地與目的地') as HTMLTextAreaElement).value).toBe(QUERY);
    fireEvent.click(screen.getByRole('button', { name: '重試規劃' }));
    await screen.findByRole('region', { name: '導航建議' });
    expect(vi.mocked(runCloudNavigationTask).mock.calls[1][0]).toEqual(vi.mocked(runCloudNavigationTask).mock.calls[0][0]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('honors the provider retry delay without automatically sending another query', async () => {
    vi.mocked(runCloudNavigationTask).mockResolvedValue({ ...incomplete('rate_limited'), retryAfterSeconds: 30 } as CloudNavigationResult);
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    vi.useFakeTimers();
    await act(async () => consentAndRun());
    expect(screen.getByRole('alert').textContent).toContain('目前查詢較多');
    expect((screen.getByRole('button', { name: '重試規劃' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(29_999));
    expect((screen.getByRole('button', { name: '重試規劃' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect((screen.getByRole('button', { name: '重試規劃' }) as HTMLButtonElement).disabled).toBe(false);
    expect(runCloudNavigationTask).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid_response', '未通過檢查'], ['no_places', '沒有可用的公開地點資料'],
    ['ambiguous_places', '補上完整地點名稱'], ['not_configured', '雲端導航尚未啟用'],
    ['source_changed', '地點資料已變更'], ['permission_changed', '權限已變更'],
    ['timeout', '查詢逾時'],
  ] as const)('shows %s without creating a route or claiming a write', async (reason, text) => {
    vi.mocked(runCloudNavigationTask).mockResolvedValue(incomplete(reason));
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(text);
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
    expect(screen.getByRole('region', { name: '本頁任務紀錄' }).textContent).not.toMatch(/已寫入|已完成導航/);
    expect(screen.getByRole('link', { name: '自行開啟校園地圖' }).getAttribute('href')).toBe('/map?campus=pu');
    if (reason === 'source_changed' || reason === 'permission_changed') {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      expect((screen.getByRole('button', { name: '重試規劃' }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('does not display a route returned for another campus', async () => {
    vi.mocked(runCloudNavigationTask).mockResolvedValue(completed('ntu'));
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    expect((await screen.findByRole('alert')).textContent).toContain('校園資料已變更');
    expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
  });

  it('shows the actual public names, categories and aliases before consent without exposing coordinates or account IDs', async () => {
    const data = previewResult();
    if (data.status !== 'preview') throw new Error('fixture must be preview');
    data.places[0] = { ref: 'p0', name: '長名稱'.repeat(26), category: '分類'.repeat(20), aliases: ['別名'.repeat(30), '圖書館'] };
    vi.mocked(getCloudNavigationPreview).mockResolvedValue(data);
    render(<CloudNavigationTask userId="private-account-id" schoolId="pu" />);
    const panel = await preview();
    expect(within(panel).getByText(data.places[0].name)).toBeTruthy();
    expect(within(panel).getByText(`分類：${data.places[0].category}`)).toBeTruthy();
    expect(within(panel).getByText(`別名：${data.places[0].aliases.join('、')}`)).toBeTruthy();
    expect(panel.textContent).not.toContain('private-account-id');
    expect(panel.textContent).not.toContain('24.226282');
    expect(panel.textContent).toContain('本次提供的公開地點（2 處）');
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
    expect(getCloudNavigationPreview).toHaveBeenCalledWith({ userId: 'private-account-id', schoolId: 'pu', query: QUERY }, expect.any(AbortSignal));
  });

  it('permits a public preview when cloud planning is unavailable but disables consent and execution', async () => {
    const data = previewResult();
    if (data.status !== 'preview') throw new Error('fixture must be preview');
    vi.mocked(getCloudNavigationPreview).mockResolvedValue({ ...data, cloudReady: false });
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    expect(screen.getByRole('status').textContent).toContain('目前只能預覽');
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '確認規劃' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '確認規劃' }));
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it('does not offer consent if the public place list is empty', async () => {
    vi.mocked(getCloudNavigationPreview).mockResolvedValue(incomplete('no_places'));
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    fireEvent.change(screen.getByLabelText('出發地與目的地'), { target: { value: QUERY } });
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    expect((await screen.findByRole('alert')).textContent).toContain('沒有可用的公開地點資料');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it('cancels a pending public preview and ignores its late list', async () => {
    let resolve!: (value: CloudNavigationPreviewResult) => void;
    vi.mocked(getCloudNavigationPreview).mockReturnValue(new Promise((finish) => { resolve = finish; }));
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    fireEvent.change(screen.getByLabelText('出發地與目的地'), { target: { value: QUERY } });
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    expect(getCloudNavigationPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('尚未傳送至 Groq');
    fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
    expect(vi.mocked(getCloudNavigationPreview).mock.calls[0][1]?.aborted).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('已停止讀取公開地點');
    await act(async () => resolve(previewResult()));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it.each(['unconfigured', 'session-changed', 'invalid-response'] as const)(
    'explains a client %s error accurately and does not reuse invalid consent', async (code) => {
      vi.mocked(runCloudNavigationTask).mockRejectedValue({ code });
      render(<CloudNavigationTask userId="alice" schoolId="pu" />);
      await preview();
      consentAndRun();
      const alert = await screen.findByRole('alert');
      const expected = { unconfigured: '雲端導航尚未啟用', 'session-changed': '登入狀態已變更', 'invalid-response': '未通過檢查' }[code];
      expect(alert.textContent).toContain(expected);
      expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
      if (code !== 'invalid-response') expect(screen.queryByRole('checkbox')).toBeNull();
    },
  );

  it('requires a new preview and consent when the public source fingerprint changes', async () => {
    vi.mocked(runCloudNavigationTask).mockResolvedValueOnce(incomplete('source_changed')).mockResolvedValueOnce(completed());
    render(<CloudNavigationTask userId="alice" schoolId="pu" />);
    await preview();
    consentAndRun();
    await screen.findByRole('alert');
    const before = vi.mocked(runCloudNavigationTask).mock.calls[0][0];
    const data = previewResult();
    if (data.status !== 'preview') throw new Error('fixture must be preview');
    vi.mocked(getCloudNavigationPreview).mockResolvedValue({ ...data, fingerprint: 'b'.repeat(64) });
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    await screen.findByRole('region', { name: '雲端查詢預覽' });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    consentAndRun();
    await screen.findByRole('region', { name: '導航建議' });
    const after = vi.mocked(runCloudNavigationTask).mock.calls[1][0];
    expect(after.requestId).not.toBe(before.requestId);
    expect(after.consent.fingerprint).toBe('b'.repeat(64));
  });
});
