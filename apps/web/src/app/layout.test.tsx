import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import RootLayout from './layout';

vi.mock('@/components/CampusProviders', () => ({
  CampusProviders: ({ children }: { children: ReactNode }) => (
    <div data-provider="campus-platform">{children}</div>
  ),
}));
vi.mock('@/components/ServiceWorkerRegistration', () => ({
  ServiceWorkerRegistration: () => null,
}));
vi.mock('@/components/AppearancePreferences', () => ({ AppearancePreferences: () => null }));
vi.mock('@/components/AuthGuard', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="campus-auth">{children}</div>
  ),
}));
vi.mock('@/components/ui', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => (
    <div data-provider="toast">{children}</div>
  ),
}));
vi.mock('@/features/nuni/NuniApp', () => ({
  NuniApp: () => {
    throw new Error('A course integration must not replace the full application');
  },
}));

afterEach(() => vi.unstubAllEnvs());

it.each(['nuni', 'firebase', ''])(
  'keeps original route children and Campus One providers with NUNI_CLASSROOM_ENABLED=true and CAMPUS_BACKEND=%s',
  (backend) => {
    vi.stubEnv('CAMPUS_BACKEND', backend);
    vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
    const html = renderToStaticMarkup(
      <RootLayout>
        <main data-route="existing-campus-service">原有校園服務</main>
      </RootLayout>,
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    const child = document.querySelector('[data-route="existing-campus-service"]');
    expect(child?.textContent).toBe('原有校園服務');
    expect(child?.closest('[data-provider="toast"]')).toBeTruthy();
    expect(child?.closest('[data-provider="campus-platform"]')).toBeTruthy();
    expect(child?.closest('[data-provider="campus-auth"]')).toBeTruthy();
    expect(document.documentElement.lang).toBe('zh-Hant');
  },
);
