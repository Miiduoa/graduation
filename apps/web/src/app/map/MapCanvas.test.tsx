import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as L from 'leaflet';
import MapCanvas from './MapCanvas';
import type { MapLocation } from './mapService';

vi.mock('leaflet', async (original) => {
  const actual = await original<typeof import('leaflet')>();
  return { ...actual, map: vi.fn(actual.map) };
});

const library: MapLocation = {
  id: 'library',
  name: '蓋夏圖書館',
  description: '',
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', vi.fn(() =>
    Object.assign(new window.EventTarget(), { matches: false }),
  ));
});

afterEach(() => vi.unstubAllGlobals());

it('applies a deep-linked destination after Leaflet finishes loading and cleans up under StrictMode', async () => {
  const view = render(
    <StrictMode>
      <MapCanvas
        locations={[library, gate]}
        selected={library}
        route={[gate, library]}
        onSelect={vi.fn()}
      />
    </StrictMode>,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2),
  );
  const map = vi.mocked(L.map).mock.results.at(-1)!.value as L.Map;
  expect(map.getCenter().lat).toBeCloseTo(library.lat);
  expect(map.getCenter().lng).toBeCloseTo(library.lng);
  expect(map.getZoom()).toBe(18);
  const remove = vi.spyOn(map, 'remove');
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('replaces markers when equal-length source data changes and treats tooltip names as plain text', async () => {
  const select = vi.fn();
  const view = render(
    <MapCanvas locations={[library]} selected={null} route={null} onSelect={select} />,
  );
  await waitFor(() =>
    expect(view.container.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toBe(
      '蓋夏圖書館',
    ),
  );
  const namedPlace = { ...gate, name: '<img src=x onerror=alert(1)>' };
  view.rerender(
    <MapCanvas locations={[namedPlace]} selected={null} route={null} onSelect={select} />,
  );
  await waitFor(() =>
    expect(view.container.querySelector('.leaflet-marker-icon')?.getAttribute('title')).toBe(
      namedPlace.name,
    ),
  );
  const map = vi.mocked(L.map).mock.results.at(-1)!.value as L.Map;
  let marker: L.Marker | undefined;
  map.eachLayer((layer) => {
    if (layer instanceof L.Marker) marker = layer;
  });
  expect(marker).toBeDefined();
  const tooltip = marker!.getTooltip()!.getContent() as HTMLElement;
  expect(tooltip.textContent).toBe(namedPlace.name);
  expect(tooltip.querySelector('img')).toBeNull();
  act(() => {
    marker!.fire('click');
  });
  expect(select).toHaveBeenCalledWith(namedPlace);
});

it('selects a focused marker with Enter or Space and retains its focus after selection', async () => {
  const select = vi.fn();
  const view = render(
    <MapCanvas locations={[library, gate]} selected={null} route={null} onSelect={select} />,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2),
  );
  const marker = view.container.querySelector<HTMLElement>('[data-map-location-id="library"]')!;
  marker.focus();
  fireEvent.keyDown(marker, { key: 'Enter' });
  expect(select).toHaveBeenLastCalledWith(library);

  const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  fireEvent(marker, space);
  expect(space.defaultPrevented).toBe(true);
  expect(select).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(marker, { key: ' ', repeat: true });
  expect(select).toHaveBeenCalledTimes(2);

  view.rerender(
    <MapCanvas locations={[library, gate]} selected={library} route={null} onSelect={select} />,
  );
  expect(document.activeElement).toBe(
    view.container.querySelector('[data-map-location-id="library"]'),
  );
});

it.each(['site', 'system'] as const)('applies %s motion changes to Leaflet without recreating the map', async (preference) => {
  document.documentElement.dataset.reducedMotion = 'false';
  let systemReduced = false;
  const media = new window.EventTarget() as MediaQueryList;
  Object.defineProperty(media, 'matches', { get: () => systemReduced });
  const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  const panBy = vi.spyOn(L.Map.prototype, 'panBy');
  const view = render(
    <MapCanvas locations={[library, gate]} selected={library} route={null} onSelect={vi.fn()} />,
  );
  try {
    await waitFor(() =>
      expect(view.container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2),
    );
    const map = vi.mocked(L.map).mock.results.at(-1)!.value as L.Map;
    const stop = vi.spyOn(map, 'stop');
    const center = map.getCenter();
    expect(map.options.inertia).toBe(true);
    expect(map.options.zoomAnimation).toBe(true);
    expect(map.options.zoomAnimationThreshold).toBe(4);

    await act(async () => {
      if (preference === 'site') document.documentElement.dataset.reducedMotion = 'true';
      else {
        systemReduced = true;
        media.dispatchEvent(new window.Event('change'));
      }
    });
    expect(map.options.inertia).toBe(false);
    expect(map.options.zoomAnimation).toBe(false);
    expect(map.options.zoomAnimationThreshold).toBe(0);
    expect(stop).toHaveBeenCalled();
    expect(map.getCenter()).toEqual(center);
    expect(map.getZoom()).toBe(18);
    map.panBy([10, 0]);
    expect(panBy).toHaveBeenLastCalledWith([10, 0], { animate: false });

    await act(async () => {
      document.documentElement.dataset.reducedMotion = 'false';
      systemReduced = false;
      media.dispatchEvent(new window.Event('change'));
    });
    expect(map.options.inertia).toBe(true);
    expect(map.options.zoomAnimation).toBe(true);
    expect(map.options.zoomAnimationThreshold).toBe(4);
    const options = { duration: 0.1 };
    map.panBy([0, 0], options);
    expect(panBy.mock.calls.at(-1)?.[1]).toBe(options);
    expect(vi.mocked(L.map)).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    matchMedia.mockRestore();
    panBy.mockRestore();
    document.documentElement.removeAttribute('data-reduced-motion');
  }
});

it('requests retina tiles and invalidates size after the map is created', async () => {
  const invalidateSize = vi.spyOn(L.Map.prototype, 'invalidateSize');
  render(
    <MapCanvas schoolName="靜宜大學" locations={[library]} selected={null} route={null} onSelect={vi.fn()} />,
  );
  await waitFor(() => expect(vi.mocked(L.map)).toHaveBeenCalled());
  expect(vi.mocked(L.map).mock.calls.at(-1)?.[1]).toMatchObject({ fadeAnimation: false });
  const map = vi.mocked(L.map).mock.results.at(-1)!.value as L.Map;
  let tiles: L.TileLayer | undefined;
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) tiles = layer;
  });
  expect(tiles?.options.detectRetina).toBe(true);
  expect(tiles?.options.maxNativeZoom).toBe(19);
  expect(tiles?.options.maxZoom).toBe(19);
  expect(invalidateSize).toHaveBeenCalled();
  expect(screen.getByRole('region', { name: '校園地點地圖' }).getAttribute('data-map-canvas')).toBe(
    'true',
  );
  expect(screen.getByText('靜宜大學').closest('[aria-hidden="true"]')).toBeTruthy();
});

it('keeps the location list usable when tiles fail and recreates the map on retry', async () => {
  render(<MapCanvas locations={[library]} selected={null} route={null} onSelect={vi.fn()} />);
  await waitFor(() => expect(vi.mocked(L.map)).toHaveBeenCalled());
  const map = vi.mocked(L.map).mock.results.at(-1)!.value as L.Map;
  let tiles: L.TileLayer | undefined;
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) tiles = layer;
  });
  act(() => {
    tiles!.fire('tileerror');
  });
  expect(screen.getByText('底圖暫時無法載入。仍可使用下方地點列表與步行導航。')).toBeTruthy();
  const remove = vi.spyOn(map, 'remove');
  fireEvent.click(screen.getByRole('button', { name: '重新載入底圖' }));
  await waitFor(() => expect(vi.mocked(L.map)).toHaveBeenCalledTimes(2));
  expect(remove).toHaveBeenCalledTimes(1);
});


it('draws route points as a dashed straight-line guide and marks a consented user position', async () => {
  const view = render(
    <MapCanvas
      locations={[library, gate]}
      selected={library}
      route={[gate, library]}
      myLocation={{ lat: gate.lat, lng: gate.lng }}
      onSelect={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2),
  );
  const map = vi.mocked(L.map).mock.results.at(-1)!.value as L.Map;
  await waitFor(() => {
    const layers: L.Layer[] = [];
    map.eachLayer((layer) => {
      layers.push(layer);
    });
    const route = layers.find((layer): layer is L.Polyline => layer instanceof L.Polyline);
    const locationMarker = layers.find(
      (layer): layer is L.CircleMarker => layer instanceof L.CircleMarker,
    );
    expect(route).toBeDefined();
    expect(route?.options.dashArray).toBe('6 9');
    expect(locationMarker?.getTooltip()?.getContent()).toBe('我的位置');
  });
});
