import { isUsableFootRoute } from '../../features/usableFootRoute';

const start = { lat: 24.227, lng: 120.564 };
const destination = { lat: 24.228, lng: 120.565 };
const providerResponse = {
  distance: 180,
  geometry: [
    [120.564, 24.227],
    [120.5646, 24.2275],
    [120.565, 24.228],
  ] as [number, number][],
};

test('accepts a nearby walking network polyline with valid GeoJSON coordinate order', () => {
  expect(isUsableFootRoute(providerResponse, start, destination)).toBe(true);
});

test('does not turn a failed routing request into invented turn-by-turn guidance', () => {
  expect(isUsableFootRoute(null, start, destination)).toBe(false);
  expect(isUsableFootRoute({ ...providerResponse, geometry: [] }, start, destination)).toBe(false);
  expect(isUsableFootRoute({ ...providerResponse, geometry: [providerResponse.geometry[0]] }, start, destination)).toBe(false);
});

test('rejects unusable route lengths and invalid or reversed coordinates', () => {
  for (const distance of [-1, 0, NaN, Infinity]) {
    expect(isUsableFootRoute({ ...providerResponse, distance }, start, destination)).toBe(false);
  }
  const badGeometries: unknown[] = [
    [[24.227, 120.564], [24.228, 120.565]],
    [[120.564, 24.227], [120.565, NaN]],
    [[120.564, 24.227], [0, 0]],
    [[120.564, 24.227], null],
    [[120.564, 24.227], [120.565]],
  ];
  for (const geometry of badGeometries) {
    expect(isUsableFootRoute({ ...providerResponse, geometry } as never, start, destination)).toBe(false);
  }
});

test('rejects a remote snapped route outside the selected campus', () => {
  expect(isUsableFootRoute({ ...providerResponse, geometry: [
    [121.51, 25.05],
    [121.52, 25.06],
  ] }, start, destination)).toBe(false);
});

test('rejects endpoints snapped to a different road even when provider data is finite', () => {
  expect(isUsableFootRoute({ ...providerResponse, geometry: [
    [120.564, 24.227],
    [120.57, 24.235],
  ] }, start, destination)).toBe(false);
});
