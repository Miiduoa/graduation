import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MapClient from './MapClient';
import { loadMapFavorites, loadMapLocations, setMapFavorite, type MapLocation } from './mapService';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  configured: true,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.user, loading: false, error: null }),
}));
vi.mock('@/lib/firebase', () => ({ isFirebaseConfigured: () => state.configured }));
vi.mock('./mapService', async (original) => ({
  ...(await original<typeof import('./mapService')>()),
  loadMapLocations: vi.fn(),
  loadMapFavorites: vi.fn(),
  setMapFavorite: vi.fn(),
}));
vi.mock('./MapCanvas', () => ({
  default: ({
    locations,
    selected,
    route,
  }: {
    locations: MapLocation[];
    selected: MapLocation | null;
    route: MapLocation[] | null;
  }) => <output aria-label="地圖狀態">{JSON.stringify({ locations, selected, route })}</output>,
}));

const library: MapLocation = {
  id: 'library',
  name: '蓋夏圖書館',
  description: '查閱館藏',
  category: '圖書館',
  lat: 24.2275,
  lng: 120.5635,
};
const gate: MapLocation = {
  id: 'gate',
  name: '正門',
  description: '',
  category: '交通',
  lat: 24.22495,
  lng: 120.56535,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { uid: 'alice' };
  state.configured = true;
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate]);
  vi.mocked(loadMapFavorites).mockResolvedValue([]);
  vi.mocked(setMapFavorite).mockResolvedValue(undefined);
});

it('shows a retryable source error without fabricated places or opening hours', async () => {
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('offline'));
  render(<MapClient school="pu" />);
  expect(await screen.findByText('暫時無法取得校園地點')).toBeTruthy();
  expect(screen.queryByLabelText('地圖狀態')).toBeNull();
  expect(screen.queryByText(/工程館|開放中|示範/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新載入地點' }));
  expect(await screen.findByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
});

it('distinguishes a confirmed empty source from an unavailable source', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  expect(await screen.findByText('目前沒有可顯示的校園地點')).toBeTruthy();
  expect(screen.queryByLabelText('地圖狀態')).toBeNull();
  expect(screen.getByRole('link', { name: '開啟靜宜大學網站' }).getAttribute('href')).toBe(
    'https://www.pu.edu.tw/',
  );
});

it('resolves deep links from loaded places and hands walking directions to a real map provider', async () => {
  const loading = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(loading.promise);
  render(<MapClient school="pu" route="gate,library" focus="library" />);
  expect(screen.queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  await act(async () => loading.resolve([library, gate]));
  const destination = new URL(
    screen.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!,
  );
  expect(destination.hostname).toBe('www.google.com');
  expect(destination.searchParams.get('origin')).toBe('24.22495,120.56535');
  expect(destination.searchParams.get('destination')).toBe('24.2275,120.5635');
  expect(destination.searchParams.get('travelmode')).toBe('walking');
  expect(screen.queryByText(/分鐘|AI 規劃路線|開放中/)).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('library');
  fireEvent.click(screen.getByRole('button', { name: '關閉地點詳情' }));
  expect(screen.queryByRole('region', { name: '地點詳情' })).toBeNull();
});

it('provides keyboard-operable search, categories, selection and reset', async () => {
  state.user = null;
  render(<MapClient school="pu" />);
  const input = await screen.findByRole('searchbox', { name: '搜尋地點' });
  fireEvent.change(input, { target: { value: ' 查閱 ' } });
  expect(
    JSON.parse(screen.getByLabelText('地圖狀態').textContent!).locations.map(
      (p: MapLocation) => p.id,
    ),
  ).toEqual(['library']);
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  expect(screen.getByRole('link', { name: '從目前位置導航' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入後可收藏地點' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '收藏蓋夏圖書館' })).toBeNull();
  fireEvent.change(input, { target: { value: '不存在' } });
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋條件' }));
  expect(screen.getByRole('button', { name: '查看正門' })).toBeTruthy();
});

it('does not mark a failed or uncertain favorite as saved and reloads before retrying', async () => {
  vi.mocked(setMapFavorite).mockRejectedValueOnce(new Error('connection lost'));
  render(<MapClient school="pu" />);
  const favorite = await screen.findByRole('button', { name: '收藏蓋夏圖書館' });
  await waitFor(() => expect(favorite.hasAttribute('disabled')).toBe(false));
  fireEvent.click(favorite);
  expect(await screen.findByText('無法確認收藏結果，請重新讀取收藏後再試。')).toBeTruthy();
  expect(screen.queryByText('已收藏')).toBeNull();
  expect(favorite.hasAttribute('disabled')).toBe(true);
  vi.mocked(loadMapFavorites).mockResolvedValueOnce(['library']);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取收藏' }));
  expect(await screen.findByRole('button', { name: '取消收藏蓋夏圖書館' })).toBeTruthy();
});

it('locks duplicate favorite changes and ignores completion after account switch', async () => {
  const operation = deferred<void>();
  vi.mocked(setMapFavorite).mockReturnValueOnce(operation.promise);
  const view = render(<MapClient school="pu" />);
  const favorite = await screen.findByRole('button', { name: '收藏蓋夏圖書館' });
  await waitFor(() => expect(favorite.hasAttribute('disabled')).toBe(false));
  fireEvent.click(favorite);
  fireEvent.click(favorite);
  expect(setMapFavorite).toHaveBeenCalledTimes(1);
  const currentScope = vi.mocked(setMapFavorite).mock.calls[0][4];
  expect(currentScope()).toBe(true);
  state.user = { uid: 'bob' };
  view.rerender(<MapClient school="pu" />);
  expect(currentScope()).toBe(false);
  await act(async () => operation.resolve());
  await screen.findByRole('button', { name: '收藏蓋夏圖書館' });
  expect(screen.queryByText('已收藏「蓋夏圖書館」')).toBeNull();
  expect(loadMapFavorites).toHaveBeenCalledWith('bob', 'pu');
});

it('discards old-school data even when both responses have the same number of places', async () => {
  const old = deferred<MapLocation[]>();
  const next = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<MapClient school="first" />);
  view.rerender(<MapClient school="next" />);
  await act(async () => next.resolve([{ ...gate, name: '另一校正門' }]));
  await act(async () => old.resolve([library]));
  expect(screen.queryByText('蓋夏圖書館')).toBeNull();
  expect(screen.getByRole('button', { name: '查看另一校正門' })).toBeTruthy();
});

it('clears old account favorites synchronously while the next account loads', async () => {
  vi.mocked(loadMapFavorites).mockResolvedValueOnce(['library']);
  const view = render(<MapClient school="pu" />);
  await screen.findByRole('button', { name: '取消收藏蓋夏圖書館' });
  vi.mocked(loadMapFavorites).mockReturnValueOnce(new Promise(() => {}));
  state.user = { uid: 'bob' };
  view.rerender(<MapClient school="pu" />);
  expect(screen.queryByRole('button', { name: '取消收藏蓋夏圖書館' })).toBeNull();
  const favorite = await screen.findByRole('button', { name: '收藏蓋夏圖書館' });
  expect(favorite.hasAttribute('disabled')).toBe(true);
});
