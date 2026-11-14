import type { ProvidenceFootprint } from './providenceFootprints';

/** A closed OSM way may start at any vertex or be serialized clockwise or
 * counterclockwise. Neither changes the building volume, so avoid disposing
 * and rebuilding WebGL just because the ring traversal changed.
 * Vertex coordinates must still match exactly; this is not shape matching.
 */
function sameOutlineRing(
  previous: readonly [number, number][], next: readonly [number, number][],
): boolean {
  const count = previous.length;
  if (count !== next.length) return false;
  if (count === 0) return true;
  for (let start = 0; start < count; start += 1) {
    if (previous[0][0] !== next[start][0] || previous[0][1] !== next[start][1]) continue;
    let forward = true;
    let backward = true;
    for (let offset = 1; offset < count; offset += 1) {
      const [lon, lat] = previous[offset];
      const ahead = next[(start + offset) % count];
      const behind = next[(start - offset + count) % count];
      if (lon !== ahead[0] || lat !== ahead[1]) forward = false;
      if (lon !== behind[0] || lat !== behind[1]) backward = false;
      if (!forward && !backward) break;
    }
    if (forward || backward) return true;
  }
  return false;
}

/** Preserve the existing WebGL scene when a refresh only changes snapshot dates
 * or serialization order (including polygon ring starts and winding).
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
        !sameOutlineRing(before.outline, after.outline)) return next;
  }
  return previous;
}
