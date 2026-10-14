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
    myLocation,
  }: {
    locations: MapLocation[];
    selected: MapLocation | null;
    route: MapLocation[] | null;
    myLocation?: { lat: number; lng: number } | null;
  }) => (
    <output aria-label="地圖狀態">{JSON.stringify({ locations, selected, route, myLocation })}</output>
  ),
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
  window.history.replaceState({}, '', '/map');
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

it('never points an empty non-Providence map back to Providence', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="remote-university-12" />);
  expect(await screen.findByText('目前沒有可顯示的校園地點')).toBeTruthy();
  expect(screen.getByText(/不會改用其他學校的建築或導航位置/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '開啟靜宜大學網站' })).toBeNull();
  expect(loadMapLocations).toHaveBeenCalledWith('remote-university-12');
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
  expect(screen.getByRole('link', { name: '連線學校帳號以收藏' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '收藏蓋夏圖書館' })).toBeNull();
  fireEvent.change(input, { target: { value: '不存在' } });
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋條件' }));
  expect(screen.getByRole('button', { name: '查看正門' })).toBeTruthy();
});

it('uses an explicit school flow for legacy favorites while keeping public navigation available', async () => {
  state.user = null;
  window.history.replaceState({}, '', '/map?schoolId=pu&route=gate%2Clibrary#directions');
  render(<MapClient school="pu" route="gate,library" focus="gate" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看蓋夏圖書館' }));
  const login = new URL(
    screen.getByRole('link', { name: '連線學校帳號以收藏' }).getAttribute('href')!,
    window.location.origin,
  );
  expect(login.pathname).toBe('/login');
  expect(login.searchParams.get('reconnect')).toBe('school');
  expect(login.searchParams.get('returnUrl')).toBe(
    '/map?schoolId=pu&route=gate%2Clibrary&focus=library#directions',
  );
  expect(screen.getByText('地圖與導航不需登入；收藏尚未支援 Google 帳號。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '從目前位置導航' })).toBeTruthy();
  expect(loadMapFavorites).not.toHaveBeenCalled();
  expect(setMapFavorite).not.toHaveBeenCalled();
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


it('opens an explicitly labeled map search for the selected university when POIs are unavailable', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="nthu" schoolName="國立清華大學" />);
  expect(await screen.findByText('目前沒有可顯示的校園地點')).toBeTruthy();
  const link = screen.getByRole('link', { name: '在 Google 地圖搜尋國立清華大學 ↗' });
  const url = new URL(link.getAttribute('href')!);
  expect(url.hostname).toBe('www.google.com');
  expect(url.pathname).toBe('/maps/search/');
  expect(url.searchParams.get('query')).toBe('國立清華大學 校園');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(screen.getByText(/第三方地圖搜尋/)).toBeTruthy();
  expect(screen.queryByText('蓋夏圖書館')).toBeNull();
  expect(screen.queryByRole('link', { name: '開啟靜宜大學網站' })).toBeNull();
});

it('does not produce a public map search for an unresolved campus name', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="external-school" schoolName="所選校園（external-school）" />);
  expect(await screen.findByText('目前沒有可顯示的校園地點')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /在 Google 地圖搜尋/ })).toBeNull();
});


it('lets visitors choose a campus starting point and destination without location permission', async () => {
  state.user = null;
  render(<MapClient school="pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看蓋夏圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  expect(screen.getByText(/已設定「蓋夏圖書館」為起點/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為終點' }));
  const route = screen.getByRole('link', { name: '開啟步行導航' });
  const url = new URL(route.getAttribute('href')!);
  expect(url.searchParams.get('origin')).toBe('24.2275,120.5635');
  expect(url.searchParams.get('destination')).toBe('24.22495,120.56535');
  expect(screen.getByText(/兩地直線距離約/)).toBeTruthy();
  const markerState = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(markerState.route.map((entry: MapLocation) => entry.id)).toEqual(['library', 'gate']);
  fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  expect(screen.queryByRole('link', { name: '開啟步行導航' })).toBeNull();
});

it('obtains position only on request and orders nearby locations by measured straight-line distance', async () => {
  state.user = null;
  const far = { ...library, id: 'far', name: '遠方校舍', lat: 24.26, lng: 120.59 };
  vi.mocked(loadMapLocations).mockResolvedValueOnce([library, gate, far]);
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: gate.lat, longitude: gate.lng } } as GeolocationPosition),
  );
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  try {
    render(<MapClient school="pu" />);
    await screen.findByRole('button', { name: '查看遠方校舍' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({
        lat: gate.lat,
        lng: gate.lng,
      }),
    );
    const stateNow = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    expect(stateNow.locations[0].id).toBe('gate');
    expect(screen.getByText(/直線距離由近到遠排序/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '附近 1 公里' }));
    expect(screen.queryByRole('button', { name: '查看遠方校舍' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
  } finally {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  }
});

it('filters favorites without exposing unsaved locations or requiring a map redraw on login', async () => {
  vi.mocked(loadMapFavorites).mockResolvedValueOnce(['library']);
  render(<MapClient school="pu" />);
  const favoriteFilter = await screen.findByRole('button', { name: '只看收藏' });
  await waitFor(() => expect(favoriteFilter.hasAttribute('disabled')).toBe(false));
  fireEvent.click(favoriteFilter);
  expect(screen.queryByRole('button', { name: '查看正門' })).toBeNull();
  expect(screen.getByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
  fireEvent.click(favoriteFilter);
  expect(screen.getByRole('button', { name: '查看正門' })).toBeTruthy();
});

it('does not send geolocation results to another campus after a school switch', async () => {
  state.user = null;
  let resolve!: PositionCallback;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (callback: PositionCallback) => { resolve = callback; } },
  });
  try {
    const view = render(<MapClient school="pu" />);
    await screen.findByRole('button', { name: '查看蓋夏圖書館' });
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    vi.mocked(loadMapLocations).mockResolvedValueOnce([{ ...gate, name: '新校園正門' }]);
    view.rerender(<MapClient school="new-school" />);
    await screen.findByRole('button', { name: '查看新校園正門' });
    act(() => resolve({ coords: { latitude: 24, longitude: 120 } } as GeolocationPosition));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toBeNull();
  } finally {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  }
});

it('searches official POI metadata and shows real floors and facilities without invented hours', async () => {
  state.user = null;
  vi.mocked(loadMapLocations).mockResolvedValueOnce([
    { ...library, building: '任垣樓', floor: '3F', facilities: ['電腦教室', '電梯'] },
    gate,
  ]);
  render(<MapClient school="pu" />);
  const input = await screen.findByRole('searchbox', { name: '搜尋地點' });
  fireEvent.change(input, { target: { value: '電腦教室' } });
  expect(screen.getByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看正門' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  expect(screen.getByText('任垣樓 · 樓層：3F')).toBeTruthy();
  expect(screen.getByText('提供設施：電腦教室、電梯')).toBeTruthy();
  expect(screen.queryByText(/開放中|營業中|預計抵達時間/)).toBeNull();
});

it('ignores a stale position callback after a newer location attempt', async () => {
  state.user = null;
  const callbacks: PositionCallback[] = [];
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (callback: PositionCallback) => { callbacks.push(callback); } },
  });
  try {
    render(<MapClient school="pu" />);
    await screen.findByRole('button', { name: '查看蓋夏圖書館' });
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    act(() => callbacks[0]({ coords: { latitude: library.lat, longitude: library.lng } } as GeolocationPosition));
    fireEvent.click(screen.getByRole('button', { name: '更新我的位置' }));
    act(() => callbacks[0]({ coords: { latitude: 0, longitude: 0 } } as GeolocationPosition));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toBeNull();
    act(() => callbacks[1]({ coords: { latitude: gate.lat, longitude: gate.lng } } as GeolocationPosition));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({
      lat: gate.lat,
      lng: gate.lng,
    });
  } finally {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  }
});
