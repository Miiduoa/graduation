import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';
import { browserRequest } from './Session';

vi.mock('./Session', () => ({
  browserRequest: vi.fn(),
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: 'a'.repeat(43), platformAccountId: 'alice' } }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: 'pu' }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => {
  vi.mocked(browserRequest).mockReset().mockRejectedValue(new Error('Unexpected direct private reader'));
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  let lock = Promise.resolve<unknown>(undefined);
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_key: string, action: () => unknown) => {
      const next = lock.then(action);
      lock = next.then(() => undefined, () => undefined);
      return next;
    },
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = (value: object) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});

it('routes a standalone work-slot request through the selected role and authenticated assistant after consent', async () => {
  const question = '幫我找明天下午一小時空檔備課';
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/nuni/assistant/capability') return json({ enabled: true, ready: true, version: 2 });
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    if (url !== '/api/nuni/assistant/ask') throw new Error('Unexpected catalog or write request: ' + url);
    return json({ version: 2, answer: '已核對可用的個人備課時段，尚未建立行程。',
      dataRead: true, steps: [{ name: 'find_free_time', status: 'ok', summary: '已核對本人課表與個人行程' }],
      cards: [], modelCalls: 0 });
  }));
  // Keep the actual Assistant, composer, shared routing and consent state. Only
  // account context and network responses use synthetic boundaries.
  await act(async () => { render(<Assistant />); });
  fireEvent.change(await screen.findByLabelText('目前要處理'), { target: { value: 'teacher' } });
  const field = await screen.findByLabelText('問題');
  fireEvent.change(field, { target: { value: question } });
  const submit = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(requests).toEqual([]);

  fireEvent.click(screen.getByRole('checkbox', { name: /同意在本次對話/ }));
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await screen.findByText('已核對可用的個人備課時段，尚未建立行程。');
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ url: '/api/nuni/assistant/ask', body: {
    question, taskProfile: 'teacher', consent: true, schoolId: 'pu', history: [],
  } });
  expect(browserRequest).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(screen.queryByText(/請提供一個課名/)).toBeNull();
});
