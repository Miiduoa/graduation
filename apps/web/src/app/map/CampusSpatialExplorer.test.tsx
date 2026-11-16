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
  const directionLink = within(dialog).getByRole('link', { name: '開啟步行導航' });
  const directions = new URL(directionLink.getAttribute('href')!);
  expect(directions.searchParams.get('destination')).toBe('24.228,120.582');
  expect(directions.searchParams.get('travelmode')).toBe('walking');
  // A point location is not a surveyed entrance or an accessible walking path.
  // The on-screen warning must also be linked to the outgoing route for assistive tech.
  const warning = within(dialog).getByText(/導航僅以目前地點標記為目的地.*並非已核實的校舍入口/);
  expect(directionLink.getAttribute('aria-describedby')).toBe(warning.id);
  expect(warning.textContent).toContain('無障礙動線');
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
  const scaleAnnouncement = within(dialog).getByText('視角方位 57° · 縮放 125%');
  expect(scaleAnnouncement.getAttribute('role')).toBe('status');
  expect(scaleAnnouncement.getAttribute('aria-live')).toBe('polite');
  expect(scaleAnnouncement.getAttribute('aria-atomic')).toBe('true');
  fireEvent.click(within(dialog).getByRole('button', { name: '下一個地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'dorm', bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '看全部地點' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null, bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '放大空間圖' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: DEFAULT_SPATIAL_BEARING + 30, zoom: 1.25 }));
  fireEvent.click(within(dialog).getByRole('button', { name: '回到北向' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 0, zoom: 1.25 }));
  expect(within(dialog).getByText('視角方位 0° · 縮放 125%')).toBeTruthy();
  expect(within(dialog).getByText('畫面北向').parentElement?.querySelector('g')?.getAttribute('transform')).toBe('rotate(0 20 20)');
  const restoreZoom = within(dialog).getByRole('button', { name: '還原 100% 縮放' }) as HTMLButtonElement;
  expect(restoreZoom.disabled).toBe(false);
  fireEvent.click(restoreZoom);
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: null, bearing: 0, zoom: 1 }));
  expect(within(dialog).getByText('視角方位 0° · 縮放 100%')).toBeTruthy();
  expect(restoreZoom.disabled).toBe(true);
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('reflects gesture camera changes in accessible bounded controls without reloading graphics', async () => {
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const changed = scene.create.mock.calls[0][2].onCameraChange;
  act(() => changed({ bearing: 420, zoom: 9 }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 60, zoom: MAX_SPATIAL_ZOOM }));
  const zoomIn = within(dialog).getByRole('button', { name: '放大空間圖' }) as HTMLButtonElement;
  expect(zoomIn.disabled).toBe(true);
  expect(zoomIn.hasAttribute('aria-disabled')).toBe(false);
  const callsAtMaximum = scene.setView.mock.calls.length;
  fireEvent.click(zoomIn);
  expect(scene.setView).toHaveBeenCalledTimes(callsAtMaximum);
  expect(within(dialog).getByText('視角方位 60° · 縮放 250%')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '向左旋轉' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 30, zoom: MAX_SPATIAL_ZOOM }));
  expect(within(dialog).getByText('視角方位 30° · 縮放 250%')).toBeTruthy();
  act(() => changed({ bearing: -60, zoom: 0 }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 300, zoom: MIN_SPATIAL_ZOOM }));
  expect(within(dialog).getByText('視角方位 300° · 縮放 65%')).toBeTruthy();
  const zoomOut = within(dialog).getByRole('button', { name: '縮小空間圖' }) as HTMLButtonElement;
  expect(zoomOut.disabled).toBe(true);
  expect(zoomOut.hasAttribute('aria-disabled')).toBe(false);
  const callsAtMinimum = scene.setView.mock.calls.length;
  fireEvent.click(zoomOut);
  expect(scene.setView).toHaveBeenCalledTimes(callsAtMinimum);
  const restoreZoom = within(dialog).getByRole('button', { name: '還原 100% 縮放' }) as HTMLButtonElement;
  expect(restoreZoom.disabled).toBe(false);
  fireEvent.click(restoreZoom);
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'library', bearing: 300, zoom: 1 }));
  expect(within(dialog).getByText('視角方位 300° · 縮放 100%')).toBeTruthy();
  expect(restoreZoom.disabled).toBe(true);
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

it('keeps motion and theme preferences reactive on Safari with legacy MediaQueryList listeners', async () => {
  const legacyMedia = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  vi.stubGlobal('matchMedia', (query: string) => {
    if (!legacyMedia.has(query)) legacyMedia.set(query, { matches: false, listeners: new Set() });
    const entry = legacyMedia.get(query)!;
    return {
      get matches() { return entry.matches; },
      // Older iOS Safari exposes only addListener/removeListener.
      addListener: (notify: () => void) => entry.listeners.add(notify),
      removeListener: (notify: () => void) => entry.listeners.delete(notify),
    };
  });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={places[0]} onSelect={vi.fn()} />);
  const dialog = await open();
  const motion = legacyMedia.get('(prefers-reduced-motion: reduce)')!;
  const theme = legacyMedia.get('(prefers-color-scheme: dark)')!;
  expect(motion.listeners.size).toBe(1);
  expect(theme.listeners.size).toBe(1);
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: true, dark: false }));
  act(() => {
    motion.matches = true;
    motion.listeners.forEach((notify) => notify());
  });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: false, dark: false }));
  act(() => {
    theme.matches = true;
    theme.listeners.forEach((notify) => notify());
  });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ motion: false, dark: true }));
  expect(scene.create).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  expect(motion.listeners.size).toBe(0);
  expect(theme.listeners.size).toBe(0);
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
  // The camera now has its own live status; scope this assertion to the
  // place guidance so adding accessible announcements cannot break school isolation.
  const guidance = within(screen.getByRole('dialog', { name: '校園空間導覽' }))
    .getByText('請選擇地點，確認位置後再開啟導航。');
  expect(guidance.getAttribute('role')).toBe('status');
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
  // Only the loading state belongs to the live region, not its source links.
  expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/).getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' }).closest('[role="status"]')).toBeNull();
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
  const fetchedAt = new Date().toISOString();
  const osmBaseAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60 * 60 * 1000)
    .toISOString().replace('.000Z', 'Z');
  await act(async () => {
    resolveFetch?.({ ok: true, json: async () => ({
      schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false, osmBaseAt,
    }) });
  });
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings);
  expect(within(dialog).getByText(/1 棟公開建築輪廓/).getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('link', { name: '靜宜官方校園圖與實境導覽' }).closest('[role="status"]')).toBeNull();
  // Both provenance labels can show the same calendar day; anchor by meaning.
  expect(within(dialog).getByText(new RegExp(`^資料讀取：${fetchedAt.slice(0, 10)}`))).toBeTruthy();
  expect(within(dialog).getByText(new RegExp(`OSM 資料庫同步：${osmBaseAt.slice(0, 10)}.*非現地查證`))).toBeTruthy();
  expect(within(dialog).getByText(/高度：12 公尺示意.*無 OSM 高度標註.*非實際樓高/)).toBeTruthy();
  expect(within(dialog).getByText(/OSM way 版本 v7.*2026-10-15/)).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '© OpenStreetMap 貢獻者' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('falls back after 15 seconds even if an OSM proxy ignores abort, and ignores late success', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  let signal: AbortSignal | undefined;
  let resolveFetch: ((value: { ok: true; json: () => Promise<unknown> }) => void) | undefined;
  // Simulate a response that ignores AbortSignal entirely: abort alone must
  // never leave the campus browser stuck on its loading message.
  vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => {
    signal = init.signal;
    return new Promise<{ ok: true; json: () => Promise<unknown> }>((resolve) => {
      resolveFetch = resolve;
    });
  }));
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
    const callback = timeoutSpy.mock.calls.find(([, delay]) => delay === 15_000)?.[0];
    expect(typeof callback).toBe('function');
    await act(async () => { (callback as () => void)(); });
    expect(signal?.aborted).toBe(true);
    expect(within(dialog).getByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create).toHaveBeenCalledTimes(1);
    expect(scene.create.mock.calls[0][2].footprints).toEqual([]);

    // The request may finally finish after the visible timeout. A valid late
    // snapshot must not revive the expired request or silently change the map.
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
    expect(buildings).toHaveLength(1);
    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date().toISOString(), stale: false,
      }) });
    });
    expect(within(dialog).getByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(scene.create).toHaveBeenCalledTimes(1);
  } finally {
    timeoutSpy.mockRestore();
  }
});

it.each([
  { status: 203, contentRange: null },
  { status: 206, contentRange: 'bytes 0-119/250' },
  { status: 200, contentRange: 'bytes 0-119/250' },
])('rejects a transformed or ranged OSM API response ($status, $contentRange)', async ({ status, contentRange }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const response = new Response(JSON.stringify({
    schoolId: 'pu', source: 'OpenStreetMap', buildings,
    fetchedAt: new Date().toISOString(), stale: false,
  }), {
    status,
    headers: contentRange ? { 'Content-Range': contentRange } : undefined,
  });
  // Response.ok is true for every synthetic case; status alone cannot be
  // inferred from ok, and parsing must not begin for these untrusted bodies.
  expect(response.ok).toBe(true);
  const json = vi.spyOn(response, 'json');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(json).not.toHaveBeenCalled();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('keeps the spatial map usable when Providence building geometry is unavailable', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const unavailableNotice = await within(dialog).findByText(/公開建築輪廓目前無法取得/);
  expect(unavailableNotice.getAttribute('role')).toBe('status');
  expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }).closest('[role="status"]')).toBeNull();
  expect(within(dialog).getByRole('button', { name: '在平面地圖查看' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
});

it('keeps real campus navigation when a tampered API snapshot repeats a verified building', async () => {
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
      schoolId: 'pu', source: 'OpenStreetMap',
      fetchedAt: new Date().toISOString(), stale: false,
      buildings: [buildings[0], { ...buildings[0], heightMeters: 90, heightBasis: 'osm-tag' }],
    }),
  }));
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' })).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(scene.create.mock.calls[0][2].footprints).toEqual([]);
});

it('honors the API Retry-After cooldown without hammering Overpass or blocking navigation', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: false, status: 503,
      headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
    }) });
  vi.stubGlobal('fetch', fetchMock);
  // The scheduled callback must run after the absolute wall-clock deadline.
  // Invoking a timer early must never bypass a server cooldown.
  let now = Date.now();
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 10 分鐘冷卻，到期後可再試/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Use the actual scheduled cooldown callback instead of advancing every
    // unrelated React and graphics timer. This is a synthetic server response,
    // not a real public Overpass rate-limit observation.
    const release = timeoutSpy.mock.calls.find(([, delay]) => typeof delay === 'number' && delay >= 599_000 && delay <= 600_000)?.[0];
    expect(typeof release).toBe('function');
    now += 600_001;
    await act(async () => { (release as () => void)(); });
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/約 10 分鐘冷卻，到期後可再試/)).toBeNull();
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }
});

it.each([
  { status: 429, kind: 'delay-seconds', header: '600', minutes: 10 },
  { status: 503, kind: 'HTTP-date', header: null, minutes: 10 },
  { status: 429, kind: 'zero-padded delay-seconds', header: '00000600', minutes: 10 },
  { status: 503, kind: 'long delay-seconds capped to 24h', header: '1000000', minutes: 1440 },
])('does not repeatedly retry a rate-limited OSM source ($status, $kind)', async ({ status, kind, header, minutes }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  // RFC 9110 permits leading zeroes and arbitrarily long digit strings.
  // The client limits a genuine wait to 24h; these are synthetic responses,
  // not observed Overpass headers.
  const retryAfter = kind === 'HTTP-date'
    ? new Date(Date.now() + 10 * 60_000).toUTCString()
    : header;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status,
    headers: { get: (name: string) => name === 'retry-after' ? retryAfter : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(new RegExp(`約 ${minutes} 分鐘冷卻，到期後可再試`))).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
});

it.each([
  { status: 206, contentRange: 'bytes 0-63/4096' },
  { status: 408, contentRange: null },
  { status: 502, contentRange: null },
  { status: 504, contentRange: null },
  { status: 200, contentRange: 'bytes 0-63/4096' },
])('honors Retry-After on rejected incomplete or gateway footprints ($status)', async ({ status, contentRange }) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const json = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    headers: { get: (name: string) =>
      name === 'retry-after' ? '600' : name === 'content-range' ? contentRange : null },
    json,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 10 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(json).not.toHaveBeenCalled();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

// A suspended/incorrectly configured phone may disagree with the response
// server's Date header. HTTP-date Retry-After is on the origin's time scale.
// These are synthetic 429/503 responses, not real Overpass observations.
it.each([
  { status: 429, serverOffsetMinutes: -20, retryOffsetMinutes: -10, expectedMinutes: 10 },
  { status: 503, serverOffsetMinutes: 20, retryOffsetMinutes: 30, expectedMinutes: 30 },
  { status: 429, serverOffsetMinutes: null, retryOffsetMinutes: 10, expectedMinutes: 10 },
])('keeps the longer valid HTTP-date cooldown with clock skew ($status, server $serverOffsetMinutes)',
  async ({ status, serverOffsetMinutes, retryOffsetMinutes, expectedMinutes }) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const now = Date.now();
    const serverDate = serverOffsetMinutes === null ? 'invalid Date'
      : new Date(now + serverOffsetMinutes * 60_000).toUTCString();
    const retryDate = new Date(now + retryOffsetMinutes * 60_000).toUTCString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status,
      headers: { get: (name: string) =>
        name === 'retry-after' ? retryDate : name === 'date' ? serverDate : null },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(new RegExp(`約 ${expectedMinutes} 分鐘冷卻，到期後可再試`))).toBeTruthy();
    fireEvent.click(retry);
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  });

// 408s, incomplete intermediary responses (206 or Content-Range on a 200),
// and gateway failures may omit Retry-After. A one-minute local backoff avoids
// repeated requests while original POIs and walking directions stay usable.
// These are synthetic proxy responses, not observed Overpass behavior.
it.each([
  { status: 206, retryAfter: null, contentRange: null },
  { status: 206, retryAfter: null, contentRange: 'bytes 0-63/4096' },
  { status: 200, retryAfter: null, contentRange: 'bytes 0-63/4096' },
  { status: 408, retryAfter: null, contentRange: null },
  { status: 502, retryAfter: null, contentRange: null },
  { status: 503, retryAfter: null, contentRange: null },
  { status: 503, retryAfter: 'invalid HTTP-date', contentRange: null },
  { status: 504, retryAfter: null, contentRange: null },
])('backs off an incomplete or failed OSM response without usable Retry-After ($status, $retryAfter, $contentRange)',
  async ({ status, retryAfter, contentRange }) => {
    const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300, status,
      headers: { get: (name: string) => name === 'retry-after' ? retryAfter :
        name === 'content-range' ? contentRange : null },
      json,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
    fireEvent.click(retry);
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  });

it('allows a single retry when an unlabelled 503 gateway cooldown expires', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503, headers: { get: () => null },
  });
  vi.stubGlobal('fetch', fetchMock);
  // The scheduled callback must run after the absolute wall-clock deadline.
  // Invoking a timer early must never bypass a server cooldown.
  let now = Date.now();
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    const release = timeoutSpy.mock.calls.find(([, delay]) =>
      typeof delay === 'number' && delay >= 59_000 && delay <= 60_000)?.[0];
    expect(typeof release).toBe('function');
    now += 60_001;
    await act(async () => { (release as () => void)(); });
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }
});

// These are synthetic intermediary 429s, not observations from Overpass.
// 429 may omit Retry-After entirely; invalid/expired values also must not
// invite a rapid manual retry loop. A one-minute client backoff protects the
// API without treating malformed headers as arbitrary 24-hour lockouts.
it.each([
  'Sun, 32 Nov 2026 01:02:03 GMT',
  'Sun, 01 Nov 2026 01:02:03 GMT',
  'not a date',
  '0',
  null,
])('backs off a 429 without a usable Retry-After (%s)', async (retryAfter) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 429,
    headers: { get: (name: string) => name === 'retry-after' ? retryAfter : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
  expect(within(dialog).getByText(/約 1 分鐘冷卻，到期後可再試/)).toBeTruthy();
  fireEvent.click(retry);
  fireEvent(window, new Event('pageshow'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
});

it('preserves a dated stale 3D outline through cooldown, a failed refresh and recovery', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  let rejectRefresh!: (reason: Error) => void;
  const stalledRefresh = new Promise<unknown>((_resolve, reject) => {
    rejectRefresh = reject;
  });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
      json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), stale: true,
      }),
    })
    .mockReturnValueOnce(stalledRefresh)
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date().toISOString(), stale: false,
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  // The scheduled callback must run after the absolute wall-clock deadline.
  // Invoking a timer early must never bypass a server cooldown.
  let now = Date.now();
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const timeoutSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();
    const retry = within(dialog).getByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(within(dialog).getByText(/約 10 分鐘冷卻/)).toBeTruthy();
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const release = timeoutSpy.mock.calls.find(([, delay]) =>
      typeof delay === 'number' && delay >= 599_000 && delay <= 600_000)?.[0];
    expect(typeof release).toBe('function');
    now += 600_001;
    await act(async () => { (release as () => void)(); });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/正在檢查更新，暫時保留舊輪廓/)).toBeTruthy();
    expect(retry.hasAttribute('disabled')).toBe(true);

    await act(async () => { rejectRefresh(new Error('offline during refresh')); });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(within(dialog).getByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    fireEvent.click(retry);
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: '重新讀取建築輪廓' })).toBeNull());
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前有日期標註的舊輪廓/)).toBeNull();
  } finally {
    timeoutSpy.mockRestore();
    nowSpy.mockRestore();
  }
});

it('keeps the existing WebGL scene when an OSM refresh only updates the fetch date', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), stale: true,
      }),
    })
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap',
        // Real JSON requests decode new objects, not the same in-memory array.
        buildings: JSON.parse(JSON.stringify(buildings)),
        fetchedAt: new Date().toISOString(), stale: false,
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
  await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toHaveLength(1));
  const createdScenes = scene.create.mock.calls.length;
  const disposedScenes = scene.dispose.mock.calls.length;
  fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull());
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  // Data date is new, but geometry and source details did not change.
  expect(scene.create).toHaveBeenCalledTimes(createdScenes);
  expect(scene.dispose).toHaveBeenCalledTimes(disposedScenes);
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('releases a server cooldown after a suspended mobile tab resumes, without auto retrying', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503,
    headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  // The real timeout remains pending: simulate a browser returning from the
  // background with a wall clock later than the server's 10-minute deadline.
  let clock = Date.now();
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    clock += 70_000;
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(within(dialog).getByText(/約 9 分鐘冷卻/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 531_000;
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(within(dialog).queryByText(/分鐘冷卻/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  } finally {
    clockSpy.mockRestore();
  }
});

it('keeps an OSM cooldown locked if a mobile clock moves backwards before its timer fires', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 503,
    headers: { get: (name: string) => name === 'retry-after' ? '600' : null },
  });
  vi.stubGlobal('fetch', fetchMock);
  let clock = Date.now();
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    const retry = await within(dialog).findByRole('button', { name: '重新讀取建築輪廓' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cooldownTimer = timerSpy.mock.calls.find(([, delay]) => delay === 600_000);
    expect(cooldownTimer).toBeTruthy();

    // The timeout was scheduled before an NTP/time-zone clock correction.
    // A browser timer firing must not bypass the server's absolute cooldown.
    clock -= 2 * 60_000;
    act(() => { (cooldownTimer![0] as () => void)(); });
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText(/約 12 分鐘冷卻/)).toBeTruthy();
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

    clock += 12 * 60_000 + 1;
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it('retries Providence building data after a temporary outage without closing the tour', async () => {
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
  // A generic 500 without a rate-limit hint remains manually retryable.
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 500 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      schoolId: 'pu', source: 'OpenStreetMap', buildings,
      fetchedAt: new Date().toISOString(), stale: false,
    }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();

  fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(scene.create.mock.calls[1][2].footprints).toEqual(buildings);
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '重新讀取建築輪廓' })).toBeNull();
  expect(within(dialog).getByRole('heading', { name: '蓋夏圖書館' })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
});

it('evicts an expired snapshot on tab resume, then installs only fresh source geometry', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  const fetchedAt = new Date(clock - day + 60_000).toISOString();
  let resolveRefresh!: (value: unknown) => void;
  const pendingRefresh = new Promise((resolve) => { resolveRefresh = resolve; });
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false }),
  }).mockReturnValueOnce(pendingRefresh);
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();

    // Crossing the freshness boundary on tab resume must mark the saved
    // geometry stale AND start exactly one bounded revalidation, rather than
    // leaving the map stale until the user finds the manual retry action.
    clock += 2 * 60_000;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    // Do not spend public OSM quota refreshing an unseen, still-retainable map.
    // The visible resume must do exactly one revalidation instead.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    // Hidden soft expiry has already advanced the timer to seven-day hard
    // expiry. Visibility and pageshow must still revalidate exactly once.
    fireEvent(window, new Event('pageshow'));
    expect(await within(dialog).findByText(/暫用舊快照/)).toBeTruthy();
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/正在檢查更新，暫時保留舊輪廓/)).toBeTruthy();
    // A second resume event while the refresh is pending must not issue an
    // extra request or recreate WebGL geometry.
    const sceneCountWhileStale = scene.create.mock.calls.length;
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scene.create).toHaveBeenCalledTimes(sceneCountWhileStale);

    // A suspended device can pass the seven-day deadline before timers fire.
    clock += 6 * day;
    fireEvent(window, new Event('pageshow'));
    // Expired geometry is not rendered while a replacement request is pending.
    expect(await within(dialog).findByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(within(dialog).queryByText(new RegExp(`資料讀取：${fetchedAt.slice(0, 10)}`))).toBeNull();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    const previousSceneCount = scene.create.mock.calls.length;
    fireEvent(document, new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const updatedBuildings = buildings.map((building) => ({ ...building, heightMeters: building.heightMeters + 1, heightBasis: 'osm-tag' as const }));
    await act(async () => resolveRefresh({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap', buildings: updatedBuildings,
        fetchedAt: new Date(clock).toISOString(), stale: false,
      }),
    }));
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(updatedBuildings));
    expect(scene.create).toHaveBeenCalledTimes(previousSceneCount + 1);
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();
    expect(within(dialog).getByText(`資料讀取：${new Date(clock).toISOString().slice(0, 10)}`)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    clockSpy.mockRestore();
  }
});

it('bounds the first hard-expiry timer for an already-stale OSM snapshot', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  // A valid two-day-old snapshot has five days until hard expiry.
  // Recheck its absolute deadline in daily steps instead of waiting five days.
  const fetchedAt = new Date(now - 2 * day).toISOString();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();
    expect(timerSpy.mock.calls.some(([, delay]) => delay === day)).toBe(true);
    expect(timerSpy.mock.calls.some(([, delay]) =>
      typeof delay === 'number' && delay > 2_147_483_647)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it('keeps the hard-expiry eviction armed after a hidden soft-deadline timer', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  const fetchedAt = new Date(clock - day + 60_000).toISOString();
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, stale: false }),
  }).mockReturnValueOnce(new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();

    // Simulate the real timeout callback while the browser is backgrounded.
    // No visibilitychange event should be needed to enforce hard retention.
    const softTimer = timerSpy.mock.calls.find(([, delay]) => delay === 60_000);
    expect(softTimer).toBeTruthy();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const originalClock = clock;
    // An extreme wall-clock correction must not schedule a timeout larger
    // than a day (which could overflow the browser's 32-bit timer).
    clock -= 30 * day;
    act(() => { (softTimer![0] as () => void)(); });
    expect(within(dialog).queryByText(/暫用舊快照/)).toBeNull();
    const boundedTimer = timerSpy.mock.calls.filter(([, delay]) => delay === day).at(-1);
    expect(boundedTimer).toBeTruthy();
    // The next timer may also fire early after the clock is corrected again.
    clock = originalClock - 120_000;
    act(() => { (boundedTimer![0] as () => void)(); });
    const rearmedSoft = timerSpy.mock.calls.find(([, delay]) => delay === 180_000);
    expect(rearmedSoft).toBeTruthy();
    clock = originalClock + 90_000;
    act(() => { (rearmedSoft![0] as () => void)(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(/暫用舊快照/)).toBeTruthy();

    // The soft timeout must schedule a *new* seven-day expiry timeout.
    const deadline = Date.parse(fetchedAt) + 7 * day;
    // The initial hard-expiry timer must be bounded too; its callback will
    // re-arm as the seven-day absolute deadline approaches.
    const hardTimer = timerSpy.mock.calls.filter(([, delay]) => delay === day).at(-1);
    expect(hardTimer).toBeTruthy();
    // An early hard-expiry callback (after time sync) must re-arm eviction,
    // rather than leaving old source geometry visible past seven days.
    clock = deadline - 120_000;
    act(() => { (hardTimer![0] as () => void)(); });
    expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rearmedHard = timerSpy.mock.calls.filter(([, delay]) => delay === 120_000).at(-1);
    expect(rearmedHard).toBeTruthy();
    clock = deadline + 1_000;
    act(() => { (rearmedHard![0] as () => void)(); });
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    // Hard expiry must remove unverified geometry but must not wake the
    // public OSM origin while the browser stays in the background.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/正在讀取靜宜建築輪廓/)).toBeTruthy();
    // pageshow can follow visibilitychange on mobile; only one request is valid.
    fireEvent(window, new Event('pageshow'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it.each(['visibilitychange', 'timer'])('drops geometry at the earlier OSM replication deadline via %s when the response is expired', async (trigger) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  // Valid metadata: HTTP fetch is less than 48 hours after Overpass sync.
  const fetchedAt = new Date(clock - 5 * day + 60_000).toISOString();
  const osmBaseAt = new Date(Math.floor((clock - 7 * day + 120_000) / 1000) * 1000)
    .toISOString().replace('.000Z', 'Z');
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ schoolId: 'pu', source: 'OpenStreetMap', buildings, fetchedAt, osmBaseAt, stale: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    clock += 3 * 60_000;
    if (trigger === 'timer') {
      const expiryTimer = timerSpy.mock.calls.find(([, delay]) =>
        typeof delay === 'number' && delay > 119_000 && delay <= 120_000);
      expect(expiryTimer).toBeTruthy();
      act(() => { (expiryTimer![0] as () => void)(); });
    } else {
      fireEvent(document, new Event('visibilitychange'));
    }
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
    expect(within(dialog).queryByText(new RegExp(`資料讀取：${fetchedAt.slice(0, 10)}`))).toBeNull();
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it.each(['failure', 'timeout'])('does not resurrect a seven-day-old outline after refresh %s', async (outcome) => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  const day = 24 * 60 * 60 * 1000;
  let clock = Date.now();
  let rejectRefresh!: (reason: Error) => void;
  const pendingRefresh = new Promise<unknown>((_resolve, reject) => { rejectRefresh = reject; });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({
        schoolId: 'pu', source: 'OpenStreetMap', buildings,
        fetchedAt: new Date(clock - 7 * day + 60_000).toISOString(), stale: true,
      }),
    })
    .mockReturnValueOnce(pendingRefresh);
  vi.stubGlobal('fetch', fetchMock);
  const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const timerSpy = vi.spyOn(window, 'setTimeout');
  try {
    render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={vi.fn()} />);
    const dialog = await open();
    expect(await within(dialog).findByText(/1 棟公開建築輪廓/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '重新讀取建築輪廓' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByText(/正在檢查更新/)).toBeTruthy();

    clock += 2 * 60_000;
    fireEvent(window, new Event('pageshow'));
    // React removes the expired volume immediately, but SpatialCanvas creates
    // its replacement Three.js scene after an asynchronous dynamic import.
    // Await that new scene rather than inspecting the disposed previous scene.
    expect(within(dialog).queryByText(/1 棟公開建築輪廓/)).toBeNull();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (outcome === 'timeout') {
      const requestTimer = timerSpy.mock.calls.filter(([, delay]) => delay === 15_000).at(-1);
      expect(requestTimer).toBeTruthy();
      act(() => { (requestTimer![0] as () => void)(); });
    }
    await act(async () => { rejectRefresh(new Error('offline after snapshot expiry')); });
    expect(await within(dialog).findByText(/公開建築輪廓目前無法取得/)).toBeTruthy();
    expect(within(dialog).queryByText(/更新未成功，仍顯示先前/)).toBeNull();
    await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]));
    expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  } finally {
    timerSpy.mockRestore();
    clockSpy.mockRestore();
  }
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


it('withdraws filtered-out Providence volumes and counts only buildings in the current map', async () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  const zhugu = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-zhugu')!;
  const buildings = parseProvidenceOsmFootprints({ elements: [{
    type: 'way', id: 255784049, tags: { building: 'yes', height: '100 m' },
    geometry: [
      { lat: 24.22624, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58143 },
      { lat: 24.22634, lon: 120.58131 },
      { lat: 24.22624, lon: 120.58131 },
    ],
  }] });
  expect(buildings).toHaveLength(1);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    schoolId: 'pu', source: 'OpenStreetMap', buildings,
    fetchedAt: new Date().toISOString(), stale: false,
  }) });
  vi.stubGlobal('fetch', fetchMock);
  const onSelect = vi.fn();
  const view = render(<CampusSpatialExplorer school="pu" locations={[library]} selected={library} onSelect={onSelect} />);
  const dialog = await open();
  await waitFor(() => expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual(buildings));
  expect(within(dialog).getByText(/1 棟公開建築輪廓/)).toBeTruthy();
  // A sourced numerical height must be distinguishable from a 12m illustrative volume.
  expect(within(dialog).getByText(/高度：100 公尺.*OSM 使用者標註.*非校方實測/)).toBeTruthy();
  expect(within(dialog).queryByText(/高度：12 公尺示意/)).toBeNull();
  const beforeFilter = scene.create.mock.calls.length;

  // A same-school map filter does not unmount the spatial dialog or refetch
  // Overpass. The previous library way is no longer part of this view.
  view.rerender(<CampusSpatialExplorer school="pu" locations={[zhugu]} selected={zhugu} onSelect={onSelect} />);
  await waitFor(() => expect(scene.create.mock.calls.length).toBeGreaterThan(beforeFilter));
  expect(scene.create.mock.calls.at(-1)?.[2].footprints).toEqual([]);
  expect(within(dialog).getByText(/0 棟公開建築輪廓/)).toBeTruthy();
  expect(within(dialog).getByText(/此地點沒有可用的已核對 OSM 建築外框.*不代表已驗證入口/)).toBeTruthy();
  expect(within(dialog).queryByText(/高度：100 公尺/)).toBeNull();
  expect(within(dialog).getByRole('heading', { name: zhugu.name })).toBeTruthy();
  expect(within(dialog).getByRole('link', { name: '開啟步行導航' })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
