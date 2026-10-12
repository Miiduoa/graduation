import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssistantPage from './page';
import { callCampusAssistant, type CampusAssistantEnvelope } from '@/lib/campusAssistantClient';

const state = vi.hoisted(() => ({ uid: 'alice' as string | null, query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, error: null }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/lib/campusAssistantClient', async original => ({ ...await original<typeof import('@/lib/campusAssistantClient')>(), callCampusAssistant: vi.fn() }));
vi.mock('./AgentCards', () => ({ AgentCardList: ({ cards }: { cards: Array<{ kind: string }> }) => <div>{cards.map(card => card.kind).join(',')}</div> }));
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); state.uid = 'alice'; state.query = ''; });
function ask(content = '私人課表') {
  fireEvent.change(screen.getByLabelText('你的問題'), { target: { value: content } });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
}

it('requires sign-in and does not send a query from a shared link automatically', () => {
  state.uid = null; state.query = 'q=問題';
  const view = render(<AssistantPage />);
  expect(screen.getByRole('link', { name: '登入' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  state.uid = 'alice'; view.rerender(<AssistantPage />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('問題');
  expect(callCampusAssistant).not.toHaveBeenCalled();
});

it('preserves input on backend failure and retries without inserting a fake answer', async () => {
  vi.mocked(callCampusAssistant).mockRejectedValueOnce({ code: 'functions/unavailable' }).mockResolvedValueOnce({ content: '服務回覆' });
  render(<AssistantPage />); ask();
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('私人課表');
  expect(screen.getByRole('log').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByText('服務回覆');
  expect(callCampusAssistant).toHaveBeenCalledTimes(2);
  expect(vi.mocked(callCampusAssistant).mock.calls[1][0].sessionId).toBe(vi.mocked(callCampusAssistant).mock.calls[0][0].sessionId);
  expect(vi.mocked(callCampusAssistant).mock.calls[1][0].messages).toEqual([{ role: 'user', content: '私人課表' }]);
});

it('prevents concurrent submissions and only displays the acknowledged response', async () => {
  let finish!: (value: CampusAssistantEnvelope) => void;
  vi.mocked(callCampusAssistant).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<AssistantPage />); ask();
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(callCampusAssistant).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('log').textContent).toBe('');
  await act(async () => finish({ content: '真正回覆' }));
  expect(screen.getByText('真正回覆')).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});

it.each(['account', 'course', 'logout'] as const)('clears private conversation and ignores late results after %s changes', async change => {
  let finish!: (value: CampusAssistantEnvelope) => void;
  vi.mocked(callCampusAssistant).mockResolvedValueOnce({ content: 'Alice 舊課程紀錄' }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  state.query = 'courseId=old-course';
  const view = render(<AssistantPage />); ask('先前問題');
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
  if (change !== 'logout') expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});

it('clears an in-flight conversation without admitting its eventual result', async () => {
  let finish!: (value: CampusAssistantEnvelope) => void;
  vi.mocked(callCampusAssistant).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<AssistantPage />); ask();
  fireEvent.click(screen.getByRole('button', { name: '清除對話' }));
  await act(async () => finish({ content: '已清除的回覆' }));
  expect(screen.queryByText('已清除的回覆')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});

it('retains read cards while keeping order writes and claimed receipts out of the dialogue', async () => {
  vi.mocked(callCampusAssistant).mockResolvedValue({ content: '找到餐廳資訊', cards: [
    { kind: 'order_submitted', payload: { orderId: 'unverified' } },
    { kind: 'order_draft_card', payload: {} },
    { kind: 'poi_card', payload: { schoolId: 'pu', pois: [{ id: 'cafeteria', name: '餐廳', schoolId: 'pu' }] } },
  ] });
  render(<AssistantPage />); ask();
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
  vi.mocked(callCampusAssistant).mockResolvedValue({ content: '已整理好訂餐草稿（1 項），按下確認後會送出。', cards: [
    { kind: 'order_draft_card', payload: { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', name: '雞腿飯', price: 100, quantity: 1 }] } },
  ] });
  render(<AssistantPage />); ask('幫我點一份雞腿飯');
  await waitFor(() => expect(screen.getByText('目前還不能線上點餐')).toBeTruthy());
  expect(screen.queryByText(/草稿|確認後會送出/)).toBeNull();
  expect(screen.queryByRole('button', { name: /確認|下單/ })).toBeNull();
  expect(document.querySelector('a[href="/orders"]')).toBeNull();
});

it('when web ordering is turned back on, the order note links to my orders again', async () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  vi.mocked(callCampusAssistant).mockResolvedValue({ content: '找到餐廳資訊', cards: [{ kind: 'order_draft_card', payload: {} }] });
  render(<AssistantPage />); ask();
  await waitFor(() => expect(screen.getByText('找到餐廳資訊')).toBeTruthy());
  expect(screen.getByRole('link', { name: '我的訂單' }).getAttribute('href')).toBe('/orders');
});

it.each(['餐點好了沒', '我的取餐號碼'])('線上點餐還沒開，問「%s」只回「目前還不能線上點餐」，不走後端、也不出現失敗句', async question => {
  vi.mocked(callCampusAssistant).mockRejectedValue({ code: 'functions/unavailable' });
  render(<AssistantPage />);
  expect(screen.queryByText(/訂單請以服務頁面的紀錄為準/)).toBeNull();
  ask(question);
  await waitFor(() => expect(screen.getByText('目前還不能線上點餐')).toBeTruthy());
  expect(callCampusAssistant).not.toHaveBeenCalled();
  expect(screen.queryByText('這次未能取得回覆。你的問題已保留，請稍後重試。')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('線上點餐打開之後，輸入提示會再寫訂單以服務頁面為準', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<AssistantPage />);
  expect(screen.getByText('回覆可能有誤；申請、繳費與訂單請以服務頁面的紀錄為準。')).toBeTruthy();
});
