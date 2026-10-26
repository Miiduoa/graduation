import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssistantPage from './page';
import { callCampusAssistant, executeCampusAgentWrite, getCampusAssistantSnapshot, type CampusAssistantEnvelope } from '@/lib/campusAssistantClient';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  query: '',
  functionsConfigured: true,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, error: null }),
}));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ google: false, studentId: false, loading: false, retry: vi.fn() }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => null,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({
    children,
    title,
    schoolName,
  }: {
    children: ReactNode;
    title?: string;
    schoolName?: string;
  }) => (
    <main>
      {schoolName ? <p>{schoolName}</p> : null}
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  ),
}));
vi.mock('@/lib/campusAssistantClient', async (original) => ({
  ...(await original<typeof import('@/lib/campusAssistantClient')>()),
  callCampusAssistant: vi.fn(),
  executeCampusAgentWrite: vi.fn(),
  getCampusAssistantSnapshot: vi.fn(),
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => state.functionsConfigured,
}));
vi.mock('./AgentCards', () => ({
  AgentCardList: ({ cards }: { cards: Array<{ kind: string }> }) => (
    <div>{cards.map((card) => card.kind).join(',')}</div>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  state.uid = 'alice';
  state.query = '';
  state.functionsConfigured = true;
  vi.mocked(getCampusAssistantSnapshot).mockImplementation(async (_userId, schoolId) => ({
    schoolId,
    checkedAt: '2026-10-26T12:00:00.000Z',
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 0, items: [] },
    announcements: { status: 'available', items: [] },
  }));
});
function ask(content = '私人課表') {
  fireEvent.change(screen.getByLabelText('你的問題'), { target: { value: content } });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
}

it('uses the function name in the header instead of a school name before the school account is connected', () => {
  state.uid = null;
  render(<AssistantPage />);
  expect(screen.getByRole('heading', { level: 1, name: '助理' })).toBeTruthy();
  expect(screen.queryByText('靜宜大學')).toBeNull();
});

it('requires sign-in and does not send a query from a shared link automatically', () => {
  state.uid = null;
  state.query = 'q=問題';
  const view = render(<AssistantPage />);
  expect(screen.getByRole('heading', { name: '這個功能還沒接通' })).toBeTruthy();
  expect(screen.getByText('校園資訊可先從地圖、公車和公開公告查。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  state.uid = 'alice';
  view.rerender(<AssistantPage />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('問題');
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('preserves input on backend failure and retries without inserting a fake answer', async () => {
  vi.mocked(callCampusAssistant)
    .mockRejectedValueOnce({ code: 'functions/unavailable' })
    .mockResolvedValueOnce({ content: '服務回覆' });
  render(<AssistantPage />);
  ask();
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('私人課表');
  expect(screen.getByRole('log').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByText('服務回覆');
  expect(callCampusAssistant).toHaveBeenCalledTimes(2);
  expect(vi.mocked(callCampusAssistant).mock.calls[1][0].sessionId).toBe(
    vi.mocked(callCampusAssistant).mock.calls[0][0].sessionId,
  );
  expect(vi.mocked(callCampusAssistant).mock.calls[1][0].messages).toEqual([
    { role: 'user', content: '私人課表' },
  ]);
});

it('prevents concurrent submissions and only displays the acknowledged response', async () => {
  let finish!: (value: CampusAssistantEnvelope) => void;
  vi.mocked(callCampusAssistant).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AssistantPage />);
  ask();
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(callCampusAssistant).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('log').textContent).toBe('');
  await act(async () => finish({ content: '真正回覆' }));
  expect(screen.getByText('真正回覆')).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});

it.each(['account', 'course', 'logout'] as const)(
  'clears private conversation and ignores late results after %s changes',
  async (change) => {
    let finish!: (value: CampusAssistantEnvelope) => void;
    vi.mocked(callCampusAssistant)
      .mockResolvedValueOnce({ content: 'Alice 舊課程紀錄' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    state.query = 'courseId=old-course';
    const view = render(<AssistantPage />);
    ask('先前問題');
    await screen.findByText('Alice 舊課程紀錄');
    ask('新問題');
    const signal = vi.mocked(callCampusAssistant).mock.calls[1][1];
    if (change === 'account') state.uid = 'bob';
    if (change === 'course') state.query = 'courseId=new-course';
    if (change === 'logout') state.uid = null;
    view.rerender(<AssistantPage />);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText('Alice 舊課程紀錄')).toBeNull();
    await act(async () => finish({ content: 'Alice 晚到私人回覆' }));
    expect(screen.queryByText('Alice 晚到私人回覆')).toBeNull();
    if (change !== 'logout')
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  },
);

it('clears an in-flight conversation without admitting its eventual result', async () => {
  let finish!: (value: CampusAssistantEnvelope) => void;
  vi.mocked(callCampusAssistant).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AssistantPage />);
  ask();
  fireEvent.click(screen.getByRole('button', { name: '清除對話' }));
  await act(async () => finish({ content: '已清除的回覆' }));
  expect(screen.queryByText('已清除的回覆')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});

it('retains read cards while keeping order writes and claimed receipts out of the dialogue', async () => {
  vi.mocked(callCampusAssistant).mockResolvedValue({
    content: '找到餐廳資訊',
    cards: [
      { kind: 'order_submitted', payload: { orderId: 'unverified' } },
      { kind: 'order_draft_card', payload: {} },
      {
        kind: 'poi_card',
        payload: { schoolId: 'pu', pois: [{ id: 'cafeteria', name: '餐廳', schoolId: 'pu' }] },
      },
    ],
  });
  render(<AssistantPage />);
  ask();
  await waitFor(() => expect(screen.getByText('poi_card')).toBeTruthy());
  expect(screen.queryByText(/order_draft_card|order_submitted/)).toBeNull();
  // 線上點餐還沒開：只回「目前還不能線上點餐」，不帶去我的訂單或餐廳頁
  expect(screen.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(screen.queryByText('找到餐廳資訊')).toBeNull();
  expect(screen.queryByRole('link', { name: '餐廳服務' })).toBeNull();
  expect(screen.queryByRole('link', { name: '我的訂單' })).toBeNull();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
});

it('asked to order chicken rice, the web assistant replies only that online ordering is not open', async () => {
  vi.mocked(callCampusAssistant).mockResolvedValue({
    content: '已整理好訂餐草稿（1 項），按下確認後會送出。',
    cards: [
      {
        kind: 'order_draft_card',
        payload: {
          cafeteriaId: 'cafe',
          items: [{ menuItemId: 'rice', name: '雞腿飯', price: 100, quantity: 1 }],
        },
      },
    ],
  });
  render(<AssistantPage />);
  ask('幫我點一份雞腿飯');
  await waitFor(() => expect(screen.getByText('目前還不能線上點餐')).toBeTruthy());
  expect(screen.queryByText(/草稿|確認後會送出/)).toBeNull();
  expect(screen.queryByRole('button', { name: /確認|下單/ })).toBeNull();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
});

it('when web ordering is turned back on, the order note links to my orders again', async () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  vi.mocked(callCampusAssistant).mockResolvedValue({
    content: '找到餐廳資訊',
    cards: [{ kind: 'order_draft_card', payload: {} }],
  });
  render(<AssistantPage />);
  ask();
  await waitFor(() => expect(screen.getByText('找到餐廳資訊')).toBeTruthy());
  expect(screen.getByRole('link', { name: '我的訂單' }).getAttribute('href')).toBe('/orders');
});

it.each(['餐點好了沒', '我的取餐號碼'])(
  '線上點餐還沒開，問「%s」只回「目前還不能線上點餐」，不走後端、也不出現失敗句',
  async (question) => {
    vi.mocked(callCampusAssistant).mockRejectedValue({ code: 'functions/unavailable' });
    render(<AssistantPage />);
    expect(screen.queryByText(/訂單請以服務頁面的紀錄為準/)).toBeNull();
    ask(question);
    await waitFor(() => expect(screen.getByText('目前還不能線上點餐')).toBeTruthy());
    expect(callCampusAssistant).not.toHaveBeenCalled();
    expect(screen.queryByText('這次未能取得回覆。你的問題已保留，請稍後重試。')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('線上點餐打開之後，輸入提示會再寫訂單以服務頁面為準', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<AssistantPage />);
  expect(screen.getByText('回覆可能有誤；申請、繳費與訂單請以服務頁面的紀錄為準。')).toBeTruthy();
});

it('routes assistant queries to the selected campus rather than the previous school ID', async () => {
  state.query = 'campus=nthu&schoolId=pu';
  vi.mocked(callCampusAssistant).mockResolvedValueOnce({ content: '清華的服務回覆' });
  render(<AssistantPage />);
  ask('圖書館');
  await screen.findByText('清華的服務回覆');
  expect(vi.mocked(callCampusAssistant).mock.calls[0][0].schoolId).toBe('nthu');
});

it('drops the previous campus conversation and cancels pending requests after a switch', async () => {
  state.query = 'campus=pu';
  let resolveOld!: (value: CampusAssistantEnvelope) => void;
  vi.mocked(callCampusAssistant).mockImplementation(
    () => new Promise((resolve) => { resolveOld = resolve; }),
  );
  const view = render(<AssistantPage />);
  ask('舊校課表');
  const signal = vi.mocked(callCampusAssistant).mock.calls[0][1];
  state.query = 'campus=nthu&schoolId=pu';
  view.rerender(<AssistantPage />);
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('log').textContent).toBe('');
  await act(async () => resolveOld({ content: '晚到的靜宜私人資訊' }));
  expect(screen.queryByText('晚到的靜宜私人資訊')).toBeNull();
  vi.mocked(callCampusAssistant).mockResolvedValueOnce({ content: '清華的服務回覆' });
  ask('新校圖書館');
  await screen.findByText('清華的服務回覆');
  expect(vi.mocked(callCampusAssistant).mock.calls[1][0].schoolId).toBe('nthu');
});

it('shows that the cloud assistant is not enabled instead of a retryable failure', () => {
  state.functionsConfigured = false;
  render(<AssistantPage />);
  expect(screen.getByRole('heading', { name: '雲端助理尚未啟用' })).toBeTruthy();
  expect(screen.getByText(/正式站尚未接上雲端函式服務/)).toBeTruthy();
  expect((screen.getByLabelText('你的問題') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('這次未能取得回覆。你的問題已保留，請稍後重試。')).toBeNull();
  expect(screen.queryByRole('button', { name: '重試' })).toBeNull();
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('keeps the composer enabled when Cloud Functions are configured', () => {
  state.functionsConfigured = true;
  render(<AssistantPage />);
  expect(screen.getByRole('heading', { name: '今天需要什麼幫忙？' })).toBeTruthy();
  expect((screen.getByLabelText('你的問題') as HTMLTextAreaElement).disabled).toBe(false);
  expect(screen.queryByText('雲端助理尚未啟用')).toBeNull();
});

it('does not send campus-specific requests before a campus is selected', () => {
  state.query = 'campus=all&schoolId=pu';
  render(<AssistantPage />);
  expect(screen.getByText('請先選擇一所學校，再使用校園助理。')).toBeTruthy();
  expect(screen.queryByRole('form', { name: '傳送問題' })).toBeNull();
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('shows real authorized assignments and does not infer a schedule from missing data', async () => {
  vi.mocked(getCampusAssistantSnapshot).mockResolvedValueOnce({
    schoolId: 'pu',
    checkedAt: '2026-10-26T12:00:00.000Z',
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 1, items: [
      { title: '資料庫期末報告', groupName: '資料庫', dueAt: '2026-10-28T12:00:00.000Z' },
    ] },
    announcements: { status: 'unavailable', items: [] },
  });
  render(<AssistantPage />);
  await screen.findByText('資料庫期末報告');
  expect(screen.getByText(/助理目前無法取得正式課表/)).toBeTruthy();
  expect(screen.getByText('公告來源暫時無法確認')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '整理優先順序' }));
  expect((screen.getByLabelText('你的問題') as HTMLTextAreaElement).value).toContain('待繳作業');
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('requires a second explicit confirmation before executing a validated action', async () => {
  const runId = '01234567-89ab-4cde-8012-3456789abcde';
  vi.mocked(callCampusAssistant).mockResolvedValue({
    content: '請先確認報修內容',
    run: { runId, status: 'completed' },
    actions: [{
      action: 'queue_action',
      label: '確認送出報修',
      requiresConfirmation: true,
      params: {
        toolName: 'createDormRepairRequest',
        agentRunId: runId,
        input: { dormitory: 'A棟', room: '301', category: '冷氣', description: '不冷' },
      },
    }],
  });
  vi.mocked(executeCampusAgentWrite).mockResolvedValue({
    success: true, toolName: 'createDormRepairRequest', repairId: 'repair-123',
  });
  render(<AssistantPage />);
  ask('A棟301冷氣不冷');
  await screen.findByText('請先確認報修內容');
  expect(executeCampusAgentWrite).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '檢視草稿' }));
  expect(screen.getByText('301')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認並執行' }));
  await screen.findByText('伺服器已確認執行成功');
  expect(executeCampusAgentWrite).toHaveBeenCalledTimes(1);
  expect(vi.mocked(executeCampusAgentWrite).mock.calls[0][0]).toMatchObject({
    userId: 'alice', schoolId: 'pu', agentRunId: runId,
    toolName: 'createDormRepairRequest',
  });
  expect(screen.getByText(/repair-123/)).toBeTruthy();
});

it('never offers execution for an action not bound to its server run', async () => {
  vi.mocked(callCampusAssistant).mockResolvedValue({
    content: '草稿',
    run: { runId: '01234567-89ab-4cde-8012-3456789abcde' },
    actions: [{
      action: 'queue_action',
      label: '危險草稿',
      requiresConfirmation: true,
      params: {
        toolName: 'createDormRepairRequest',
        agentRunId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        input: { dormitory: 'A棟', room: '301', category: '冷氣', description: '不冷' },
      },
    }],
  });
  render(<AssistantPage />);
  ask('報修');
  await screen.findByText('草稿');
  expect(screen.queryByRole('button', { name: '檢視草稿' })).toBeNull();
  expect(executeCampusAgentWrite).not.toHaveBeenCalled();
});
