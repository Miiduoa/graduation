import { expect, it } from 'vitest';
import type { ProvidenceFootprint } from './providenceFootprints';
import { reuseUnchangedProvidenceFootprints } from './footprintSnapshotEquality';

const original: ProvidenceFootprint = {
  poiId: 'pu-library',
  name: '蓋夏圖書館',
  sourceUrl: 'https://www.openstreetmap.org/way/255784049',
  outline: [[120.58131, 24.22624], [120.58143, 24.22624], [120.58143, 24.22634]],
  heightMeters: 12,
  heightBasis: 'illustrative',
  osmVersion: 2,
  osmEditedAt: '2026-11-10T09:00:00Z',
};

function copy(): ProvidenceFootprint {
  return { ...original, outline: original.outline.map(([lon, lat]) => [lon, lat]) };
}

it('preserves the original list reference for a separately decoded but unchanged OSM snapshot', () => {
  const current = [original];
  expect(reuseUnchangedProvidenceFootprints(current, [copy()])).toBe(current);
  expect(reuseUnchangedProvidenceFootprints([], [])).toEqual([]);
});

it('does not reuse geometry after a verified source, height, revision, shape or POI change', () => {
  const updates: ProvidenceFootprint[] = [
    { ...copy(), heightMeters: 15, heightBasis: 'osm-tag' },
    { ...copy(), osmVersion: 3 },
    { ...copy(), osmEditedAt: '2026-11-10T09:01:00Z' },
    { ...copy(), sourceUrl: 'https://www.openstreetmap.org/way/999' },
    { ...copy(), name: '另一棟' },
    { ...copy(), poiId: 'different' },
    { ...copy(), outline: [[120.58131, 24.22624], [120.58144, 24.22624], [120.58143, 24.22634]] },
  ];
  for (const changed of updates) {
    const next = [changed];
    expect(reuseUnchangedProvidenceFootprints([original], next)).toBe(next);
  }
  const removed: ProvidenceFootprint[] = [];
  expect(reuseUnchangedProvidenceFootprints([original], removed)).toBe(removed);
});
