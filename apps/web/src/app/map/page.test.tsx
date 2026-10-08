import { act, render, screen } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import MapPage from './page';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('next/dynamic', () => ({
  default: () =>
    function Map({ school, route, focus }: { school: string; route?: string; focus?: string }) {
      return <output aria-label="地圖目的地">{JSON.stringify({ school, route, focus })}</output>;
    },
}));

it('waits for Next route search parameters and passes the requested route and focus to the map', async () => {
  let resolve!: (value: { schoolId: string; route: string; focus: string }) => void;
  const searchParams = new Promise<{ schoolId: string; route: string; focus: string }>((done) => {
    resolve = done;
  });
  await act(async () => {
    render(
      <Suspense fallback={<p>等待網址參數</p>}>
        <MapPage searchParams={searchParams} />
      </Suspense>,
    );
  });
  expect(screen.queryByLabelText('地圖目的地')).toBeNull();
  await act(async () =>
    resolve({ schoolId: 'another-school', route: 'gate,library', focus: 'library' }),
  );
  const destination = JSON.parse(screen.getByLabelText('地圖目的地').textContent || '{}');
  expect(destination).toEqual({ school: 'pu', route: 'gate,library', focus: 'library' });
  const askLink = screen.getByRole('link', { name: '詢問地點 →' });
  const url = new URL(askLink.getAttribute('href') || '', 'https://campus.example');
  expect(url.pathname).toBe('/ai-assistant');
  expect(url.searchParams.get('q')).toContain('校園地點');
  expect(screen.queryByText(/最快路線|AI 校園導航/)).toBeNull();
});

it('handles repeated map search parameters without passing arrays to route parsing', async () => {
  const searchParams = Promise.resolve({
    route: ['gate,library', 'ignored'],
    focus: ['library', 'ignored'],
  });
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <MapPage searchParams={searchParams} />
      </Suspense>,
    );
  });
  expect(JSON.parse(screen.getByLabelText('地圖目的地').textContent || '{}')).toEqual({
    school: 'pu',
    route: 'gate,library',
    focus: 'library',
  });
});
