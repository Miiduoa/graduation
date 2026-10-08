import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
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

beforeEach(() => vi.clearAllMocks());

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
