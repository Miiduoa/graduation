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

it('keeps the current WebGL data reference if the API sends identical POIs in another order', () => {
  // Synthetic second POI only; no assertion about a real campus building.
  const other: ProvidenceFootprint = {
    ...copy(), poiId: 'synthetic-second', name: '合成第二棟',
    sourceUrl: 'https://www.openstreetmap.org/way/999',
  };
  const previous = [original, other];
  const reversed = [
    { ...other, outline: other.outline.map(([lon, lat]): [number, number] => [lon, lat]) },
    copy(),
  ];
  expect(reuseUnchangedProvidenceFootprints(previous, reversed)).toBe(previous);
  const revised = [{ ...reversed[0], osmVersion: 3 }, reversed[1]];
  expect(reuseUnchangedProvidenceFootprints(previous, revised)).toBe(revised);
  const moved = [
    { ...reversed[0], outline: [[120.58131, 24.22624], [120.58144, 24.22624], [120.58143, 24.22634]] as Array<[number, number]> },
    reversed[1],
  ];
  expect(reuseUnchangedProvidenceFootprints(previous, moved)).toBe(moved);
});

it('never treats duplicate POIs as the same complete snapshot', () => {
  const other = { ...copy(), poiId: 'synthetic-second' };
  const previous = [original, other];
  const duplicated = [copy(), copy()];
  expect(reuseUnchangedProvidenceFootprints(previous, duplicated)).toBe(duplicated);

  const previousDuplicates = [original, copy()];
  const next = [copy(), copy()];
  expect(reuseUnchangedProvidenceFootprints(previousDuplicates, next)).toBe(next);
});
