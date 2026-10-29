import type { FetchLike } from './puEdgeRelay';

type CampusHttpSetter = (fetch: FetchLike) => void;

export function readCampusHttpSetter(mod: object): CampusHttpSetter | undefined {
  try {
    const setter = (mod as { setCampusHttpFetch?: unknown }).setCampusHttpFetch;
    return typeof setter === 'function' ? (setter as CampusHttpSetter) : undefined;
  } catch {
    return undefined;
  }
}

export function installCampusRelayFetch(
  setter: CampusHttpSetter | undefined,
  fetchLike: FetchLike,
): void {
  if (typeof setter === 'function') setter(fetchLike);
}
