import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AssistantPage, { dynamic } from './page';
const identity = vi.hoisted(() => ({ loading: false, error: '', pendingLogout: false, platform: true, school: false }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: identity.school ? { uid: 'school-user' } : null, loading: false, error: null }),
}));
vi.mock('./LegacyAssistant', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>Legacy entry{children}</div>,
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ ...identity, session: identity.platform ? { context: 'session-a', platformAccountId: 'alice' } : null }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: 'pu' }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => {
  cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  Object.assign(identity, { loading: false, error: '', pendingLogout: false, platform: true, school: false });
});

it('preserves the school account entry when only the platform infrastructure is enabled', () => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'false');
  identity.platform = false;
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<AssistantPage />);
  expect(screen.getByText(/Legacy entry/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it('retains the school engine for a dual session when platform cloud is disabled', () => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'false');
  identity.school = true;
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<AssistantPage />);
  expect(screen.getByText(/Legacy entry/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['loading', 'error', 'pendingLogout'] as const)('does not change identity while platform %s is unresolved', (field) => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'false');
  identity.platform = false;
  if (field === 'error') identity.error = 'unavailable';
  else identity[field] = true;
  render(<AssistantPage />);
  expect(screen.queryByText(/Legacy entry/)).toBeNull();
  expect(screen.queryByLabelText('問題')).toBeNull();
});
for (const gate of ['off', 'backend', 'classroom']) {
  for (const flag of [undefined, 'false', 'true', 'TRUE']) {
    it(`routes gate=${gate}, assistant=${flag} without capability requests when off`, async () => {
      vi.stubEnv('CAMPUS_BACKEND', gate === 'backend' ? 'nuni' : '');
      vi.stubEnv('NUNI_CLASSROOM_ENABLED', gate === 'classroom' ? 'true' : 'false');
      vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', flag);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ enabled: true, ready: true })));
      vi.stubGlobal('fetch', fetch);
      expect(dynamic).toBe('force-dynamic');
      render(<AssistantPage />);
      if (gate !== 'off' && flag === 'true') {
        expect(screen.queryByText('Legacy entry')).toBeNull();
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        expect(fetch.mock.calls[0]?.[0]).toBe('/api/nuni/assistant/capability');
      } else if (gate === 'off') {
        expect(screen.getByText('Legacy entry')).toBeTruthy();
        expect(fetch).not.toHaveBeenCalled();
      } else {
        expect(screen.queryByText('Legacy entry')).toBeNull();
        expect(screen.getByLabelText('問題')).toBeTruthy();
        expect(fetch).not.toHaveBeenCalled();
      }
    });
  }
}

it.each([
  { platform: true, assistant: true, ordering: true, label: '點餐與取餐' },
  { platform: true, assistant: false, ordering: true, label: '點餐與取餐' },
  { platform: true, assistant: true, ordering: false, label: '查詢訂單與取餐進度' },
  { platform: true, assistant: false, ordering: false, label: '查詢訂單與取餐進度' },
  { platform: false, assistant: true, ordering: true, label: null },
])(
  'offers the available food service with platform=$platform, assistant=$assistant, ordering=$ordering',
  async ({ platform, assistant, ordering, label }) => {
    vi.stubEnv('CAMPUS_BACKEND', platform ? 'nuni' : '');
    vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'false');
    vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', String(assistant));
    vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', String(ordering));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ enabled: true, ready: false }))),
    );
    render(<AssistantPage />);
    if (platform && assistant) await screen.findByText('模型目前無法使用，可直接開啟公開服務入口。');
    if (label) expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/food');
    else expect(screen.queryByRole('link', { name: /點餐|取餐/ })).toBeNull();
  },
);
