import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BusPage from './page';

const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, schoolName }: { children: React.ReactNode; schoolName?: string }) => (
    <main>
      <p>{schoolName}</p>
      {children}
    </main>
  ),
}));
vi.mock('@/components/TransitExplorer', () => ({
  TransitExplorer: ({ schoolId, legacy }: { schoolId: string; legacy?: React.ReactNode }) => (
    <div>
      <output data-testid="bus-school">{schoolId}</output>
      {legacy}
    </div>
  ),
}));

beforeEach(() => {
  navigation.query = '';
  vi.stubEnv('TDX_CLIENT_ID', undefined);
  vi.stubEnv('TDX_CLIENT_SECRET', undefined);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it('uses campus over a stale schoolId when locating bus stops', () => {
  navigation.query = '?campus=cgu&schoolId=pu';
  render(<BusPage />);
  expect(screen.getByTestId('bus-school').textContent).toBe('cgu');
  expect(screen.getByText('長庚大學')).toBeTruthy();
});

it('keeps a not-yet-integrated university isolated from the previous school', () => {
  navigation.query = '?campus=remote-university-12&schoolId=pu';
  render(<BusPage />);
  expect(screen.getByTestId('bus-school').textContent).toBe('remote-university-12');
  expect(screen.getByText('所選校園尚未接入')).toBeTruthy();
});

it('opens Providence buses when no school has been chosen yet', () => {
  navigation.query = '?campus=all&schoolId=pu';
  render(<BusPage />);
  expect(screen.getByTestId('bus-school').textContent).toBe('pu');
  expect(screen.getByText('靜宜大學')).toBeTruthy();
  expect(screen.queryByText('請先選擇一所學校')).toBeNull();
});

it('keeps the selected campus in the registered-routes deep link', () => {
  navigation.query = '?campus=nthu&schoolId=pu';
  render(<BusPage />);
  const link = screen.getByRole('link', { name: /開啟已登錄的校園路線查詢/ });
  const href = new URL(link.getAttribute('href')!, 'https://campus.example');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('school')).toBe('NTHU');
});

it('keeps official transit access visible even before a campus is selected', () => {
  navigation.query = '?campus=all';
  render(<BusPage />);
  expect(screen.getByRole('heading', { name: '臺中站牌可查詢，班次時間請至官方網站確認' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '臺中市官方公車查詢 ↗' }).getAttribute('href')).toBe('https://citybus.taichung.gov.tw/');
  expect(screen.getByRole('link', { name: '其他縣市與公路客運查詢 ↗' }).getAttribute('href')).toBe('https://www.taiwanbus.tw/');
  expect(screen.getByTestId('bus-school').textContent).toBe('pu');
  expect(screen.queryByText('請先選擇一所學校')).toBeNull();
});

it.each([
  { clientId: 'configured-id', clientSecret: undefined },
  { clientId: undefined, clientSecret: 'configured-secret' },
  { clientId: 'configured-id', clientSecret: 'configured-secret' },
  { clientId: '', clientSecret: '' },
])('does not disguise a configured or partially configured transit provider as an intentional static-catalog mode: %o', ({ clientId, clientSecret }) => {
  vi.stubEnv('TDX_CLIENT_ID', clientId);
  vi.stubEnv('TDX_CLIENT_SECRET', clientSecret);
  render(<BusPage />);
  expect(screen.queryByRole('heading', { name: '臺中站牌可查詢，班次時間請至官方網站確認' })).toBeNull();
  expect(document.body.textContent).not.toContain('configured-secret');
  expect(document.body.textContent).not.toContain('configured-id');
});
