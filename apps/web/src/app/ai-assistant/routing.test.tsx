import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import AssistantPage, { dynamic } from './page';
vi.mock('./LegacyAssistant', () => ({ default: () => <div>Legacy entry</div> }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false, session: { context: 'session-a' } }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: 'pu' }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
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
      } else {
        expect(screen.getByText('Legacy entry')).toBeTruthy();
        expect(fetch).not.toHaveBeenCalled();
      }
    });
  }
}
