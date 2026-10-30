import { CAMPUS_HOST_BLOCKED_CODE } from '@campus/shared/src/schoolLogin';
import { normalizeRelayHostname } from './puEdgeRelayProtocol';

/**
 * alcat／mypu 斷路器。
 *
 * 用行程內記憶體，TTL 30 分鐘。nuni-web 通常兩台機器，各自在第一次看到封鎖頁
 * 或 555 後就停止連該主機；最壞每台探測一次，比持續打被封鎖的出口安全。
 * 不寫 Firestore：登入熱路徑不加寫入、也不另開 collection。
 */
export const CAMPUS_CIRCUIT_TTL_MS = 30 * 60 * 1000;
export const CAMPUS_BLOCKED_HTTP_STATUS = 555;
export const CAMPUS_BLOCK_PAGE_TEXT = 'Unauthorized Activity Has Been Detected';
export const CAMPUS_CIRCUIT_HOSTS = ['alcat.pu.edu.tw', 'mypu.pu.edu.tw'] as const;

export type CampusCircuitHost = (typeof CAMPUS_CIRCUIT_HOSTS)[number];

type CircuitEntry = {
  until: number;
  reason: 'http_555' | 'block_page';
};

const openCircuits = new Map<string, CircuitEntry>();

export class CampusHostBlockedError extends Error {
  readonly host: string;
  readonly code = CAMPUS_HOST_BLOCKED_CODE;

  constructor(host: string) {
    super('學校系統無回應');
    this.name = 'CampusHostBlockedError';
    this.host = host;
  }
}

function isCircuitHost(host: string): host is CampusCircuitHost {
  return (CAMPUS_CIRCUIT_HOSTS as readonly string[]).includes(host);
}

export function campusCircuitHost(url: string): CampusCircuitHost | null {
  try {
    const host = normalizeRelayHostname(new URL(url).hostname);
    return isCircuitHost(host) ? host : null;
  } catch {
    return null;
  }
}

export function isCampusBlockResponse(status: number, body: string): boolean {
  if (status === CAMPUS_BLOCKED_HTTP_STATUS) return true;
  return body.includes(CAMPUS_BLOCK_PAGE_TEXT);
}

export function isCampusHostBlocked(host: string, now: number = Date.now()): boolean {
  const entry = openCircuits.get(normalizeRelayHostname(host));
  if (!entry) return false;
  if (entry.until <= now) {
    openCircuits.delete(normalizeRelayHostname(host));
    return false;
  }
  return true;
}

export function markCampusHostBlocked(
  host: string,
  reason: CircuitEntry['reason'],
  now: number = Date.now(),
): void {
  const normalized = normalizeRelayHostname(host);
  if (!isCircuitHost(normalized)) return;
  const existing = openCircuits.get(normalized);
  const until = now + CAMPUS_CIRCUIT_TTL_MS;
  if (existing && existing.until >= until) return;
  openCircuits.set(normalized, { until, reason });
  console.info(
    JSON.stringify({
      msg: 'pu_campus_host_circuit_open',
      host: normalized,
      reason,
      ttlMs: CAMPUS_CIRCUIT_TTL_MS,
    }),
  );
}

export function assertCampusHostAllowed(url: string, now: number = Date.now()): void {
  const host = campusCircuitHost(url);
  if (host && isCampusHostBlocked(host, now)) {
    throw new CampusHostBlockedError(host);
  }
}

export function noteCampusResponse(
  url: string,
  status: number,
  body: string,
  now: number = Date.now(),
): void {
  const host = campusCircuitHost(url);
  if (!host) return;
  if (!isCampusBlockResponse(status, body)) return;
  markCampusHostBlocked(host, status === CAMPUS_BLOCKED_HTTP_STATUS ? 'http_555' : 'block_page', now);
  throw new CampusHostBlockedError(host);
}

export function resetCampusCircuitForTests(): void {
  openCircuits.clear();
}

export { CAMPUS_HOST_BLOCKED_CODE };
