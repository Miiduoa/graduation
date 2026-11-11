import type { ProvidenceFootprint } from './providenceFootprints';

/** Preserve the existing WebGL scene when a refresh only changes snapshot dates.
 * Compare user-visible footprint metadata as well as geometry: changes to a
 * revision, height, or source must still update the building details.
 */
export function reuseUnchangedProvidenceFootprints(
  previous: ProvidenceFootprint[], next: ProvidenceFootprint[],
): ProvidenceFootprint[] {
  if (previous.length !== next.length) return next;
  for (let i = 0; i < next.length; i += 1) {
    const before = previous[i];
    const after = next[i];
    if (before.poiId !== after.poiId || before.name !== after.name ||
        before.sourceUrl !== after.sourceUrl || before.heightMeters !== after.heightMeters ||
        before.heightBasis !== after.heightBasis || before.osmVersion !== after.osmVersion ||
        before.osmEditedAt !== after.osmEditedAt || before.outline.length !== after.outline.length) return next;
    for (let j = 0; j < after.outline.length; j += 1) {
      if (before.outline[j][0] !== after.outline[j][0] ||
          before.outline[j][1] !== after.outline[j][1]) return next;
    }
  }
  return previous;
}
