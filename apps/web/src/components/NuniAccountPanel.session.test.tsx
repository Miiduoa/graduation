import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NuniAccountPanel } from './NuniAccountPanel';
import { NuniSessionProvider } from '@/features/nuni/Session';

const signed = {
  authenticated: true,
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  context: 'a'.repeat(43),
  isPlatformOperator: false,
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

it('waits for the latest session verification before rebuilding an expired membership reader', async () => {
  const explicit = deferred();
  const background = deferred();
  let sessions = 0;
  let memberships = 0;
  const fetcher = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method !== 'GET') throw new Error('Only synthetic GET requests are expected');
    if (url === '/api/nuni/session') {
      sessions += 1;
      if (sessions === 1) return Promise.resolve(response(signed));
      if (sessions === 2) return explicit.promise;
      if (sessions === 3) return background.promise;
      throw new Error('Unexpected session read');
    }
    if (url === '/api/nuni/memberships') {
      memberships += 1;
      return Promise.resolve(
        memberships === 1
          ? response({ error: 'SESSION_CHANGED' }, 409)
          : response({ memberships: [] }),
      );
    }
    if (url === '/api/nuni/class-workspaces') return Promise.resolve(response({ workspaces: [] }));
    if (url === '/api/nuni/merchant-applications')
      return Promise.resolve(response({ applications: [] }));
    if (url === '/api/nuni/merchant-workspaces')
      return Promise.resolve(response({ workspaces: [] }));
    throw new Error(`Unexpected synthetic request: ${String(url)}`);
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <NuniSessionProvider>
      <NuniAccountPanel />
    </NuniSessionProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '重新確認帳號' }));
  expect(sessions).toBe(2);
  fireEvent(window, new Event('pageshow'));
  expect(sessions).toBe(3);
  await act(async () => explicit.resolve(response(signed)));
  const readsBeforeLatestSession = memberships;
  expect(screen.queryByRole('form', { name: '申請學校資格' })).toBeNull();
  await act(async () => background.resolve(response(signed)));
  await screen.findByRole('form', { name: '申請學校資格' });
  expect(fetcher.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  expect({ readsBeforeLatestSession, totalReadsAfterReady: memberships }).toEqual({
    readsBeforeLatestSession: 1,
    totalReadsAfterReady: 2,
  });
});
