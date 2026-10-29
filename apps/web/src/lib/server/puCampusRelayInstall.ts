import { readPuEdgeRelayConfig, type FetchLike, type PuEdgeRelayEnv } from './puEdgeRelay';

type CampusHttpSetter = (fetch: FetchLike) => void;

export function readCampusHttpSetter(mod: object): CampusHttpSetter | undefined {
  try {
    const setter = (mod as { setCampusHttpFetch?: unknown }).setCampusHttpFetch;
    return typeof setter === 'function' ? (setter as CampusHttpSetter) : undefined;
  } catch {
    return undefined;
  }
}

/** 只有兩個轉送環境變數都有設時才注入 fetch；沒設就讓 scraper 走原本的 https.request。 */
export function installCampusRelayFetch(
  setter: CampusHttpSetter | undefined,
  fetchLike: FetchLike,
  env: PuEdgeRelayEnv | NodeJS.ProcessEnv = process.env,
): void {
  if (!readPuEdgeRelayConfig(env)) return;
  if (typeof setter === 'function') setter(fetchLike);
}
