import { PublicAgentError } from './contract';
import { publicSnapshot, type PublicCatalogReader } from './navigation';

type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sourceUrl: string;
  verification: string;
};
type Source = { retrievedAt: string; mapDataLabel: string };

/** Bind only the checked-in public dataset; never accept catalog rows from a request. */
export function bindProvidencePublicCatalog(
  source: Source,
  places: readonly Place[],
): PublicCatalogReader {
  const snapshot = publicSnapshot(
    {
      schoolId: 'pu',
      updatedAt: source.retrievedAt,
      label: source.mapDataLabel,
      places: places
        .filter((place) => place.verification === 'cross-checked')
        .map(({ id, name, lat, lng, sourceUrl }) => ({ id, name, lat, lng, sourceUrl })),
    },
    'pu',
  );
  return async (schoolId, signal) => {
    if (signal.aborted || schoolId !== 'pu')
      throw new PublicAgentError('PUBLIC_AGENT_SOURCE_UNAVAILABLE', 503);
    // Return copies so no caller can alter the source subsequently delivered to another account.
    return {
      schoolId: snapshot.schoolId,
      updatedAt: snapshot.updatedAt,
      label: snapshot.label,
      places: snapshot.places.map((place) => ({ ...place })),
    };
  };
}
