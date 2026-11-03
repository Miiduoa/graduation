import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PublicNavigationTask, type PublicTaskPort } from './PublicNavigationTask';
const op = 'pago_11111111-1111-1111-1111-111111111111';
const disclosure = {
  request: { bound: 'request' },
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  dataScope: ['校園', '問題', '公開地點名稱與 ID'],
  sourceDate: '2026-10-19',
  sourceLabel: '測試來源',
  placeCount: 2,
};
const plan = { kind: 'navigation-plan', fromId: 'a', toId: 'b', fromName: '甲樓', toName: '乙館' };
const receipt = {
  kind: 'walking-route',
  from: { id: 'a', name: '甲樓', sourceUrl: 'https://www.openstreetmap.org/way/1' },
  to: { id: 'b', name: '乙館', sourceUrl: 'https://www.openstreetmap.org/way/2' },
  url: 'https://www.google.com/maps/dir/?api=1',
  sourceDate: '2026-10-19',
  sourceLabel: '測試來源',
  mode: 'groq',
};
const done = { status: 'completed', operationId: op, expiresAt: 123, result: { receipt: plan } };
function port(call: PublicTaskPort['call']): PublicTaskPort {
  return { schoolId: 'pu', schoolName: '靜宜', scope: 'account-a', mode: 'groq', call };
}
async function disclose() {
  fireEvent.change(await screen.findByLabelText('起點與終點'), {
    target: { value: '我在甲樓，想去乙館' },
  });
  fireEvent.click(screen.getByRole('button', { name: '檢視傳送內容' }));
  await screen.findByRole('button', { name: '同意傳送並取得建議' });
}
it('requires explicit disclosure consent before model execution and a second consent before route', async () => {
  const call = vi.fn(async (action: string) => {
    if (action === 'status') return null;
    if (action === 'prepareGroq') return disclosure;
    if (action === 'confirm') return { confirmationId: 'pagc_1' };
    if (action === 'execute') return done;
    if (action === 'route') return { operationId: op, receipt };
    throw new Error('unexpected');
  });
  render(<PublicNavigationTask port={port(call)} />);
  await disclose();
  expect(screen.getByText(/模型：openai\/gpt-oss-120b/)).toBeTruthy();
  expect(screen.getByText(/將傳送至 Groq/)).toBeTruthy();
  expect(call.mock.calls.map((c) => c[0])).toEqual(['status', 'prepareGroq']);
  fireEvent.click(screen.getByRole('button', { name: '同意傳送並取得建議' }));
  await screen.findByRole('heading', { name: '請確認建議的地點' });
  expect(screen.getByText('甲樓 → 乙館')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '在 Google 地圖開啟' })).toBeNull();
  expect(call.mock.calls.map((c) => c[0])).toEqual(['status', 'prepareGroq', 'confirm', 'execute']);
  fireEvent.click(screen.getByRole('button', { name: '確認地點並建立步行路線' }));
  await screen.findByRole('link', { name: '在 Google 地圖開啟' });
  expect(call.mock.calls.at(-1)?.[0]).toBe('route');
});
it('cancel before approval does not send model request', async () => {
  const call = vi.fn(async (action: string) => (action === 'status' ? null : disclosure));
  render(<PublicNavigationTask port={port(call)} />);
  await disclose();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(call.mock.calls.map((c) => c[0])).toEqual(['status', 'prepareGroq']);
});
it('provider quota failure remains a terminal operation and requires explicit acknowledgement', async () => {
  const call = vi.fn(async (action: string) => {
    if (action === 'status') return null;
    if (action === 'prepareGroq') return disclosure;
    if (action === 'confirm') return { confirmationId: 'c' };
    if (action === 'execute')
      return {
        status: 'failed',
        operationId: op,
        expiresAt: 123,
        failureCode: 'FREE_QUOTA_UNAVAILABLE',
      };
    throw new Error('unexpected');
  });
  render(<PublicNavigationTask port={port(call)} />);
  await disclose();
  fireEvent.click(screen.getByRole('button', { name: '同意傳送並取得建議' }));
  expect((await screen.findByRole('alert')).textContent).toContain('免費額度');
  expect(screen.queryByRole('button', { name: '同意傳送並取得建議' })).toBeNull();
  expect(screen.getByRole('button', { name: '結案並開始新任務' })).toBeTruthy();
  expect(call.mock.calls.some((c) => c[0] === 'route')).toBe(false);
});
it('late plan from old account is discarded and cannot trigger route', async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn(async (action: string) => {
    if (action === 'status') return null;
    if (action === 'prepareGroq') return disclosure;
    if (action === 'confirm') return { confirmationId: 'c' };
    if (action === 'execute')
      return await new Promise((r) => {
        finish = r;
      });
    throw new Error('unexpected');
  });
  const view = render(<PublicNavigationTask port={port(call)} />);
  await disclose();
  fireEvent.click(screen.getByRole('button', { name: '同意傳送並取得建議' }));
  await waitFor(() => expect(call.mock.calls.some((c) => c[0] === 'execute')).toBe(true));
  view.rerender(<PublicNavigationTask port={{ ...port(call), scope: 'account-b' }} />);
  await act(async () => finish(done));
  expect(screen.queryByRole('button', { name: '確認地點並建立步行路線' })).toBeNull();
  expect(call.mock.calls.some((c) => c[0] === 'route')).toBe(false);
});
it('only describes a proven NOT_DISPATCHED result as not sent and requires closure', async () => {
  const call = vi.fn(async (action: string) => {
    if (action === 'status') return null;
    if (action === 'prepareGroq') return disclosure;
    if (action === 'confirm') return { confirmationId: 'c' };
    if (action === 'execute')
      return { status: 'failed', operationId: op, expiresAt: 123, failureCode: 'NOT_DISPATCHED' };
    throw new Error('unexpected');
  });
  render(<PublicNavigationTask port={port(call)} />);
  await disclose();
  fireEvent.click(screen.getByRole('button', { name: '同意傳送並取得建議' }));
  expect((await screen.findByRole('alert')).textContent).toContain('未送出');
  expect(screen.getByRole('button', { name: '結案並開始新任務' })).toBeTruthy();
});
