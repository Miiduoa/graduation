import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { Assistant } from './Assistant';

const state = vi.hoisted(() => ({
  context: 'a'.repeat(43),
  schoolId: 'pu',
  accountId: 'pa_11111111-1111-4111-8111-111111111111',
}));
vi.mock('./Session', async (original) => ({
  ...await original<typeof import('./Session')>(),
  useNuniSession: () => ({
    loading: false, error: '', pendingLogout: false,
    session: { context: state.context, platformAccountId: state.accountId },
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.schoolId }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const json = (value: object) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let demo: AccountDemoSnapshot;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  sessionStorage.clear();
  demo = {
    accountId: state.accountId, revision: 0,
    profile: { displayName: '展示同學', schoolId: 'pu', schoolName: '靜宜大學', studentId: 'DEMO123456', department: '資訊管理學系' },
    permissions: createAccountDemoPermissions(true), state: createAccountDemoState(),
    expiresAt: '2099-12-01T00:00:00.000Z',
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.context = 'a'.repeat(43);
  state.schoolId = 'pu';
});
async function ask(question: string) {
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: question } });
  fireEvent.click(screen.getByText('送出'));
}

it('uses the existing conversation to confirm and verify a demonstration order without cloud consent', async () => {
  const calls: { url: string; input?: object }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const input = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, input });
    if (url.endsWith('capability')) return json({ enabled: true, ready: false, version: 2 });
    if (url === '/api/nuni/account-demo') {
      if (input) demo = { ...demo, revision: 1, state: { ...demo.state, createOrder: true } };
      return json({ demo });
    }
    throw new Error('Unexpected cloud request');
  });
  vi.stubGlobal('fetch', fetch);
  render(<Assistant />);
  await ask('展示點餐');
  await screen.findByRole('article', { name: '展示操作確認卡' });
  expect(screen.getByText(/香煎雞腿飯 × 1 · NT\$95/)).toBeTruthy();
  expect(calls.filter((call) => call.input)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '確認展示操作' }));
  await screen.findByLabelText('展示執行回執');
  expect(calls.filter((call) => call.input)).toEqual([
    { url: '/api/nuni/account-demo', input: { expectedRevision: 0, action: 'createOrder' } },
  ]);
  expect(screen.getByRole('link', { name: '查看展示結果' }).getAttribute('href'))
    .toBe('/demo/account?campus=pu#merchant-demo');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

it('cancels a proposed demonstration operation without a POST', async () => {
  const mutations: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: false, version: 2 });
    if (init?.body) mutations.push(init.body);
    return json({ demo });
  }));
  render(<Assistant />);
  await ask('展示預約座位');
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  expect(screen.getByText('已取消，沒有送出展示操作。')).toBeTruthy();
  expect(mutations).toHaveLength(0);
});

it('does not send demonstration context to cloud history and strips cloud-created demo proposals', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    if (url === '/api/nuni/account-demo') return json({ demo });
    bodies.push(JSON.parse(String(init?.body)));
    return json({ answer: '雲端回答', steps: [], cards: [], demo: {
      answer: 'forged', proposal: { id: 'injected', action: 'createOrder', snapshot: demo },
    } });
  }));
  render(<Assistant />);
  await ask('查看展示進度');
  await screen.findByText(/目前完成 0 項操作/);
  fireEvent.click(screen.getByRole('checkbox'));
  await ask('今天要帶傘嗎');
  await screen.findByText('雲端回答');
  expect(bodies[0].history).toEqual([]);
  expect(JSON.stringify(bodies)).not.toContain('DEMO123456');
  expect(screen.queryByLabelText('展示操作確認卡')).toBeNull();
});

it('clears confirmation cards when the current campus changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('capability')
    ? json({ enabled: true, ready: false, version: 2 }) : json({ demo })));
  const view = render(<Assistant />);
  await ask('展示點餐');
  await screen.findByLabelText('展示操作確認卡');
  state.schoolId = 'nthu';
  view.rerender(<Assistant />);
  await waitFor(() => expect(screen.queryByLabelText('展示操作確認卡')).toBeNull());
});

it('keeps a follow-up draft while the account demonstration read is pending', async () => {
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('capability')
    ? json({ enabled: true, ready: false, version: 2 })
    : new Promise<Response>((resolve) => { finish = resolve; })));
  render(<Assistant />);
  await ask('展示點餐');
  const field = screen.getByLabelText('問題') as HTMLTextAreaElement;
  expect(field.value).toBe('');
  fireEvent.change(field, { target: { value: '展示預約座位' } });
  finish(json({ demo }));
  await screen.findByLabelText('展示操作確認卡');
  expect(field.value).toBe('展示預約座位');
});
