import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CampusSpatialExplorer from './CampusSpatialExplorer';
import type { MapLocation } from './mapService';
import { PROVIDENCE_CAMPUS_PLACES } from './providenceCampus';
import { parseProvidenceOsmFootprints } from './providenceFootprints';
import { DEFAULT_SPATIAL_BEARING, MAX_SPATIAL_ZOOM, MIN_SPATIAL_ZOOM } from './campusSpatialCamera';

const scene = vi.hoisted(() => ({
  create: vi.fn(),
  setView: vi.fn(),
  setActive: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./campusSpatialScene', () => ({ createCampusSpatialScene: scene.create }));

const places: MapLocation[] = [
  { id: 'library', name: '本校圖書館', category: '圖書館', description: '借書與自習', lat: 24.226, lng: 120.58 },
  { id: 'dorm', name: '本校宿舍', category: '住宿', description: '住宿區', lat: 24.228, lng: 120.582 },
];
const media = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
let intersection: IntersectionObserverCallback | null = null;
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  media.clear();
  intersection = null;
  scene.create.mockImplementation(() => scene);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() { this.removeAttribute('open'); },
  });
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!media.has(query)) media.set(query, { matches: false, listeners: new Set() });
    const value = media.get(query)!;
    return {
      get matches() { return value.matches; },
      addEventListener: (_: string, callback: () => void) => value.listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) => value.listeners.delete(callback),
    };
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-reduced-motion');
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

async function open() {
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  return screen.getByRole('dialog', { name: '校園空間導覽' });
}

it('opens graphics only on request, uses the current places, and leaves selection unchanged on close', async () => {
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={onSelect} />);
  const opener = screen.getByRole('button', { name: '空間導覽' });
  opener.focus();
  expect(scene.create).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  const dialog = await open();
  expect(scene.create.mock.calls[0][1].points.map((point: { id: string }) => point.id)).toEqual(['library', 'dorm']);
  expect(screen.queryByText('主顧樓')).toBeNull();
  expect(within(dialog).getByText(/不代表建築外觀或室內動線/)).toBeTruthy();
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(scene.setView).toHaveBeenLastCalledWith({ selectedId: null, overhead: false, motion: true, dark: false, bearing: DEFAULT_SPATIAL_BEARING, zoom: 1 });
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(opener);
});

it('connects scene markers, the progress control, directions and the original map selection', async () => {
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={onSelect} />);
  const dialog = await open();
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'library' }));
  const callbacks = scene.create.mock.calls[0][2];
  act(() => callbacks.onSelect('dorm'));
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  const directions = new URL(within(dialog).getByRole('link', { name: '開啟步行導航' }).getAttribute('href')!);
  expect(directions.searchParams.get('destination')).toBe('24.228,120.582');
  expect(directions.searchParams.get('travelmode')).toBe('walking');
  expect(within(dialog).getByRole('button', { name: '下一個地點' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(within(dialog).getByRole('slider'), { target: { value: '0' } });
  expect(within(dialog).getByRole('slider').getAttribute('aria-valuetext')).toContain('本校圖書館');
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '俯視' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', overhead: true }));
  fireEvent.click(within(dialog).getByRole('button', { name: '在平面地圖查看' }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(places[1]);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
});

it('controls camera without changing the place or recreating its context and resets framing after selection', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).tabIndex).toBe(0);
  fireEvent.click(within(dialog).getByRole('button', { name: '向右旋轉' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'library', bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1.25 }));
  expect(within(dialog).getByText('縮放 125%')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '看全部地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null, bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '回到北向' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 0, zoom: 1 }));
  expect(within(dialog).getByText('畫面北向').parentElement?.querySelector('g')?.getAttribute('transform')).toBe('rotate(0 20 20)');
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('reflects gesture camera changes in accessible bounded controls without reloading graphics', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const changed = scene.create.mock.calls[0][2].onCameraChange;
  act(() => changed({ bearing: 420, zoom: 9 }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 60, zoom: MAX_SPATIAL_ZOOM }));
  expect(within(dialog).getByRole('button', { name: '放大空間圖' }).getAttribute('aria-disabled')).toBe('true');
  expect(within(dialog).getByText('縮放 250%')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '向左旋轉' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 30, zoom: MAX_SPATIAL_ZOOM }));
  act(() => changed({ bearing: -60, zoom: 0 }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 300, zoom: MIN_SPATIAL_ZOOM }));
  expect(within(dialog).getByRole('button', { name: '縮小空間圖' }).getAttribute('aria-disabled')).toBe('true');
  expect(within(dialog).getByRole('heading', { name: '本校圖書館' })).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('keeps real place information and navigation available after WebGL failure and permits a retry', async () => {
  scene.create.mockImplementationOnce(() => { throw new Error('WebGL unavailable'); });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/這次無法顯示立體畫面/)).toBeTruthy();
  expect(within(dialog).getByRole('group', { name: '校園地點空間圖' }).tabIndex).toBe(-1);
  expect(within(dialog).queryByRole('group', { name: '調整空間視角' })).toBeNull();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '重試立體畫面' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm' }));
});

it('disposes a lost graphics context and retains the selected place', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[1]} onSelect={vi.fn()} />);
  const dialog = await open();
  act(() => scene.create.mock.calls[0][2].onError());
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(scene.dispose).toHaveBeenCalledTimes(1);
});

it('does not create a late scene after closing during the import', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  fireEvent.click(screen.getByRole('button', { name: '關閉視窗' }));
  await act(async () => {});
  expect(scene.create).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('applies live system and site motion preferences without recreating the graphics context', async () => {
  document.documentElement.dataset.reducedMotion = 'true';
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: false }));
  await act(async () => { document.documentElement.dataset.reducedMotion = 'false'; });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: true }));
  act(() => {
    const reduced = media.get('(prefers-reduced-motion: reduce)')!;
    reduced.matches = true;
    reduced.listeners.forEach((notify) => notify());
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', motion: false }));
  await act(async () => { document.documentElement.dataset.theme = 'dark'; });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ dark: true, motion: false }));
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('suspends graphics when the page is hidden or the canvas is outside the viewport', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  await open();
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    intersection?.([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => intersection?.([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
});

it('preserves single-source warnings and their exact source links', async () => {
  const parking = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-parking-p1')!;
  render(<CampusSpatialExplorer school="pu" locations={[parking]} selected={parking} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(within(dialog).getByText(/僅有單一資料來源/)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '查看地點資料來源 ↗' }).getAttribute('href')).toBe(parking.sourceUrl);
  expect(within(dialog).getByRole('slider').hasAttribute('disabled')).toBe(true);
  expect(within(dialog).getByRole('button', { name: '上一個地點' }).hasAttribute('disabled')).toBe(true);
});

it('does not offer an empty tour and rejects points spread across distant campuses', async () => {
  const view = render(<CampusSpatialExplorer school="other-school" locations={[]} selected={null} onSelect={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '空間導覽' })).toBeNull();
  view.rerender(<CampusSpatialExplorer school="other-school" locations={[places[0], { ...places[1], lat: 25.04, lng: 121.53 }]} selected={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  expect(screen.getByText(/範圍超出單一校區/)).toBeTruthy();
  expect(scene.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回平面地圖' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('destroys old-school graphics and exposes only the replacement school after remounting', async () => {
  const view = render(<CampusSpatialExplorer key="school-a" school="school-a" locations={places} selected={null} onSelect={vi.fn()} />);
  await open();
  const replacement = { ...places[0], id: 'new-library', name: '另一校圖書館' };
  view.rerender(<CampusSpatialExplorer key="school-b" school="school-b" locations={[replacement]} selected={null} onSelect={vi.fn()} />);
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '空間導覽' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('option', { name: '另一校圖書館' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('請選擇地點');
  expect(screen.queryByRole('heading', { name: '本校圖書館' })).toBeNull();
  expect(scene.create.mock.calls[1][1].points.map((point: { id: string }) => point.id)).toEqual(['new-library']);
});

it('closes an emptied tour and does not reopen it when location data returns', async () => {
  const props = { school: 'other-school', selected: null, onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} locations={places} />);
  await open();
  view.rerender(<CampusSpatialExplorer {...props} locations={[]} />);
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  view.rerender(<CampusSpatialExplorer {...props} locations={places} />);
  expect(screen.getByRole('button', { name: '空間導覽' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('withdraws inherited navigation when a source makes the original automatic match ambiguous', async () => {
  const props = { school: 'other-school', onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} locations={places} selected={places[0]} />);
  const dialog = await open();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  // The old ID can still exist; the parent has withdrawn its automatic choice.
  view.rerender(<CampusSpatialExplorer {...props} locations={places} selected={null} />);
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null }));
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  view.rerender(<CampusSpatialExplorer {...props} locations={[...places]} selected={null} />);
  expect(within(dialog).getByRole('heading', { name: '本校宿舍' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('requires a fresh choice when the selected location disappears instead of using the first replacement', async () => {
  const props = { school: 'other-school', onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} locations={places} selected={places[0]} />);
  const dialog = await open();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'dorm' } });
  const replacement = { ...places[1], id: 'replacement-dorm' };
  view.rerender(<CampusSpatialExplorer {...props} locations={[replacement]} selected={null} />);
  expect(within(dialog).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  expect(within(dialog).queryByRole('heading', { name: '本校宿舍' })).toBeNull();
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('');
  expect(within(dialog).getByRole('button', { name: '看全部地點' }).getAttribute('aria-pressed')).toBe('true');
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null }));
});

it('opens a scoped building preview with one dialog and releases the campus graphics', async () => {
  const onSelect = vi.fn();
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={onSelect} />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: '平面圖建模預覽' }));
  const preview = await screen.findByRole('dialog', { name: '平面圖建模預覽' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.queryByRole('dialog', { name: '校園空間導覽' })).toBeNull();
  expect(preview.textContent).toContain('本校圖書館');
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(within(preview).queryByRole('link', { name: '開啟步行導航' })).toBeNull();
  fireEvent.click(within(preview).getByRole('button', { name: '關閉視窗' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '本校圖書館' })).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});

it('drops a building preview when its selected campus location is withdrawn', async () => {
  const props = { school: 'other-school', locations: places, onSelect: vi.fn() };
  const view = render(<CampusSpatialExplorer {...props} selected={places[0]} />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: '平面圖建模預覽' }));
  await screen.findByRole('dialog', { name: '平面圖建模預覽' });
  view.rerender(<CampusSpatialExplorer {...props} selected={null} />);
  expect(screen.queryByRole('dialog', { name: '平面圖建模預覽' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '校園空間導覽' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '平面圖建模預覽' })).toBeNull();
});

it('adds source-checked Providence building shapes without changing navigation or hiding source dates', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  let resolveFetch: ((value: unknown) => void) | undefined;
  const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(fetchMock).toHaveBeenCalledWith('/api/public/campus-footprints', expect.objectContaining({ signal: expect.anything() }));
  expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
  const outline = [
    { lat: 24.22624, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58131 },
  ];
  const buildings = parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry: outline,
      tags: { building: 'yes' }, version: 7, timestamp: '2026-10-15T08:09:10Z' }],
  });
  await act(async () => {
    resolveFetch?.({ ok: true, json: async () => ({
      schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt: new Date().toISOString(), stale: false,
    }) });
  });
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).getByText(/2026-11-09/)).toBeTruthy();
  expect(within(dialog).getByText(/OSM way 版本 v7.*2026-10-15/)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('keeps the spatial map usable when Providence building geometry is unavailable', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: '在平面地圖查看' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
});

it('rejects an expired OSM API snapshot while keeping the known place and walking directions', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const outline = [
    { lat: 24.22624, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58143 },
    { lat: 24.22634, lon: 120.58131 },
    { lat: 24.22624, lon: 120.58131 },
  ];
  const buildings = parseProvidenceOsmFootprints({
    elements: [{ type: 'way', id: 255784049, geometry: outline, tags: { building: 'yes' } }],
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, json: async () => ({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      stale: false,
    }),
  }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});
