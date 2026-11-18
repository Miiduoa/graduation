import { describe, expect, it } from 'vitest';
import { parseProvidenceOsmFootprints } from './providenceFootprints';

// Synthetic map rings: not a survey of either campus building.
const library = [
  { lat: 24.22624, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58143 },
  { lat: 24.22634, lon: 120.58131 },
  { lat: 24.22624, lon: 120.58131 },
];
const zhugu = [
  { lat: 24.22690, lon: 120.58353 },
  { lat: 24.22690, lon: 120.58365 },
  { lat: 24.22700, lon: 120.58365 },
  { lat: 24.22700, lon: 120.58353 },
  { lat: 24.22690, lon: 120.58353 },
];
const libraryWay = {
  type: 'way', id: 255784049, tags: { building: 'yes' },
  geometry: library, nodes: [1001, 1002, 1003, 1004, 1001],
};
const zhuguWay = {
  type: 'way', id: 255784268, tags: { building: 'yes' },
  geometry: zhugu, nodes: [2001, 2002, 2003, 2004, 2001],
};

describe('Audited Providence OSM node identities across ways', () => {
  it('keeps independently valid buildings and legacy geometry-only entries', () => {
    expect(parseProvidenceOsmFootprints({
      elements: [libraryWay, zhuguWay],
    })).toHaveLength(2);
    const { nodes: libraryNodes, ...withoutLibraryNodes } = libraryWay;
    const { nodes: zhuguNodes, ...withoutZhuguNodes } = zhuguWay;
    expect(libraryNodes).toHaveLength(5);
    expect(zhuguNodes).toHaveLength(5);
    expect(parseProvidenceOsmFootprints({
      elements: [withoutLibraryNodes, withoutZhuguNodes],
    })).toHaveLength(2);
  });

  it('rejects the whole snapshot when the same node has different coordinates', () => {
    // Both ways are independently closed, but the shared node ID is
    // assigned to two different sites. Response order cannot decide truth.
    const conflicting = {
      ...zhuguWay, nodes: [1002, 2002, 2003, 2004, 1002],
    };
    for (const elements of [
      [libraryWay, conflicting],
      [conflicting, libraryWay],
    ]) {
      expect(parseProvidenceOsmFootprints({ elements })).toEqual([]);
    }
  });

  it('does not let unverified foreign ways poison vetted node geometry', () => {
    expect(parseProvidenceOsmFootprints({
      elements: [
        libraryWay, zhuguWay,
        { ...zhuguWay, id: 9999999, nodes: [1002, 2002, 2003, 2004, 1002] },
      ],
    })).toHaveLength(2);
  });
});
