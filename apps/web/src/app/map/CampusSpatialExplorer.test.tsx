import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CampusSpatialExplorer from './CampusSpatialExplorer';
import type { MapLocation } from './mapService';
import { PROVIDENCE_CAMPUS_PLACES } from './providenceCampus';

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
  expect(scene.setView).toHaveBeenLastCalledWith({ selectedId: null, overhead: false, motion: true, dark: false });
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

it('keeps real place information and navigation available after WebGL failure and permits a retry', async () => {
  scene.create.mockImplementationOnce(() => { throw new Error('WebGL unavailable'); });
  render(<CampusSpatialExplorer school="other-school" locations={places} selected={null} onSelect={vi.fn()} />);
  const dialog = await open();
  expect(await within(dialog).findByText(/這次無法顯示立體畫面/)).toBeTruthy();
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
  expect(screen.getByRole('heading', { name: '另一校圖書館' })).toBeTruthy();
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
