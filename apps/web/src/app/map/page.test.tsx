import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import MapPage from './page';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, compactHeading }: { children: ReactNode; compactHeading?: boolean }) => (
    <main data-compact-heading={compactHeading ? 'true' : undefined}>{children}</main>
  ),
}));
vi.mock('next/dynamic', () => ({
  default: () =>
    function Map({ school, route, focus, query }: { school: string; route?: string; focus?: string; query?: string }) {
      return <output aria-label="地圖目的地">{JSON.stringify({ school, route, focus, query })}</output>;
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
  expect(destination).toEqual({
    school: 'another-school',
    route: 'gate,library',
    focus: 'library',
  });
  const askLink = screen.getByRole('link', { name: '詢問地點 →' });
  const url = new URL(askLink.getAttribute('href') || '', 'https://campus.example');
  expect(url.pathname).toBe('/search');
  expect(url.searchParams.get('q')).toContain('地點');
  expect(url.searchParams.get('schoolId')).toBe('another-school');
  expect(screen.queryByText(/最快路線|AI 校園導航/)).toBeNull();
  expect(screen.getByRole('main').getAttribute('data-compact-heading')).toBe('true');
});

it('handles repeated map search parameters without passing arrays to route parsing', async () => {
  const searchParams = Promise.resolve({
    route: ['gate,library', 'ignored'],
    focus: ['library', 'ignored'],
    query: ['主顧303', '另一間不應採用'],
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
    query: '主顧303',
  });
});

it('offers recovery for a temporary availability failure but hides the feature on 404', async () => {
  let attempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ++attempts === 1 ? new Response('', { status: 503 }) : new Response('', { status: 404 }),
    ),
  );
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <MapPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  const retry = await screen.findByRole('button', { name: '重新查詢' });
  expect(screen.getByText('暫時無法確認校園導航服務。')).toBeTruthy();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByText('暫時無法確認校園導航服務。')).toBeNull());
  expect(screen.queryByRole('button', { name: '重新查詢' })).toBeNull();
  expect(attempts).toBe(2);
  vi.unstubAllGlobals();
});
