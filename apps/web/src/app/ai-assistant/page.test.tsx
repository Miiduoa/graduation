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
beforeEach(() => { vi.clearAllMocks(); state.uid = 'alice'; state.query = ''; });
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
  expect(screen.getByRole('link', { name: '餐廳服務' })).toBeTruthy();
});
