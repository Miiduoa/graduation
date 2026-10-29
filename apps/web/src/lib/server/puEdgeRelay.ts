import { createIpv4PinnedFetch } from './campusIpv4Fetch';
import {
  isAllowedRelayTarget,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  signRelayRequest,
} from './puEdgeRelayProtocol';

export {
  hostnameMatchesAllowlist,
  isAllowedRelayTarget,
  isRelayTimestampFresh,
  parseAllowedHosts,
  RELAY_COLO_HEADER,
  RELAY_REPLAY_WINDOW_SECONDS,
  RELAY_SIGN_HEADER,
  RELAY_TARGET_HEADER,
  RELAY_TS_HEADER,
  relayCanonical,
  signRelayRequest,
  timingSafeEqualHex,
  verifyRelaySignature,
} from './puEdgeRelayProtocol';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PuEdgeRelayEnv = {
  PU_EDGE_RELAY_URL?: string;
  PU_EDGE_RELAY_SECRET?: string;
} & Record<string, string | undefined>;

export type PuEdgeRelayConfig = {
  url: string;
  secret: string;
};

export function readPuEdgeRelayConfig(
  env: PuEdgeRelayEnv | NodeJS.ProcessEnv = process.env,
): PuEdgeRelayConfig | null {
  const url = String(env.PU_EDGE_RELAY_URL || '').trim();
  const secret = String(env.PU_EDGE_RELAY_SECRET || '').trim();
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url, secret };
}

function requestMethod(init?: RequestInit): string {
  return String(init?.method || 'GET').trim().toUpperCase() || 'GET';
}

/**
 * 所有連 `*.pu.edu.tw` 的伺服器端請求都走這個 fetch。
 * 只有 `PU_EDGE_RELAY_URL` 與 `PU_EDGE_RELAY_SECRET` 都有設時才轉送；否則維持 IPv4 直連。
 */
export function createPuRelayFetch(
  options: {
    env?: PuEdgeRelayEnv | NodeJS.ProcessEnv;
    fetch?: FetchLike;
    directFetch?: FetchLike;
    now?: () => number;
  } = {},
): FetchLike {
  const config = readPuEdgeRelayConfig(options.env ?? process.env);
  const direct = options.directFetch ?? createIpv4PinnedFetch();
  if (!config) return direct;
  const relayFetch = options.fetch ?? ((url, init) => fetch(url, init));
  return async (url, init = {}) => {
    const target = String(url);
    if (!isAllowedRelayTarget(target, ['*.pu.edu.tw'])) {
      return direct(url, init);
    }
    const method = requestMethod(init);
    const timestamp = String(Math.floor((options.now?.() ?? Date.now()) / 1000));
    const signature = await signRelayRequest(config.secret, timestamp, method, target);
    const headers = new Headers(init.headers);
    headers.set(RELAY_TS_HEADER, timestamp);
    headers.set(RELAY_SIGN_HEADER, signature);
    headers.set(RELAY_TARGET_HEADER, target);
    const relayInit: RequestInit = {
      method,
      headers,
      redirect: 'manual',
      signal: init.signal,
    };
    if (method !== 'GET' && method !== 'HEAD' && init.body != null) {
      relayInit.body = init.body;
    }
    return relayFetch(config.url, relayInit);
  };
}
