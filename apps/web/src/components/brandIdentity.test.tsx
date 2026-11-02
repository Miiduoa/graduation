import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';
import { SiteFooter } from './SiteFooter';

const auth = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string; isPlatformOperator: boolean },
  loading: false,
  pendingLogout: false,
  logout: vi.fn(),
}));
const firebase = vi.hoisted(() => ({
  user: null as { uid: string } | null,
}));

vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('./CampusServiceMenu', () => ({ CampusServiceMenu: () => null }));
vi.mock('./QuickCampusEntry', () => ({ QuickCampusEntry: () => null }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => auth,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: firebase.user, loading: false, signOutUser: vi.fn() }),
}));
vi.mock('@/lib/useClientHydrated', () => ({ useClientHydrated: () => true }));
vi.mock('@/lib/useLocationHash', () => ({ useLocationHash: () => '' }));

beforeEach(() => {
  auth.session = null;
  auth.loading = false;
  auth.pendingLogout = false;
  firebase.user = null;
});

it('shows nuni in the site footer without Campus One', () => {
  const { container } = render(<SiteFooter />);
  expect(screen.getByText('nuni')).toBeTruthy();
  expect(container.textContent).not.toMatch(/Campus One|CampusOne|\bC1\b/);
});

it('shows nuni brand mark and wordmark in the header without Campus One', () => {
  const { container } = render(<AppHeader />);
  const brand = screen.getByRole('link', { name: 'nuni' });
  expect(brand).toBeTruthy();
  expect(brand.textContent).toContain('nuni');
  expect(container.textContent).not.toMatch(/Campus One|CampusOne/);
  const mark = brand.querySelector('img');
  expect(mark?.getAttribute('src')).toBe('/icons/mark.svg');
});

it('shows nuni mark and wordmark in the site footer', () => {
  const { container } = render(<SiteFooter />);
  expect(screen.getByText('nuni')).toBeTruthy();
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/icons/mark.svg');
  expect(container.textContent).not.toMatch(/Agent/);
});

it('publishes nuni in web app manifest name fields', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8'),
  ) as { name: string; short_name: string };
  expect(manifest.name).toBe('nuni');
  expect(manifest.short_name).toBe('nuni');
  expect(JSON.stringify(manifest)).not.toMatch(/Campus One|CampusOne/);
});

it('publishes nuni in root layout metadata and open graph', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
  expect(source).toContain("applicationName: 'nuni'");
  expect(source).toContain("title: 'nuni｜課程與校園生活'");
  expect(source).toContain("siteName: 'nuni'");
  expect(source).toContain("content=\"nuni\"");
  expect(source).not.toMatch(/Campus One|CampusOne/);
});
