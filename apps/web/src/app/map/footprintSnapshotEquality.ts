import type { ProvidenceFootprint } from './providenceFootprints';

/** Preserve the existing WebGL scene when a refresh only changes snapshot dates
 * or the serialization order. Compare user-visible metadata and every vertex.
 * A missing/duplicate POI, revision, height or geometry change must update it.
 */
export function reuseUnchangedProvidenceFootprints(
  previous: ProvidenceFootprint[], next: ProvidenceFootprint[],
): ProvidenceFootprint[] {
  if (previous.length !== next.length) return next;
  // Overpass/API serialization order is not a meaningful scene change. Each
  // POI must still appear exactly once before the old geometry can be reused.
  const byPoiId = new Map(previous.map((footprint) => [footprint.poiId, footprint]));
  if (byPoiId.size !== previous.length) return next;
  for (const after of next) {
    const before = byPoiId.get(after.poiId);
    if (!before) return next;
    byPoiId.delete(after.poiId);
    if (before.name !== after.name || before.sourceUrl !== after.sourceUrl ||
        before.heightMeters !== after.heightMeters || before.heightBasis !== after.heightBasis ||
        before.osmVersion !== after.osmVersion || before.osmEditedAt !== after.osmEditedAt ||
        before.outline.length !== after.outline.length) return next;
    for (let j = 0; j < after.outline.length; j += 1) {
      if (before.outline[j][0] !== after.outline[j][0] ||
          before.outline[j][1] !== after.outline[j][1]) return next;
    }
  }
  return previous;
}
