import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MapClient from './MapClient';
import { PROVIDENCE_CAMPUS_PLACES } from './providenceCampus';
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
    schoolName,
    locations,
    selected,
    route,
    myLocation,
  }: {
    schoolName?: string;
    locations: MapLocation[];
    selected: MapLocation | null;
    route: MapLocation[] | null;
    myLocation?: { lat: number; lng: number } | null;
  }) => (
    <output aria-label="地圖狀態">{JSON.stringify({ schoolName, locations, selected, route, myLocation })}</output>
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
/** 靜宜會先顯示內建地點，等校方來源同步完成再操作，避免點到即將被換掉的項目。 */
async function sourceSettled() {
  await waitFor(() => expect(screen.queryByText(/正在同步校方地點資料/)).toBeNull());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A failed test can leave an unconsumed one-shot response; do not leak it into the next case.
  vi.mocked(loadMapLocations).mockReset();
  vi.mocked(loadMapFavorites).mockReset();
  vi.mocked(setMapFavorite).mockReset();
  state.user = { uid: 'alice' };
  state.configured = true;
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate]);
  vi.mocked(loadMapFavorites).mockResolvedValue([]);
  vi.mocked(setMapFavorite).mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/map');
});

it('requires a new spatial choice when a live map source reuses the focused ID', async () => {
  const original = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  const replacement = { ...original, lat: original.lat + 0.002 };
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
  const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value(this: HTMLDialogElement) { this.open = false; },
  });

  const view = render(<MapClient school="pu" focus={original.id} />);
  try {
    fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
    const dialog = within(screen.getByRole('dialog', { name: '校園空間導覽' }));
    const appleDestination = () => new URL(dialog.getByRole('link', {
      name: '開啟 Apple 地圖步行導航',
    }).getAttribute('href')!).searchParams.get('daddr');
    expect(appleDestination()).toBe(`${original.lat},${original.lng}`);

    await act(async () => source.resolve([replacement]));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.lat).toBe(replacement.lat);
    expect(dialog.queryByRole('link', { name: '開啟 Apple 地圖步行導航' })).toBeNull();
    expect(dialog.queryByRole('link', { name: '開啟步行導航' })).toBeNull();

    fireEvent.change(dialog.getByRole('combobox'), { target: { value: original.id } });
    expect(appleDestination()).toBe(`${replacement.lat},${replacement.lng}`);
  } finally {
    view.unmount();
    fetch.mockRestore();
    for (const [name, descriptor] of [['showModal', showModal], ['close', close]] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
  }
});

it.each(['coordinates', 'building', 'floor', 'unchanged'] as const)('revalidates a manually selected detail after source sync (%s)', async (change) => {
  state.user = null;
  const original = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" />);
  fireEvent.click(screen.getByRole('button', { name: '查看' + original.name }));
  const google = () => screen.queryByRole('link', { name: '從目前位置導航' });
  const apple = () => screen.queryByRole('link', { name: '使用 Apple 地圖從目前位置導航' });
  expect(google()).toBeTruthy();
  expect(apple()).toBeTruthy();
  const loginFocus = (name: string) => {
    const link = new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
    return new URL(link.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('focus');
  };
  expect(loginFocus('用 Google 帳號收藏')).toBeNull();
  expect(loginFocus('查看學校帳號的既有收藏')).toBeNull();
  const replacement = { ...original,
    ...(change === 'coordinates' ? { lat: original.lat + 0.002 } : {}),
    ...(change === 'building' ? { building: '測試用變更建築' } : {}),
    ...(change === 'floor' ? { floor: '測試用變更樓層' } : {}),
  };
  await act(async () => source.resolve([replacement]));
  if (change !== 'unchanged') {
    expect(google()).toBeNull();
    expect(apple()).toBeNull();
    expect(screen.getByText(/已停用地點導航/)).toBeTruthy();
    const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
    expect(new URL(login.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('focus')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看' + replacement.name }));
  }
  expect(screen.queryByText(/已停用地點導航/)).toBeNull();
  expect(new URL(google()!.getAttribute('href')!).searchParams.get('destination')).toBe(replacement.lat + ',' + replacement.lng);
  expect(new URL(apple()!.getAttribute('href')!).searchParams.get('daddr')).toBe(replacement.lat + ',' + replacement.lng);
  expect(loginFocus('用 Google 帳號收藏')).toBe(replacement.id);
  expect(loginFocus('查看學校帳號的既有收藏')).toBe(replacement.id);
});

it('keeps a confirmed selected marker visible across filters until the detail is closed', async () => {
  render(<MapClient school="other-school" focus={gate.id} />);
  await screen.findByRole('button', { name: '查看' + gate.name });
  const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  const ids = () => mapState().locations.map((place: MapLocation) => place.id);
  expect(mapState().selected.id).toBe(gate.id);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋地點' }), { target: { value: library.name } });
  expect(screen.queryByRole('button', { name: '查看' + gate.name })).toBeNull();
  expect(ids()).toEqual([library.id, gate.id]);
  expect(mapState().selected).toEqual(gate);
  const close = screen.getByRole('button', { name: '關閉地點詳情' });
  close.focus();
  fireEvent.click(close);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(mapState().selected).toBeNull();
  expect(ids()).toEqual([library.id]);
});

it('resolves classroom deep links to a unique real building while retaining the original room wording', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="主顧303" />);
  await sourceSettled();
  expect((screen.getByRole('searchbox', { name: '搜尋地點' }) as HTMLInputElement).value).toBe('主顧303');
  const result = screen.getByRole('region', { name: '教室定位結果' });
  expect(within(result).getByRole('heading', { name: '主顧303' })).toBeTruthy();
  expect(within(result).getByText(/抵達後請依課表與現場標示確認教室/)).toBeTruthy();
  const map = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map.selected.id).toBe('pu-zhugu');
  expect(map.locations.map((place: MapLocation) => place.id)).toContain('pu-zhugu');
  const destination = new URL(screen.getByRole('link', { name: '從目前位置導航' }).getAttribute('href')!);
  expect(destination.searchParams.get('destination')).toBe(`${map.selected.lat},${map.selected.lng}`);
  const detail = screen.getByRole('region', { name: '地點詳情' });
  const apple = within(detail).getByRole('link', { name: '使用 Apple 地圖從目前位置導航' });
  const appleUrl = new URL(apple.getAttribute('href')!);
  expect(appleUrl.hostname).toBe('maps.apple.com');
  expect(appleUrl.searchParams.get('daddr')).toBe(destination.searchParams.get('destination'));
  expect(appleUrl.searchParams.has('saddr')).toBe(false);
  expect(appleUrl.searchParams.get('dirflg')).toBe('w');
  expect(document.getElementById(apple.getAttribute('aria-describedby')!)?.textContent).toContain('並非已核實的校舍入口或室內教室');
  expect(screen.queryByText(/樓層：3|三樓教室|3F/)).toBeNull();
  const direct = within(result);
  const directGoogle = direct.getByRole('link', { name: '使用 Google 地圖前往主顧樓' });
  const directApple = direct.getByRole('link', { name: '使用 Apple 地圖前往主顧樓' });
  expect(new URL(directGoogle.getAttribute('href')!).searchParams.get('destination')).toBe(destination.searchParams.get('destination'));
  expect(new URL(directGoogle.getAttribute('href')!).searchParams.has('origin')).toBe(false);
  expect(new URL(directApple.getAttribute('href')!).searchParams.get('daddr')).toBe(destination.searchParams.get('destination'));
  expect(new URL(directApple.getAttribute('href')!).searchParams.has('saddr')).toBe(false);
  expect(new URL(directApple.getAttribute('href')!).searchParams.get('dirflg')).toBe('w');
  expect(directGoogle.getAttribute('aria-describedby')).toBe(directApple.getAttribute('aria-describedby'));
  expect(document.getElementById(directGoogle.getAttribute('aria-describedby')!)?.textContent).toContain('並非已核實的入口或室內教室');
  expect(directGoogle.getAttribute('rel')).toBe('noopener noreferrer');
  expect(directApple.getAttribute('rel')).toBe('noopener noreferrer');
  expect(result.compareDocumentPosition(screen.getByLabelText('地圖狀態')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '關閉地點詳情' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
  expect(direct.getByRole('link', { name: '使用 Google 地圖前往主顧樓' })).toBe(directGoogle);
  fireEvent.click(within(result).getByRole('button', { name: '定位主顧樓' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('pu-zhugu');
  fireEvent.click(screen.getByRole('button', { name: '看整個校園' }));
  expect(screen.queryByRole('region', { name: '教室定位結果' })).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
});

it('resolves verified PH303 to the existing PU building without inferring a room or floor', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="PH303" />);
  await sourceSettled();
  const result = screen.getByRole('region', { name: '教室定位結果' });
  expect(within(result).getByText(/可對應「主顧樓」的位置/)).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('PH303');
  const map = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map.selected.id).toBe('pu-zhugu');
  expect(screen.queryByText(/PH303 已定位到教室|樓層：3|三樓教室/)).toBeNull();
  const destination = new URL(screen.getByRole('link', { name: '從目前位置導航' }).getAttribute('href')!);
  expect(destination.searchParams.get('destination')).toBe(`${map.selected.lat},${map.selected.lng}`);
});

it('requires a choice between ambiguous same-school buildings and never selects the first by default', async () => {
  const candidates = [
    { ...library, id: 'east', name: '教學大樓', description: '東側', lat: 25.01 },
    { ...library, id: 'west', name: '教學大樓', description: '西側', lat: 25.02 },
  ];
  vi.mocked(loadMapLocations).mockResolvedValue(candidates);
  render(<MapClient school="another-school" query="教學101" />);
  const result = await screen.findByRole('region', { name: '教室定位結果' });
  expect(within(result).getByText(/有多個相符地點/)).toBeTruthy();
  expect(within(result).queryByRole('link', { name: /地圖前往/ })).toBeNull();
  expect(result.compareDocumentPosition(screen.getByLabelText('地圖狀態')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  fireEvent.click(within(result).getByRole('button', { name: '選擇候選 2：教學大樓' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('west');
  expect(screen.queryByText('主顧樓')).toBeNull();
});

it('plans from an explicitly chosen ambiguous classroom candidate without guessing a building', async () => {
  const candidates = [
    { ...library, id: 'east', name: '教學大樓', description: '東側', lat: 25.01 },
    { ...library, id: 'west', name: '教學大樓', description: '西側', lat: 25.02 },
  ];
  vi.mocked(loadMapLocations).mockResolvedValue([...candidates, gate]);
  render(<MapClient school="another-school" query="教學101" focus="east" />);
  const result = within(await screen.findByRole('region', { name: '教室定位結果' }));
  // A deep-linked marker is not an explicit confirmation of an ambiguous room.
  expect(result.queryByRole('button', { name: '選擇步行起點' })).toBeNull();
  fireEvent.click(result.getByRole('button', { name: '選擇候選 2：教學大樓' }));
  const start = result.getByRole('button', { name: '選擇步行起點' });
  expect(document.getElementById(start.getAttribute('aria-describedby')!)?.textContent).toContain('並非已核實的入口或室內教室');
  fireEvent.click(start);
  expect(screen.getByText(/已設定「教學大樓」為終點/)).toBeTruthy();
  const pending = within(screen.getByRole('region', { name: '已選擇步行終點' }));
  const providerGoogle = pending.getByRole('link', { name: '在 Google 地圖選擇起點' });
  const providerApple = pending.getByRole('link', { name: '在 Apple 地圖選擇起點' });
  const googleUrl = new URL(providerGoogle.getAttribute('href')!);
  const appleUrl = new URL(providerApple.getAttribute('href')!);
  expect(googleUrl.searchParams.get('destination')).toBe(`${candidates[1].lat},${candidates[1].lng}`);
  expect(appleUrl.searchParams.get('daddr')).toBe(googleUrl.searchParams.get('destination'));
  expect(googleUrl.searchParams.has('origin')).toBe(false);
  expect(appleUrl.searchParams.has('saddr')).toBe(false);
  expect(googleUrl.searchParams.get('travelmode')).toBe('walking');
  expect(appleUrl.searchParams.get('dirflg')).toBe('w');
  expect(document.getElementById(providerGoogle.getAttribute('aria-describedby')!)?.textContent)
    .toContain('並非已核實的入口或室內教室');
  expect(providerApple.getAttribute('aria-describedby')).toBe(providerGoogle.getAttribute('aria-describedby'));
  expect((screen.getByRole('button', { name: '設為起點' }) as HTMLButtonElement).disabled).toBe(true);
  const search = screen.getByRole('searchbox', { name: '搜尋地點' }) as HTMLInputElement;
  expect(search.value).toBe('');
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: gate.name } });
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  const route = within(screen.getByRole('region', { name: '步行導航' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route.map((place: MapLocation) => place.id)).toEqual(['gate', 'west']);
  expect(new URL(route.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!).searchParams.get('destination')).toBe(`${candidates[1].lat},${candidates[1].lng}`);
});

it('does not replace an existing route when an ambiguous classroom candidate is selected', async () => {
  const candidates = [
    { ...library, id: 'east', name: '教學大樓', lat: 25.01 },
    { ...library, id: 'west', name: '教學大樓', lat: 25.02 },
  ];
  vi.mocked(loadMapLocations).mockResolvedValue([...candidates, gate, library]);
  render(<MapClient school="another-school" query="教學101" route="gate,library" />);
  const result = within(await screen.findByRole('region', { name: '教室定位結果' }));
  fireEvent.click(result.getByRole('button', { name: '選擇候選 2：教學大樓' }));
  expect(result.queryByRole('button', { name: '選擇步行起點' })).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route.map((place: MapLocation) => place.id)).toEqual(['gate', 'library']);
});

it.each([true, false])('uses a confirmed ambiguous classroom candidate with an existing origin (shared=%s)', async (shared) => {
  const candidates = [
    { ...library, id: 'east', name: '教學大樓', description: '東側', lat: 25.01 },
    { ...library, id: 'west', name: '教學大樓', description: '西側', lat: 25.02 },
  ];
  vi.mocked(loadMapLocations).mockResolvedValue([...candidates, gate, library]);
  render(<MapClient school="another-school" query="教學101" focus="gate"
    route={shared ? 'gate,library' : undefined} />);
  const result = within(await screen.findByRole('region', { name: '教室定位結果' }));
  if (!shared) fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  const action = () => result.queryByRole('button', { name: '將教學大樓設為終點' });
  expect(action()).toBeNull();
  fireEvent.click(result.getByRole('button', { name: '選擇候選 2：教學大樓' }));
  const map = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map().route?.map((place: MapLocation) => place.id) ?? null)
    .toEqual(shared ? ['gate', 'library'] : null);
  const button = result.getByRole('button', { name: '將教學大樓設為終點' });
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent)
    .toContain('並非已核實的入口或室內教室');
  button.focus();
  fireEvent.click(button);
  const route = within(screen.getByRole('region', { name: '步行導航' }));
  expect(document.activeElement).toBe(route.getByRole('heading', { name: '正門 → 教學大樓' }));
  expect(map().route.map((place: MapLocation) => place.id)).toEqual(['gate', 'west']);
  const google = new URL(route.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  const apple = new URL(route.getByRole('link', { name: '使用 Apple 地圖規劃路線' }).getAttribute('href')!);
  expect(google.searchParams.get('origin')).toBe(`${gate.lat},${gate.lng}`);
  expect(google.searchParams.get('destination')).toBe(`${candidates[1].lat},${candidates[1].lng}`);
  expect(apple.searchParams.get('saddr')).toBe(google.searchParams.get('origin'));
  expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'));
});

it('does not guess unknown building codes and preserves the classroom through an account reconnect', async () => {
  state.user = null;
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="ZZ303" focus="pu-library" />);
  await sourceSettled();
  const result = screen.getByRole('region', { name: '教室定位結果' });
  expect(within(result).getByText(/目前地點資料無法確認/)).toBeTruthy();
  expect(within(result).getByRole('link', { name: '核對校方地圖' }).getAttribute('href')).toMatch(/^https:\/\//);
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('pu-library');
  const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
  const back = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
  expect(back.searchParams.get('query')).toBe('ZZ303');
  expect(back.searchParams.get('focus')).toBe('pu-library');
  expect(back.searchParams.get('schoolId')).toBe('pu');
});

it('puts unknown-room recovery above the map and selects the query to edit', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="ZZ303" />);
  await sourceSettled();
  const result = screen.getByRole('region', { name: '教室定位結果' });
  expect(result.compareDocumentPosition(screen.getByLabelText('地圖狀態')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  fireEvent.click(within(result).getByRole('button', { name: '修改教室名稱' }));
  const input = screen.getByRole('searchbox', { name: '搜尋地點' }) as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'ZZ303'.length]);
});

it.each(['button', 'enter'] as const)('rechecks a corrected classroom without leaving the map (%s)', async (method) => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="ZZ303" />);
  await sourceSettled();
  fireEvent.click(screen.getByRole('button', { name: '修改教室名稱' }));
  const search = screen.getByRole('searchbox', { name: '搜尋地點' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: '   ' } });
  expect((screen.getByRole('button', { name: '確認教室名稱' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(search, { target: { value: ' PH303 ' } });
  expect(screen.queryByRole('region', { name: '教室定位結果' })).toBeNull();
  if (method === 'enter') fireEvent.keyDown(search, { key: 'Enter' });
  else fireEvent.click(screen.getByRole('button', { name: '確認教室名稱' }));
  const result = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(result.getByRole('heading', { name: 'PH303' })).toBeTruthy();
  expect(result.getByRole('button', { name: '選擇步行起點' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('pu-zhugu');
  expect(search.value).toBe('PH303');
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: '圖書館' } });
  expect(screen.queryByRole('region', { name: '教室定位結果' })).toBeNull();
});

it('cancels an unconfirmed classroom correction and restores the original request', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="ZZ303" />);
  await sourceSettled();
  fireEvent.click(screen.getByRole('button', { name: '修改教室名稱' }));
  const search = screen.getByRole('searchbox', { name: '搜尋地點' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: 'PH303' } });
  fireEvent.click(screen.getByRole('button', { name: '取消修改教室' }));
  expect(search.value).toBe('ZZ303');
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole('heading', { name: 'ZZ303' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '使用 Google 地圖前往主顧樓' })).toBeNull();
});

it('supersedes the previous URL focus when a corrected classroom is confirmed, without changing a shared route', async () => {
  state.user = null;
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="ZZ303" focus="pu-library" route="pu-library,pu-zhugu" />);
  await sourceSettled();
  const map = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map().selected.id).toBe('pu-library');
  expect(map().route.map((place: MapLocation) => place.id)).toEqual(['pu-library', 'pu-zhugu']);
  fireEvent.click(screen.getByRole('button', { name: '修改教室名稱' }));
  const search = screen.getByRole('searchbox', { name: '搜尋地點' });
  fireEvent.change(search, { target: { value: 'PH303' } });
  fireEvent.click(screen.getByRole('button', { name: '取消修改教室' }));
  expect(map().selected.id).toBe('pu-library');
  fireEvent.click(screen.getByRole('button', { name: '修改教室名稱' }));
  fireEvent.change(search, { target: { value: 'PH303' } });
  fireEvent.click(screen.getByRole('button', { name: '確認教室名稱' }));
  expect(map().selected.id).toBe('pu-zhugu');
  expect(map().route.map((place: MapLocation) => place.id)).toEqual(['pu-library', 'pu-zhugu']);
  const detail = within(screen.getByRole('region', { name: '地點詳情' }));
  expect(new URL(detail.getByRole('link', { name: '從目前位置導航' }).getAttribute('href')!).searchParams.get('destination'))
    .toBe(`${map().selected.lat},${map().selected.lng}`);
  const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
  const back = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
  expect(back.searchParams.get('query')).toBe('PH303');
  expect(back.searchParams.get('focus')).toBe('pu-zhugu');
  expect(back.searchParams.get('route')).toBe('pu-library,pu-zhugu');
});

it('clears a prior explicit candidate when a changed classroom is still unresolved', async () => {
  const candidates = [
    { ...library, id: 'east', name: '教學大樓', lat: 25.01 },
    { ...library, id: 'west', name: '教學大樓', lat: 25.02 },
  ];
  vi.mocked(loadMapLocations).mockResolvedValue(candidates);
  render(<MapClient school="another-school" query="教學101" focus="east" />);
  const result = within(await screen.findByRole('region', { name: '教室定位結果' }));
  fireEvent.click(result.getByRole('button', { name: '選擇候選 2：教學大樓' }));
  const map = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map().selected.id).toBe('west');
  fireEvent.click(result.getByRole('button', { name: '修改教室名稱' }));
  const search = screen.getByRole('searchbox', { name: '搜尋地點' });
  fireEvent.change(search, { target: { value: 'ZZ303' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByRole('heading', { name: 'ZZ303' })).toBeTruthy();
  expect(map().selected).toBeNull();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  expect(screen.queryByText(/找不到連結指定的地點/)).toBeNull();
});

it('honors explicit focus over a resolved classroom and resets the request when URL query changes', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  const view = render(<MapClient school="pu" query="主顧303" focus="pu-library" />);
  await sourceSettled();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('pu-library');
  expect(screen.getByRole('button', { name: '定位主顧樓' })).toBeTruthy();
  const classroomLink = screen.getByRole('link', { name: '使用 Google 地圖前往主顧樓' });
  const detailLink = screen.getByRole('link', { name: '從目前位置導航' });
  expect(new URL(classroomLink.getAttribute('href')!).searchParams.get('destination')).not.toBe(
    new URL(detailLink.getAttribute('href')!).searchParams.get('destination'),
  );
  view.rerender(<MapClient school="pu" query="無法辨識303" />);
  await sourceSettled();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('無法辨識303');
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
});

it('waits for the source before automatically selecting a classroom that may be ambiguous', async () => {
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query="主顧303" />);
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
  const result = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(result.queryByRole('button', { name: '定位主顧樓' })).toBeNull();
  await act(async () => source.resolve([
    { ...library, id: 'east-zhugu', name: '主顧樓', lat: 24.22, lng: 120.59 },
    { ...library, id: 'west-zhugu', name: '主顧樓', lat: 24.22, lng: 120.58 },
  ]));
  expect(screen.getByText(/有多個相符地點/)).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
});

it.each([true, false])('plans a classroom destination using an existing origin (shared=%s)', async (shared) => {
  state.user = null;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query="PH303" focus="gate"
    route={shared ? 'gate,library' : undefined} />);
  const card = within(screen.getByRole('region', { name: '教室定位結果' }));
  const action = () => card.queryByRole('button', { name: '將主顧樓設為終點' });
  expect(action()).toBeNull();
  const search = screen.getByRole('searchbox', { name: '搜尋地點' });
  search.focus();
  // A non-empty live catalogue replaces the bundled places; include the real
  // destination explicitly instead of expecting a silent fallback to bundled data.
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  await act(async () => source.resolve([library, gate, classroom]));
  expect(document.activeElement).toBe(search);
  if (!shared) {
    expect(action()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  }
  const classroomButton = card.getByRole('button', { name: '將主顧樓設為終點' });
  classroomButton.focus();
  expect(document.getElementById(classroomButton.getAttribute('aria-describedby')!)?.textContent)
    .toContain('並非已核實的入口或室內教室');
  fireEvent.click(classroomButton);
  const routeCard = within(screen.getByRole('region', { name: '步行導航' }));
  expect(document.activeElement).toBe(routeCard.getByRole('heading', { name: '正門 → 主顧樓' }));
  const google = new URL(routeCard.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  const apple = new URL(routeCard.getByRole('link', { name: '使用 Apple 地圖規劃路線' }).getAttribute('href')!);
  const map = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map.route.map((place: MapLocation) => place.id)).toEqual(['gate', 'pu-zhugu']);
  expect(google.searchParams.get('origin')).toBe(`${gate.lat},${gate.lng}`);
  expect(google.searchParams.get('destination')).toBe(`${map.route[1].lat},${map.route[1].lng}`);
  expect(apple.searchParams.get('saddr')).toBe(google.searchParams.get('origin'));
  expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'));
  fireEvent.click(routeCard.getByRole('button', { name: '清除路線' }));
  expect(action()).toBeNull();
  expect(document.activeElement).toBe(search);
});

it('lets a classroom-first student choose an explicit walking origin without losing the destination', async () => {
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  render(<MapClient school="pu" query="PH303" />);
  const card = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(card.queryByRole('button', { name: '選擇步行起點' })).toBeNull();
  await act(async () => source.resolve([library, gate, classroom]));
  fireEvent.click(card.getByRole('button', { name: '選擇步行起點' }));
  const search = screen.getByRole('searchbox', { name: '搜尋地點' }) as HTMLInputElement;
  expect(search.value).toBe('');
  expect(document.activeElement).toBe(search);
  expect(screen.getByText(/已設定「主顧樓」為終點/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect((screen.getByRole('button', { name: '設為起點' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(search, { target: { value: '正門' } });
  const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(mapState().locations.some((place: MapLocation) => place.id === classroom.id)).toBe(true);
  const pending = within(screen.getByRole('region', { name: '已選擇步行終點' }));
  const pendingGoogle = new URL(pending.getByRole('link', { name: '在 Google 地圖選擇起點' }).getAttribute('href')!);
  expect(pendingGoogle.searchParams.get('destination')).toBe(`${classroom.lat},${classroom.lng}`);
  expect(pendingGoogle.searchParams.has('origin')).toBe(false);
  expect(mapState().route).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  const routeCard = within(screen.getByRole('region', { name: '步行導航' }));
  expect(document.activeElement).toBe(routeCard.getByRole('heading', { name: '正門 → 主顧樓' }));
  expect(mapState().route.map((place: MapLocation) => place.id)).toEqual(['gate', classroom.id]);
  const google = new URL(routeCard.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  expect(google.searchParams.get('origin')).toBe(`${gate.lat},${gate.lng}`);
  expect(google.searchParams.get('destination')).toBe(`${classroom.lat},${classroom.lng}`);
});

it('delegates the starting point to the provider even when nuni has a previous GPS fix', async () => {
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate, classroom]);
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (success: PositionCallback) => {
      success({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition);
    } },
  });
  try {
    render(<MapClient school="pu" query="PH303" />);
    await sourceSettled();
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    const map = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    expect(map().myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
    const direct = within(screen.getByRole('region', { name: '教室定位結果' }));
    const directGoogle = new URL(direct.getByRole('link', { name: '使用 Google 地圖前往主顧樓' }).getAttribute('href')!);
    const directApple = new URL(direct.getByRole('link', { name: '使用 Apple 地圖前往主顧樓' }).getAttribute('href')!);
    const detailGoogle = new URL(screen.getByRole('link', { name: '從目前位置導航' }).getAttribute('href')!);
    const detailApple = new URL(screen.getByRole('link', { name: '使用 Apple 地圖從目前位置導航' }).getAttribute('href')!);
    for (const link of [directGoogle, detailGoogle]) {
      expect(link.searchParams.get('destination')).toBe(`${classroom.lat},${classroom.lng}`);
      expect(link.searchParams.get('travelmode')).toBe('walking');
      expect(link.searchParams.has('origin')).toBe(false);
    }
    for (const link of [directApple, detailApple]) {
      expect(link.searchParams.get('daddr')).toBe(`${classroom.lat},${classroom.lng}`);
      expect(link.searchParams.get('dirflg')).toBe('w');
      expect(link.searchParams.has('saddr')).toBe(false);
    }
    fireEvent.click(screen.getByRole('button', { name: '選擇步行起點' }));
    const pending = within(screen.getByRole('region', { name: '已選擇步行終點' }));
    const google = new URL(pending.getByRole('link', { name: '在 Google 地圖選擇起點' }).getAttribute('href')!);
    const apple = new URL(pending.getByRole('link', { name: '在 Apple 地圖選擇起點' }).getAttribute('href')!);
    expect(google.searchParams.get('destination')).toBe(`${classroom.lat},${classroom.lng}`);
    expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'));
    expect(google.searchParams.has('origin')).toBe(false);
    expect(apple.searchParams.has('saddr')).toBe(false);
    expect(map().route).toBeNull();
  } finally {
    if (original) Object.defineProperty(navigator, 'geolocation', original);
    else Reflect.deleteProperty(navigator, 'geolocation');
  }
});

it('can cancel a classroom-first destination and return to ordinary origin-first planning', async () => {
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate, classroom]);
  render(<MapClient school="pu" query="PH303" />);
  await sourceSettled();
  fireEvent.click(screen.getByRole('button', { name: '選擇步行起點' }));
  fireEvent.click(screen.getByRole('button', { name: '取消終點' }));
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(screen.queryByText(/已設定「主顧樓」為終點/)).toBeNull();
  expect(screen.queryByRole('region', { name: '已選擇步行終點' })).toBeNull();
  expect(screen.queryByRole('link', { name: '在 Google 地圖選擇起點' })).toBeNull();
  expect(screen.queryByRole('link', { name: '在 Apple 地圖選擇起點' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  expect(screen.getByText(/已設定「正門」為起點/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
});

it('does not restore an origin from an invalid shared route for classroom planning', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" query="PH303" route="missing-origin,library" />);
  await sourceSettled();
  const card = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(card.getByRole('link', { name: '使用 Google 地圖前往主顧樓' })).toBeTruthy();
  expect(card.queryByRole('button', { name: '將主顧樓設為終點' })).toBeNull();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
});

it('keeps a valid shared route when the live catalogue omits the classroom building', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate]);
  render(<MapClient school="pu" query="PH303" route="gate,library" />);
  await sourceSettled();
  const card = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(card.getByText(/目前地點資料無法確認/)).toBeTruthy();
  expect(card.queryByRole('button', { name: '將主顧樓設為終點' })).toBeNull();
  expect(card.queryByRole('link', { name: '使用 Google 地圖前往主顧樓' })).toBeNull();
  const map = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map.route.map((place: MapLocation) => place.id)).toEqual(['gate', 'library']);
});

it('does not offer a provisional classroom destination while the campus source is syncing', async () => {
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query="PH303" />);
  const result = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(result.getByRole('status').textContent).toContain('尚未確認這間教室的位置');
  expect(result.queryByRole('button', { name: '定位主顧樓' })).toBeNull();
  expect(result.queryByText(/可對應「主顧樓」的位置/)).toBeNull();
  expect(result.queryByRole('link', { name: /地圖前往/ })).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();

  await act(async () => source.resolve([]));
  expect(result.queryByRole('status')).toBeNull();
  expect(result.getByText(/可對應「主顧樓」的位置/)).toBeTruthy();
  expect(result.getByRole('link', { name: '使用 Google 地圖前往主顧樓' })).toBeTruthy();
  expect(result.getByRole('link', { name: '使用 Apple 地圖前往主顧樓' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('pu-zhugu');
});

it.each(['PH303', 'ZZ303'])('does not confirm classroom %s from bundled data after source failure', async (query) => {
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations)
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query={query} />);
  const result = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(await result.findByText(/暫時無法確認這間教室的位置/)).toBeTruthy();
  expect(result.queryByText(/可對應「主顧樓」的位置/)).toBeNull();
  expect(result.queryByText(/目前地點資料無法確認/)).toBeNull();
  expect(result.queryByRole('link', { name: /地圖前往/ })).toBeNull();
  expect(result.queryByRole('button', { name: '定位主顧樓' })).toBeNull();
  expect(result.getByRole('link', { name: '核對校方地圖' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取地點資料' }));
  expect(result.getByRole('status').textContent).toContain('正在確認地點資料');
  await act(async () => source.resolve([]));
  expect(result.queryByRole('status')).toBeNull();
  const selected = JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected;
  if (query === 'PH303') {
    expect(result.getByText(/可對應「主顧樓」的位置/)).toBeTruthy();
    expect(selected.id).toBe('pu-zhugu');
  } else {
    expect(result.getByText(/目前地點資料無法確認/)).toBeTruthy();
    expect(selected).toBeNull();
  }
});

it.each(['Bishop Kupfer Hall 303', 'Ｂｉｓｈｏｐ  Ｋｕｐｆｅｒ Ｈａｌｌ ３０３'])(
  'keeps the bus stop %s searchable without automatically opening the classroom alias',
  async (name) => {
    const hall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-wenxing')!;
    const source = deferred<MapLocation[]>();
    vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
    render(<MapClient school="pu" query="Bishop Kupfer Hall 303" />);
    const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    expect(mapState().selected).toBeNull();

    const stop = { ...gate, id: 'synthetic-bus-stop', name, category: '公車站' };
    await act(async () => source.resolve([hall, stop]));
    const map = mapState();
    expect(map.selected).toBeNull();
    expect(map.locations).toContainEqual(expect.objectContaining({ id: stop.id, name }));
    expect(screen.getByRole('button', { name: `查看${name.replace(/\s+/g, ' ')}` })).toBeTruthy();
  },
);

it.each([
  ['AK303', 'AK303'],
  ['AK303', 'ＡＫ３０３'],
  ['Anthony Kuo Hall 303', 'Anthony Kuo Hall 303'],
])(
  'leaves %s unselected and keeps a bus stop named %s searchable',
  async (query, name) => {
    state.user = null;
    const hall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-renyuan')!;
    const source = deferred<MapLocation[]>();
    vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
    render(<MapClient school="pu" query={query} />);
    const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    expect(mapState().selected).toBeNull();
    expect(screen.queryByRole('region', { name: '地點詳情' })).toBeNull();
    const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
    const back = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
    expect(back.searchParams.has('focus')).toBe(false);
    expect(back.searchParams.get('query')).toBe(query);

    const stop = { ...gate, id: 'synthetic-ak-bus-stop', name, category: '公車站' };
    await act(async () => source.resolve([hall, stop]));
    const map = mapState();
    expect(map.selected).toBeNull();
    expect(map.locations).toContainEqual(expect.objectContaining({ id: stop.id, name }));
    expect(screen.getByRole('button', { name: `查看${name.replace(/\s+/g, ' ')}` })).toBeTruthy();
  },
);

it.each(['AK303', 'Anthony Kuo Hall 303'])(
  'automatically opens Renyuan Hall for %s after the source settles without a name conflict',
  async (query) => {
    const source = deferred<MapLocation[]>();
    vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
    render(<MapClient school="pu" query={query} />);
    const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    expect(mapState().selected).toBeNull();
    await act(async () => source.resolve([]));
    expect(mapState().selected.id).toBe('pu-renyuan');
  },
);

it.each([
  ['任垣樓', 'teaching-hall'],
  ['Anthony Kuo Hall', null],
])('uses the public classroom matches when Renyuan Hall is named %s', async (name, selectedId) => {
  const hall = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-renyuan')!;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query="Anthony Kuo Hall 303" />);

  await act(async () => source.resolve([
    { ...hall, name },
    { ...hall, id: 'teaching-hall', name: '教學館', building: 'Anthony Kuo Hall' },
  ]));

  const map = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(map.selected?.id ?? null).toBe(selectedId);
  if (selectedId) {
    expect(map.locations.map((place: MapLocation) => place.id)).toEqual([selectedId]);
  } else {
    expect(screen.getByText(/有多個相符地點/)).toBeTruthy();
  }
});

it('keeps a classroom unconfirmed after source failure and a conflicting retry', async () => {
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations)
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query="AK303" />);
  const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  const retry = await screen.findByRole('button', { name: '重新讀取地點資料' });
  const result = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(result.getByRole('status').textContent).toContain('暫時無法確認這間教室的位置');
  expect(mapState().selected).toBeNull();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();

  fireEvent.click(retry);
  expect(result.getByRole('status').textContent).toContain('正在確認地點資料');
  expect(mapState().selected).toBeNull();
  await act(async () => source.resolve([
    { ...gate, id: 'synthetic-ak-bus-stop', name: 'AK303', category: '公車站' },
  ]));
  expect(mapState().selected).toBeNull();
  expect(screen.getByRole('button', { name: '查看AK303' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  expect(loadMapLocations).toHaveBeenCalledTimes(2);
});

it('never replaces a missing explicit focus with the classroom guess, including after a source update', async () => {
  state.user = null;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" query="主顧303" focus="pu-library" />);
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('pu-library');
  await act(async () => source.resolve([{ ...library, id: 'new-zhugu', name: '主顧樓' }]));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
  expect(screen.getByText('找不到連結指定的地點，請搜尋地點名稱。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
  const back = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
  expect(back.searchParams.get('focus')).toBe('pu-library');
  expect(back.searchParams.get('query')).toBe('主顧303');
  fireEvent.click(screen.getByRole('button', { name: '定位主顧樓' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('new-zhugu');
});

it.each(['missing', 'duplicate'] as const)('recovers an unavailable focus link without restoring it on login (%s)', async (kind) => {
  state.user = null;
  const focus = kind === 'missing' ? 'missing-place' : gate.id;
  vi.mocked(loadMapLocations).mockResolvedValue(kind === 'missing'
    ? [library]
    : [library, gate, { ...gate, name: '測試用重複識別碼', lat: gate.lat + 0.002 }]);
  render(<MapClient school="other-school" focus={focus} />);
  const mapState = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  const clear = await screen.findByRole('button', { name: '清除連結地點' });
  expect(mapState().selected).toBeNull();
  expect(screen.getByText(kind === 'missing'
    ? '找不到連結指定的地點，請搜尋地點名稱。'
    : '連結指定的地點識別碼重複，無法確認位置。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
  const loginFocus = () => {
    const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
    return new URL(login.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('focus');
  };
  expect(loginFocus()).toBe(focus);
  clear.focus();
  fireEvent.click(clear);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(screen.queryByRole('button', { name: '清除連結地點' })).toBeNull();
  expect(mapState().selected).toBeNull();
  expect(loginFocus()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看' + library.name }));
  expect(mapState().selected).toEqual(library);
  expect(loginFocus()).toBe(library.id);
});

it('retains the requested classroom in loading, failure and empty-school states', async () => {
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  const view = render(<MapClient school="another-school" query="教學101" />);
  expect(screen.getByText('待確認的教室：教學101')).toBeTruthy();
  await act(async () => source.resolve([]));
  expect(screen.getByText('待確認的教室：教學101')).toBeTruthy();
  expect(screen.getByText('目前沒有可顯示的校園地點')).toBeTruthy();
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('offline'));
  view.rerender(<MapClient school="offline-school" query="新樓202" />);
  expect(await screen.findByText('暫時無法取得校園地點')).toBeTruthy();
  expect(screen.getByText('待確認的教室：新樓202')).toBeTruthy();
});

it('uses classroom wording in typed searches without automatic selection', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  await sourceSettled();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '主顧303' } });
  expect(screen.getByRole('button', { name: '查看主顧樓' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected).toBeNull();
});

it('shows a retryable source error without fabricated places or opening hours', async () => {
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('offline'));
  render(<MapClient school="nthu" />);
  expect(await screen.findByText('暫時無法取得校園地點')).toBeTruthy();
  expect(screen.queryByLabelText('地圖狀態')).toBeNull();
  expect(screen.queryByText(/工程館|開放中|示範/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新載入地點' }));
  expect(await screen.findByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
});

it('uses bundled Providence places when the confirmed source is empty', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  expect(await screen.findByRole('button', { name: '查看主顧樓' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看靜宜大學（校門）' })).toBeTruthy();
  expect(screen.getByText(/OpenStreetMap 貢獻者資料/)).toBeTruthy();
  expect(screen.queryByText('目前沒有可顯示的校園地點')).toBeNull();
});

it('links a selected Providence bus stop to the live bus page', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看靜宜大學（校門）' }));
  const live = screen.getByRole('link', { name: '查看即時到站' });
  expect(live.getAttribute('href')).toBe('/bus?schoolId=pu');
  expect(screen.getByRole('link', { name: '查看地點來源 ↗' }).getAttribute('href')).toBe(
    'https://data.gov.tw/dataset/81555',
  );
});

it('marks single-source places as pending and can reset to the whole campus', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看P1 停車場' }));
  expect(await screen.findByText(/只有單一資料來源，位置待再次確認/)).toBeTruthy();
  expect(screen.getAllByText('待確認').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '看整個校園' }));
  expect(screen.queryByRole('region', { name: '地點詳情' })).toBeNull();
});

it.each([false, true])('includes pending source warnings in both providers for a two-point route (reverse=%s)', async (reverse) => {
  const parking = PROVIDENCE_CAMPUS_PLACES.find((place) => place.name === 'P1 停車場')!;
  vi.mocked(loadMapLocations).mockResolvedValue([parking, library]);
  const ids = reverse ? [library.id, parking.id] : [parking.id, library.id];
  render(<MapClient school="pu" route={ids.join(',')} focus={parking.id} />);
  await sourceSettled();
  const routeCard = screen.getByRole('region', { name: '步行導航' });
  for (const name of ['開啟步行導航', '使用 Apple 地圖規劃路線']) {
    const link = within(routeCard).getByRole('link', { name });
    const note = document.getElementById(link.getAttribute('aria-describedby')!);
    expect(note?.textContent).toContain('P1 停車場');
    expect(note?.textContent).toContain('只有單一資料來源，位置待再次確認');
    expect(note?.textContent).not.toContain('「蓋夏圖書館」');
  }
  const detail = screen.getByRole('region', { name: '地點詳情' });
  for (const name of ['從目前位置導航', '使用 Apple 地圖從目前位置導航']) {
    const link = within(detail).getByRole('link', { name });
    expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent)
      .toContain('只有單一資料來源，位置待再次確認');
  }
  fireEvent.click(within(routeCard).getByRole('button', { name: '清除路線' }));
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
});

it('does not apply Providence source warnings to an identically named marker in another campus', async () => {
  const parking = PROVIDENCE_CAMPUS_PLACES.find((place) => place.name === 'P1 停車場')!;
  vi.mocked(loadMapLocations).mockResolvedValue([parking, library]);
  render(<MapClient school="remote-university-12" route={parking.id + ',' + library.id} />);
  const routeCard = await screen.findByRole('region', { name: '步行導航' });
  expect(routeCard.textContent).not.toContain('只有單一資料來源');
});

it('never points an empty non-Providence map back to Providence', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="remote-university-12" />);
  expect(await screen.findByText('目前沒有可顯示的校園地點')).toBeTruthy();
  expect(screen.getByText(/不會改用其他學校的建築或導航位置/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '查看校方校區平面圖' })).toBeNull();
  expect(loadMapLocations).toHaveBeenCalledWith('remote-university-12');
});

it('resolves deep links from loaded places and hands walking directions to a real map provider', async () => {
  const loading = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(loading.promise);
  render(<MapClient school="pu" route="gate,library" focus="library" />);
  expect(screen.queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(screen.queryByRole('button', { name: '交換起點與終點' })).toBeNull();
  await act(async () => loading.resolve([library, gate]));
  const destination = new URL(
    screen.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!,
  );
  expect(destination.hostname).toBe('www.google.com');
  expect(destination.searchParams.get('origin')).toBe('24.22495,120.56535');
  expect(destination.searchParams.get('destination')).toBe('24.2275,120.5635');
  expect(destination.searchParams.get('travelmode')).toBe('walking');
  const routeCard = screen.getByRole('region', { name: '步行導航' });
  const apple = within(routeCard).getByRole('link', { name: '使用 Apple 地圖規劃路線' });
  const appleUrl = new URL(apple.getAttribute('href')!);
  expect(appleUrl.hostname).toBe('maps.apple.com');
  expect(appleUrl.searchParams.get('saddr')).toBe(destination.searchParams.get('origin'));
  expect(appleUrl.searchParams.get('daddr')).toBe(destination.searchParams.get('destination'));
  expect(appleUrl.searchParams.get('dirflg')).toBe('w');
  const routeWarning = document.getElementById(apple.getAttribute('aria-describedby')!);
  expect(routeWarning?.textContent).toContain('不代表已核實的建築入口');
  expect(within(routeCard).getByRole('link', { name: '開啟步行導航' }).getAttribute('aria-describedby')).toBe(routeWarning?.id);
  expect(screen.queryByText(/AI 規劃路線|開放中/)).toBeNull();
  expect(screen.getAllByText(/每分鐘 80 公尺/).length).toBeGreaterThan(0);
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).selected.id).toBe('library');
  fireEvent.click(screen.getByRole('button', { name: '關閉地點詳情' }));
  expect(screen.queryByRole('region', { name: '地點詳情' })).toBeNull();
});

it.each([false, true])('waits for bundled shared-route endpoints and honors cancellation (cancel=%s)', async (cancel) => {
  const origin = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  const destination = PROVIDENCE_CAMPUS_PLACES.find((place) => place.name === '蓋夏圖書館')!;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" route={origin.id + ',' + destination.id} />);
  expect(screen.getByText(/正在確認連結的起點與終點/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route).toBeNull();
  if (cancel) fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  // Synthetic coordinate change to model a source replacing a bundled marker.
  const updated = { ...destination, lat: destination.lat + 0.001 };
  await act(async () => source.resolve([origin, updated]));
  expect(screen.queryByText(/正在確認連結的起點與終點/)).toBeNull();
  if (cancel) {
    expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route).toBeNull();
  } else {
    const card = screen.getByRole('region', { name: '步行導航' });
    const google = new URL(within(card).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
    const apple = new URL(within(card).getByRole('link', { name: '使用 Apple 地圖規劃路線' }).getAttribute('href')!);
    expect(google.searchParams.get('destination')).toBe(updated.lat + ',' + updated.lng);
    expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'));
  }
});

it.each([false, true])('keeps a bundled shared route unconfirmed after source failure (cancel=%s)', async (cancel) => {
  const origin = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  const destination = PROVIDENCE_CAMPUS_PLACES.find((place) => place.name === '蓋夏圖書館')!;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations)
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" route={origin.id + ',' + destination.id} />);
  expect(await screen.findByText(/暫時無法確認連結的起點與終點/)).toBeTruthy();
  expect(screen.queryByText(/已不在目前地點資料中/)).toBeNull();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route).toBeNull();
  if (cancel) fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  fireEvent.click(screen.getByRole('button', { name: '重新讀取地點資料' }));
  // Synthetic replacement, not a verified coordinate or entrance.
  const updated = { ...destination, lat: destination.lat + 0.001 };
  await act(async () => source.resolve([origin, updated]));
  expect(screen.queryByText(/暫時無法確認連結的起點與終點/)).toBeNull();
  if (cancel) {
    expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route).toBeNull();
  } else {
    const card = screen.getByRole('region', { name: '步行導航' });
    const google = new URL(within(card).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
    const apple = new URL(within(card).getByRole('link', { name: '使用 Apple 地圖規劃路線' }).getAttribute('href')!);
    expect(google.searchParams.get('destination')).toBe(updated.lat + ',' + updated.lng);
    expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'));
  }
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
  expect(screen.getByRole('link', { name: '用 Google 帳號收藏' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '收藏蓋夏圖書館' })).toBeNull();
  fireEvent.change(input, { target: { value: '不存在' } });
  const reset = screen.getByRole('button', { name: '清除搜尋條件' });
  reset.focus();
  fireEvent.click(reset);
  expect(document.activeElement).toBe(input);
  expect(screen.queryByRole('button', { name: '清除搜尋條件' })).toBeNull();
  expect(screen.getByRole('button', { name: '查看正門' })).toBeTruthy();
});

it('keeps a place card mounted for the same selection and replaces it for a different place', async () => {
  render(<MapClient school="pu" schoolName="靜宜大學" />);
  await sourceSettled();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).schoolName).toBe('靜宜大學');
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  const card = screen.getByRole('region', { name: '地點詳情' });
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  expect(screen.getByRole('region', { name: '地點詳情' })).toBe(card);
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  expect(screen.getByRole('region', { name: '地點詳情' })).not.toBe(card);
  expect(screen.getByRole('heading', { name: '正門' })).toBeTruthy();
});

it.each(['origin', 'destination'] as const)('warns before login would discard a partial walking draft (%s)', async (endpoint) => {
  state.user = null;
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate, classroom]);
  render(<MapClient school="pu" focus={endpoint === 'origin' ? 'gate' : undefined}
    query={endpoint === 'destination' ? 'PH303' : undefined} />);
  await sourceSettled();
  const loginLinks = () => [
    screen.getByRole('link', { name: '用 Google 帳號收藏' }),
    screen.getByRole('link', { name: '查看學校帳號的既有收藏' }),
  ];
  const notice = () => screen.queryByText(/目前的步行規劃無法保留至登入後/);
  expect(notice()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: endpoint === 'origin' ? '設為起點' : '選擇步行起點' }));
  expect(notice()).toBeTruthy();
  for (const link of loginLinks()) {
    expect(document.getElementById(link.getAttribute('aria-describedby')!)).toBe(notice());
    const login = new URL(link.getAttribute('href')!, window.location.origin);
    expect(new URL(login.searchParams.get('returnUrl')!, window.location.origin).searchParams.has('route')).toBe(false);
  }
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: endpoint === 'origin' ? '設為終點' : '設為起點' }));
  expect(screen.getByRole('region', { name: '步行導航' })).toBeTruthy();
  expect(notice()).toBeNull();
  for (const link of loginLinks()) {
    expect(link.hasAttribute('aria-describedby')).toBe(false);
    const login = new URL(link.getAttribute('href')!, window.location.origin);
    expect(new URL(login.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('route'))
      .toBe(endpoint === 'origin' ? 'gate,library' : 'library,pu-zhugu');
  }
  fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  expect(notice()).toBeNull();
});

it('offers Google favorites and keeps an explicit school flow for existing cloud favorites', async () => {
  state.user = null;
  window.history.replaceState({}, '', '/map?schoolId=pu&route=gate%2Clibrary#directions');
  render(<MapClient school="pu" route="gate,library" focus="gate" />);
  await sourceSettled();
  fireEvent.click(await screen.findByRole('button', { name: '查看蓋夏圖書館' }));
  const login = new URL(
    screen.getByRole('link', { name: '查看學校帳號的既有收藏' }).getAttribute('href')!,
    window.location.origin,
  );
  expect(login.pathname).toBe('/login');
  expect(login.searchParams.get('reconnect')).toBe('school');
  expect(login.searchParams.get('returnUrl')).toBe(
    '/map?schoolId=pu&route=gate%2Clibrary&focus=library#directions',
  );
  const google = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
  expect(google.searchParams.has('reconnect')).toBe(false);
  expect(google.searchParams.get('returnUrl')).toBe(login.searchParams.get('returnUrl'));
  expect(screen.getByText(/登入 Google 後可在此裝置收藏地點/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '從目前位置導航' })).toBeTruthy();
  expect(loadMapFavorites).not.toHaveBeenCalled();
  expect(setMapFavorite).not.toHaveBeenCalled();
});

it('does not mark a failed or uncertain favorite as saved and reloads before retrying', async () => {
  vi.mocked(setMapFavorite).mockRejectedValueOnce(new Error('connection lost'));
  render(<MapClient school="pu" />);
  await sourceSettled();
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
  await sourceSettled();
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
  expect(screen.getByRole('link', { name: '查看校方校區平面圖' }).getAttribute('href')).toBe(
    'https://www.nthu.edu.tw/campusmap',
  );
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
  await sourceSettled();
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
  const apple = new URL(screen.getByRole('link', { name: '使用 Apple 地圖規劃路線' }).getAttribute('href')!);
  expect(apple.searchParams.get('saddr')).toBe(url.searchParams.get('origin'));
  expect(apple.searchParams.get('daddr')).toBe(url.searchParams.get('destination'));
  const clear = screen.getByRole('button', { name: '清除路線' });
  clear.focus();
  fireEvent.click(clear);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(screen.queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(screen.queryByRole('link', { name: '使用 Apple 地圖規劃路線' })).toBeNull();
});

it.each(['origin', 'destination', 'origin-building', 'destination-floor', 'unchanged'] as const)('revalidates manually chosen endpoints after the campus source syncs (%s)', async (changed) => {
  state.user = null;
  const origin = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  const destination = PROVIDENCE_CAMPUS_PLACES.find((place) => place.name === '蓋夏圖書館')!;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" focus={origin.id} />);
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋地點' }), { target: { value: destination.name } });
  fireEvent.click(screen.getByRole('button', { name: '查看' + destination.name }));
  const markers = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
  expect(markers.locations.map((place: MapLocation) => place.id)).toContain(origin.id);
  fireEvent.click(screen.getByRole('button', { name: '設為終點' }));
  expect(screen.getByRole('region', { name: '步行導航' })).toBeTruthy();

  const provisionalLogin = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
  expect(new URL(provisionalLogin.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('route')).toBeNull();
  expect(screen.getByText(/若登入或重新連結帳號，需重新選擇路線/)).toBeTruthy();

  await act(async () => source.resolve([
    { ...origin, lat: origin.lat + (changed === 'origin' ? 0.002 : 0),
      ...(changed === 'origin-building' ? { building: '測試用變更建築' } : {}) },
    { ...destination, lat: destination.lat + (changed === 'destination' ? 0.002 : 0),
      ...(changed === 'destination-floor' ? { floor: '測試用變更樓層' } : {}) },
  ]));
  const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
  const returned = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
  if (changed === 'unchanged') {
    expect(screen.getByRole('region', { name: '步行導航' })).toBeTruthy();
    expect(returned.searchParams.get('route')).toBe(origin.id + ',' + destination.id);
  } else {
    expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
    expect(returned.searchParams.get('route')).toBeNull();
    expect(screen.getByText(/原先選擇的地點已變更或無法確認/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '設為終點' })).toBeNull();
    const clear = screen.getByRole('button', { name: '清除待確認路線' });
    clear.focus();
    fireEvent.click(clear);
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
    expect(screen.queryByText(/原先選擇的地點已變更或無法確認/)).toBeNull();
  }
});

it.each([
  ['identical pair', { lat: gate.lat, lng: gate.lng }, { lat: gate.lat, lng: gate.lng }],
  ['antimeridian aliases', { lat: 10, lng: -180 }, { lat: 10, lng: 180 }],
  ['north pole', { lat: 90, lng: 10 }, { lat: 90, lng: 20 }],
  ['south pole', { lat: -90, lng: 10 }, { lat: -90, lng: 20 }],
] as const)('rejects a shared and manual walking route between physically identical points (%s)', async (_label, startCoordinate, endCoordinate) => {
  const start = { ...gate, ...startCoordinate };
  const alias = { ...gate, ...endCoordinate, id: 'same-position', name: '同座標測試點' };
  vi.mocked(loadMapLocations).mockResolvedValue([start, alias, library]);
  render(<MapClient school="other-school" route="gate,same-position" />);
  await screen.findByRole('button', { name: '查看同座標測試點' });
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route).toBeNull();
  expect(screen.getByText(/無法確認兩個不同的有效位置/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  fireEvent.click(screen.getByRole('button', { name: '查看同座標測試點' }));
  expect(screen.queryByRole('button', { name: '設為終點' })).toBeNull();
  expect(screen.getByText(/起點與終點必須為不同位置/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: '設為終點' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route.map((place: MapLocation) => place.id))
    .toEqual(['gate', 'library']);
});

it('keeps a confirmed classroom destination when a co-located origin is selected', async () => {
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  const alias = { ...gate, id: 'same-position', name: '同座標測試點', lat: classroom.lat, lng: classroom.lng };
  vi.mocked(loadMapLocations).mockResolvedValue([classroom, alias, library]);
  render(<MapClient school="pu" query="PH303" />);
  await sourceSettled();
  fireEvent.click(screen.getByRole('button', { name: '選擇步行起點' }));
  fireEvent.click(screen.getByRole('button', { name: '查看同座標測試點' }));
  expect((screen.getByRole('button', { name: '設為起點' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/起點與終點必須為不同位置/)).toBeTruthy();
  expect(screen.getByRole('region', { name: '已選擇步行終點' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route.map((place: MapLocation) => place.id))
    .toEqual(['library', classroom.id]);
});

it('does not offer a classroom route shortcut from a co-located marker', async () => {
  const classroom = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  const alias = { ...gate, id: 'same-position', name: '同座標測試點', lat: classroom.lat, lng: classroom.lng };
  vi.mocked(loadMapLocations).mockResolvedValue([classroom, alias, library]);
  render(<MapClient school="pu" query="PH303" focus={alias.id} />);
  await sourceSettled();
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  const card = within(screen.getByRole('region', { name: '教室定位結果' }));
  expect(card.queryByRole('button', { name: '將主顧樓設為終點' })).toBeNull();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect(card.getByRole('link', { name: '使用 Google 地圖前往主顧樓' })).toBeTruthy();
});

it('does not resolve a shared route with duplicate endpoint IDs', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([
    library, gate, { ...gate, name: '測試用重複識別碼', lat: gate.lat + 0.002 },
  ]);
  render(<MapClient school="other-school" route="gate,library" />);
  const markers = await screen.findByLabelText('地圖狀態');
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect(JSON.parse(markers.textContent!).route).toBeNull();
  expect(screen.getByText(/這個連結的起點或終點已不在目前地點資料中/)).toBeTruthy();
  const clear = screen.getByRole('button', { name: '清除路線' });
  clear.focus();
  fireEvent.click(clear);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(screen.queryByText(/這個連結的起點或終點已不在目前地點資料中/)).toBeNull();
  expect(JSON.parse(markers.textContent!).route).toBeNull();
});

it.each([false, true])('does not expose conflicting markers even when filtering hides one (%s)', async (reverse) => {
  const conflicting = { ...gate, name: '測試用重複識別碼', category: '教學', lat: gate.lat + 0.002 };
  const records = reverse ? [conflicting, gate] : [gate, conflicting];
  vi.mocked(loadMapLocations).mockResolvedValue([library, ...records]);
  render(<MapClient school="other-school" />);
  const markers = await screen.findByLabelText('地圖狀態');
  const ids = () => JSON.parse(markers.textContent!).locations.map((place: MapLocation) => place.id);
  expect(ids()).toEqual([library.id]);
  expect(screen.getByText(/地點識別碼重複/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看' + gate.name })).toBeNull();
  expect(screen.queryByRole('button', { name: '查看' + conflicting.name })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋地點' }), { target: { value: gate.name } });
  expect(ids()).toEqual([]);
  expect(screen.queryByRole('link', { name: '從目前位置導航' })).toBeNull();
});

it('keeps both login returns in sync with manually changed and cleared routes', async () => {
  state.user = null;
  render(<MapClient school="pu" route="gate,library" focus="library" />);
  await sourceSettled();
  const returnRoutes = () => ['用 Google 帳號收藏', '查看學校帳號的既有收藏'].map((name) => {
    const login = new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
    const destination = new URL(login.searchParams.get('returnUrl')!, window.location.origin);
    expect(destination.searchParams.get('schoolId')).toBe('pu');
    return destination.searchParams.get('route');
  });
  expect(returnRoutes()).toEqual(['gate,library', 'gate,library']);
  const reverse = screen.getByRole('button', { name: '交換起點與終點' });
  reverse.focus();
  fireEvent.click(reverse);
  expect(document.activeElement).toBe(reverse);
  expect(returnRoutes()).toEqual(['library,gate', 'library,gate']);
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route.map((place: MapLocation) => place.id)).toEqual(['library', 'gate']);
  const google = new URL(screen.getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  const apple = new URL(screen.getByRole('link', { name: '使用 Apple 地圖規劃路線' }).getAttribute('href')!);
  expect(google.searchParams.get('origin')).toBe('24.2275,120.5635');
  expect(google.searchParams.get('destination')).toBe('24.22495,120.56535');
  expect(apple.searchParams.get('saddr')).toBe(google.searchParams.get('origin'));
  expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'));
  expect(screen.getByRole('region', { name: '步行導航' }).textContent).toContain('不代表已核實的建築入口');
  fireEvent.click(reverse);
  expect(returnRoutes()).toEqual(['gate,library', 'gate,library']);
  fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  expect(screen.queryByRole('button', { name: '交換起點與終點' })).toBeNull();
  expect(returnRoutes()).toEqual([null, null]);
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  expect(returnRoutes()).toEqual([null, null]);
  const cancel = screen.getByRole('button', { name: '取消起點' });
  cancel.focus();
  fireEvent.click(cancel);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(screen.queryByText(/已設定「蓋夏圖書館」為起點/)).toBeNull();
  expect(returnRoutes()).toEqual([null, null]);
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  expect(screen.queryByRole('button', { name: '設為終點' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為終點' }));
  expect(returnRoutes()).toEqual(['library,gate', 'library,gate']);
  fireEvent.click(screen.getByRole('button', { name: '清除路線' }));
  expect(returnRoutes()).toEqual([null, null]);
});

it('keeps an untouched deep-link route in login returns when the official source fails', async () => {
  state.user = null;
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('timeout'));
  render(<MapClient school="pu" route="gate,library" />);
  await sourceSettled();
  expect(screen.getByRole('button', { name: '重新讀取地點資料' })).toBeTruthy();
  const routes = ['用 Google 帳號收藏', '查看學校帳號的既有收藏'].map((name) => {
    const login = new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
    return new URL(login.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('route');
  });
  expect(routes).toEqual(['gate,library', 'gate,library']);
});

it('preserves a pending untouched route link but drops it when the source cannot resolve it', async () => {
  state.user = null;
  const source = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(source.promise);
  render(<MapClient school="pu" route="gate,unknown" />);
  const returnRoute = () => {
    const login = new URL(screen.getByRole('link', { name: '用 Google 帳號收藏' }).getAttribute('href')!, window.location.origin);
    return new URL(login.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('route');
  };
  expect(returnRoute()).toBe('gate,unknown');
  await act(async () => source.resolve([library, gate]));
  expect(returnRoute()).toBeNull();
  expect(screen.queryByRole('region', { name: '步行導航' })).toBeNull();
  expect(screen.getByText(/這個連結的起點或終點已不在目前地點資料中/)).toBeTruthy();
  const clear = screen.getByRole('button', { name: '清除路線' });
  clear.focus();
  fireEvent.click(clear);
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜尋地點' }));
  expect(screen.queryByText(/這個連結的起點或終點已不在目前地點資料中/)).toBeNull();
  expect(returnRoute()).toBeNull();
  expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).route).toBeNull();

  // Recover without leaving the map or restoring the invalid shared link.
  fireEvent.click(screen.getByRole('button', { name: '查看正門' }));
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
  fireEvent.click(screen.getByRole('button', { name: '設為終點' }));
  expect(returnRoute()).toBe('gate,library');
  expect(screen.getByRole('region', { name: '步行導航' })).toBeTruthy();
});

it('obtains position only on request and orders nearby locations by measured straight-line distance', async () => {
  state.user = null;
  const far = { ...library, id: 'far', name: '遠方校舍', lat: 24.26, lng: 120.59 };
  vi.mocked(loadMapLocations).mockResolvedValueOnce([library, gate, far]);
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition),
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

it.each([[91, 120], [-91, 120], [24, 181], [24, -181], [NaN, 120], [24, Infinity], [0, 0], [-0, 0]])(
  'rejects invalid GPS coordinates (%s, %s), clears the nearby filter and permits retry',
  async (latitude, longitude) => {
    state.user = null;
    const callbacks: PositionCallback[] = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (callback: PositionCallback) => { callbacks.push(callback); } },
    });
    try {
      render(<MapClient school="pu" />);
      await sourceSettled();
      fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
      act(() => callbacks[0]({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition));
      const nearby = screen.getByRole('button', { name: '附近 1 公里' });
      fireEvent.click(nearby);
      expect(nearby.getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(screen.getByRole('button', { name: '更新我的位置' }));
      expect(nearby.getAttribute('aria-pressed')).toBe('false');
      expect(nearby.hasAttribute('disabled')).toBe(true);
      act(() => callbacks[1]({ coords: { latitude, longitude, accuracy: 10 } } as GeolocationPosition));
      expect(screen.getByText('定位結果無效，請重新取得位置。')).toBeTruthy();
      expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
      const google = new URL(screen.getByRole('link', { name: '從目前位置導航' }).getAttribute('href')!);
      const apple = new URL(screen.getByRole('link', { name: '使用 Apple 地圖從目前位置導航' }).getAttribute('href')!);
      expect(google.searchParams.has('origin')).toBe(false);
      expect(apple.searchParams.has('saddr')).toBe(false);

      fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
      act(() => callbacks[2]({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition));
      expect(nearby.hasAttribute('disabled')).toBe(false);
      expect(nearby.getAttribute('aria-pressed')).toBe('false');
      expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
    } finally {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    }
  },
);

it.each([101, 1000, -1, NaN, Infinity, undefined])(
  'does not use a low-quality or malformed GPS fix (accuracy %s m) for nearby results or navigation',
  async (accuracy) => {
    state.user = null;
    const callbacks: PositionCallback[] = [];
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (callback: PositionCallback) => { callbacks.push(callback); } },
    });
    try {
      render(<MapClient school="pu" />);
      await sourceSettled();
      fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
      act(() => callbacks[0]({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy } } as GeolocationPosition));
      expect(screen.getByText(/定位精度不足/)).toBeTruthy();
      expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toBeNull();
      expect(screen.getByRole('button', { name: '附近 1 公里' }).hasAttribute('disabled')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '查看蓋夏圖書館' }));
      const google = new URL(screen.getByRole('link', { name: '從目前位置導航' }).getAttribute('href')!);
      const apple = new URL(screen.getByRole('link', { name: '使用 Apple 地圖從目前位置導航' }).getAttribute('href')!);
      expect(google.searchParams.has('origin')).toBe(false);
      expect(apple.searchParams.has('saddr')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
      act(() => callbacks[1]({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 100 } } as GeolocationPosition));
      expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
      expect(screen.queryByText(/定位精度不足/)).toBeNull();
    } finally {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
      else Reflect.deleteProperty(navigator, 'geolocation');
    }
  },
);

it('lets a student stop waiting for GPS, ignores late callbacks and retries without losing a planned route', async () => {
  state.user = null;
  const callbacks: { success: PositionCallback; failure: PositionErrorCallback }[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
      callbacks.push({ success, failure });
    } },
  });
  try {
    render(<MapClient school="pu" route="gate,library" focus="library" />);
    await sourceSettled();
    const map = () => JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    const button = screen.getByRole('button', { name: '查看我的位置' });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '取消定位' })).toBe(button);
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(screen.getByText(/已停止等待定位/)).toBeTruthy();
    const position = { coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition;
    act(() => callbacks[0].success(position));
    expect(map().myLocation).toBeNull();
    expect(map().route.map((place: MapLocation) => place.id)).toEqual(['gate', 'library']);
    const link = screen.getByRole('link', { name: '從目前位置導航' });
    expect(new URL(link.getAttribute('href')!).searchParams.has('origin')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    act(() => callbacks[0].failure({ code: 1 } as GeolocationPositionError));
    expect(screen.getByRole('button', { name: '取消定位' })).toBeTruthy();
    act(() => callbacks[1].success(position));
    expect(map().myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
    expect(screen.queryByText(/已停止等待定位/)).toBeNull();
    expect(map().route.map((place: MapLocation) => place.id)).toEqual(['gate', 'library']);
  } finally {
    if (original) Object.defineProperty(navigator, 'geolocation', original);
    else Reflect.deleteProperty(navigator, 'geolocation');
  }
});

it('recovers when geolocation throws synchronously and ignores callbacks from the failed request', async () => {
  state.user = null;
  const callbacks: PositionCallback[] = [];
  const getCurrentPosition = vi.fn((callback: PositionCallback) => {
    callbacks.push(callback);
    if (callbacks.length === 1) throw new Error('Location unavailable');
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  try {
    render(<MapClient school="pu" />);
    await sourceSettled();
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    expect(screen.getByText('目前無法取得位置，請確認定位與網路後再試一次。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看我的位置' }).hasAttribute('disabled')).toBe(false);
    const position = { coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition;
    act(() => callbacks[0](position));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    act(() => callbacks[1](position));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
    act(() => callbacks[1]({ coords: { latitude: library.lat, longitude: library.lng, accuracy: 10 } } as GeolocationPosition));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
    expect(screen.queryByText('目前無法取得位置，請確認定位與網路後再試一次。')).toBeNull();
  } finally {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  }
});

it('restores every campus place when clearing the overview filters while keeping GPS and saved favorites', async () => {
  const distant = { ...gate, id: 'distant-fixture', name: '遠方校舍測試資料', lat: gate.lat + 0.1 };
  vi.mocked(loadMapLocations).mockResolvedValue([library, gate, distant]);
  vi.mocked(loadMapFavorites).mockResolvedValue(['library']);
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (callback: PositionCallback) => {
      callback({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition);
    } },
  });
  try {
    render(<MapClient school="pu" />);
    await sourceSettled();
    const favorites = screen.getByRole('button', { name: '只看收藏' });
    await waitFor(() => expect(favorites.hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '查看我的位置' }));
    const nearby = screen.getByRole('button', { name: '附近 1 公里' });
    fireEvent.click(nearby);
    fireEvent.click(favorites);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '圖書館' } });
    expect(screen.queryByRole('button', { name: '查看遠方校舍測試資料' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看正門' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '看整個校園' }));
    expect(nearby.getAttribute('aria-pressed')).toBe('false');
    expect(favorites.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '查看遠方校舍測試資料' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看正門' })).toBeTruthy();
    const map = JSON.parse(screen.getByLabelText('地圖狀態').textContent!);
    expect(map.locations.map((place: MapLocation) => place.id)).toContain(distant.id);
    expect(map.myLocation).toEqual({ lat: gate.lat, lng: gate.lng });
    expect(screen.getByRole('button', { name: '取消收藏蓋夏圖書館' })).toBeTruthy();
    expect(setMapFavorite).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(navigator, 'geolocation', original);
    else Reflect.deleteProperty(navigator, 'geolocation');
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
    act(() => resolve({ coords: { latitude: 24, longitude: 120, accuracy: 10 } } as GeolocationPosition));
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
    act(() => callbacks[0]({ coords: { latitude: library.lat, longitude: library.lng, accuracy: 10 } } as GeolocationPosition));
    fireEvent.click(screen.getByRole('button', { name: '更新我的位置' }));
    act(() => callbacks[0]({ coords: { latitude: 0, longitude: 0, accuracy: 10 } } as GeolocationPosition));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toBeNull();
    act(() => callbacks[1]({ coords: { latitude: gate.lat, longitude: gate.lng, accuracy: 10 } } as GeolocationPosition));
    expect(JSON.parse(screen.getByLabelText('地圖狀態').textContent!).myLocation).toEqual({
      lat: gate.lat,
      lng: gate.lng,
    });
  } finally {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  }
});


it('offers the official floor guide only for the Providence library', async () => {
  state.user = null;
  const view = render(<MapClient school="pu" />);
  await sourceSettled();
  fireEvent.click(await screen.findByRole('button', { name: '查看蓋夏圖書館' }));
  const link = screen.getByRole('link', { name: '查看校方樓層導覽' });
  expect(link.getAttribute('href')).toBe('https://b028.pu.edu.tw/p/426-1054-34.php?Lang=zh-tw');
  expect(link.getAttribute('target')).toBe('_blank');
  view.rerender(<MapClient school="nthu" />);
  await screen.findByRole('button', { name: '查看蓋夏圖書館' });
  expect(screen.queryByRole('link', { name: '查看校方樓層導覽' })).toBeNull();
});


it('keeps the official campus plan available when published POIs fail to load', async () => {
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('offline'));
  render(<MapClient school="nthu" schoolName="國立清華大學" />);
  expect(await screen.findByText('暫時無法取得校園地點')).toBeTruthy();
  const link = screen.getByRole('link', { name: '查看校方校區平面圖' });
  expect(link.getAttribute('href')).toBe('https://www.nthu.edu.tw/campusmap');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.queryByRole('button', { name: '查看蓋夏圖書館' })).toBeNull();
});

it('shows bundled Providence places before the published source answers', async () => {
  vi.mocked(loadMapLocations).mockReturnValueOnce(new Promise(() => {}));
  render(<MapClient school="pu" schoolName="靜宜大學" />);
  expect(screen.queryByText(/正在載入校園地點/)).toBeNull();
  expect(screen.getByRole('button', { name: '查看文興樓' })).toBeTruthy();
  expect(screen.getByText(/正在同步校方地點資料/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '校方校區平面圖' })).toBeTruthy();
});

it('keeps bundled Providence places with a clear retry when the published source fails or times out', async () => {
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('Map source timed out'));
  render(<MapClient school="pu" schoolName="靜宜大學" />);
  expect(await screen.findByText(/校方地點資料暫時讀不到/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看文興樓' })).toBeTruthy();
  expect(screen.queryByText('暫時無法取得校園地點')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取地點資料' }));
  expect(screen.getByRole('button', { name: '查看文興樓' })).toBeTruthy();
  await sourceSettled();
  expect(screen.queryByText(/校方地點資料暫時讀不到/)).toBeNull();
  expect(await screen.findByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
  expect(loadMapLocations).toHaveBeenCalledTimes(2);
});

it('does not report a deep-link place as missing while the published source is still syncing', async () => {
  const loading = deferred<MapLocation[]>();
  vi.mocked(loadMapLocations).mockReturnValueOnce(loading.promise);
  render(<MapClient school="pu" route="gate,library" focus="library" />);
  expect(screen.queryByText(/已不在目前地點資料中|找不到連結指定的地點/)).toBeNull();
  await act(async () => loading.resolve([library, gate]));
  expect(screen.getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('lets visitors compare mapped Providence points with the official campus plan without selecting a pin', async () => {
  state.user = null;
  render(<MapClient school="pu" schoolName="靜宜大學" />);
  expect(await screen.findByRole('link', { name: '校方校區平面圖' })).toBeTruthy();
});

it('puts search then the map on the first screen, with source collapsed below', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  const root = await screen.findByLabelText('地圖狀態');
  expect(root.closest('[data-map-first-screen="true"]')).toBeTruthy();
  const search = screen.getByRole('searchbox', { name: '搜尋地點' });
  const locate = screen.getByRole('button', { name: '查看我的位置' });
  const source = screen.getByRole('region', { name: '地圖資料來源' });
  const categories = screen.getByLabelText('地點分類');
  expect(search.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(locate.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(root.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(source.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const details = source.querySelector('details');
  expect(details).toBeTruthy();
  expect(details?.open).toBe(false);
  expect(screen.getByText('靜宜地圖資料來源與步行分鐘算法')).toBeTruthy();
  expect(screen.getByText(/OpenStreetMap 貢獻者資料/)).toBeTruthy();
});

it('finds verified dorm and print places without claiming public toilets', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  const input = await screen.findByRole('searchbox', { name: '搜尋地點' });
  fireEvent.change(input, { target: { value: '宿舍' } });
  expect(screen.getByRole('button', { name: '查看希嘉學苑' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看思高學苑' })).toBeTruthy();
  expect(screen.queryByText('善牧學苑')).toBeNull();
  fireEvent.change(input, { target: { value: '廁所' } });
  expect(screen.queryByRole('button', { name: '查看希嘉學苑' })).toBeNull();
  expect(screen.queryByRole('button', { name: '查看思高學苑' })).toBeNull();
  expect(screen.getByText('沒有符合條件的地點。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '校方校區平面圖' })).toBeTruthy();
  fireEvent.change(input, { target: { value: '影印' } });
  expect(screen.getByRole('button', { name: '查看蓋夏圖書館' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看至善樓' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看主顧樓' })).toBeNull();
});

it('explains walking minutes from the campus gate using a straight-line formula', async () => {
  vi.mocked(loadMapLocations).mockResolvedValue([]);
  render(<MapClient school="pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看希嘉學苑' }));
  expect(screen.getAllByText(/從校園出入口（OpenStreetMap 閘門標記）直線約/).length).toBeGreaterThan(
    0,
  );
  expect(screen.getAllByText(/每分鐘 80 公尺/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/不是導航路線時間/).length).toBeGreaterThan(0);
});

it('shows each school its own official map rather than reusing Providence', async () => {
  state.user = null;
  const view = render(<MapClient school="nthu" schoolName="國立清華大學" />);
  await screen.findByRole('button', { name: '查看蓋夏圖書館' });
  expect(screen.getByRole('link', { name: '校方校區平面圖' }).getAttribute('href')).toBe(
    'https://www.nthu.edu.tw/campusmap',
  );
  view.rerender(<MapClient school="tw-demo-uni" schoolName="示範大學" />);
  await screen.findByRole('button', { name: '查看蓋夏圖書館' });
  expect(screen.queryByRole('link', { name: '校方校區平面圖' })).toBeNull();
  expect(screen.queryByRole('link', { name: '查看校方校區平面圖' })).toBeNull();
});

it('does not restore a manually chosen provisional route across login after source failure', async () => {
  state.user = null;
  const origin = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  const destination = PROVIDENCE_CAMPUS_PLACES.find((place) => place.name === '蓋夏圖書館')!;
  vi.mocked(loadMapLocations).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([origin, destination]);
  render(<MapClient school="pu" focus={origin.id} />);
  fireEvent.click(screen.getByRole('button', { name: '設為起點' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋地點' }), { target: { value: destination.name } });
  fireEvent.click(screen.getByRole('button', { name: '查看' + destination.name }));
  fireEvent.click(screen.getByRole('button', { name: '設為終點' }));
  await sourceSettled();
  const returnRoutes = () => ['用 Google 帳號收藏', '查看學校帳號的既有收藏'].map(name => {
    const link = new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
    return new URL(link.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('route');
  });
  expect(screen.getByRole('region', { name: '步行導航' })).toBeTruthy();
  expect(returnRoutes()).toEqual([null, null]);
  const returnFocuses = () => ['用 Google 帳號收藏', '查看學校帳號的既有收藏'].map(name => {
    const link = new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
    return new URL(link.searchParams.get('returnUrl')!, window.location.origin).searchParams.get('focus');
  });
  expect(returnFocuses()).toEqual([null, null]);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取地點資料' }));
  await sourceSettled();
  expect(returnRoutes()).toEqual([origin.id + ',' + destination.id, origin.id + ',' + destination.id]);
  expect(returnFocuses()).toEqual([destination.id, destination.id]);
  expect(screen.queryByText(/若登入或重新連結帳號，需重新選擇路線/)).toBeNull();
});
