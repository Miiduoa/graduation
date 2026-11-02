import { httpsCallable } from 'firebase/functions';
import { randomUUID } from 'expo-crypto';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type NavigationReason =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'canceled'
  | 'provider_error'
  | 'invalid_response'
  | 'no_places'
  | 'ambiguous_places'
  | 'source_changed'
  | 'permission_changed';
export type CloudNavigationFailure = {
  status: 'unavailable' | 'clarify' | 'stale';
  provider: 'groq';
  schoolId: string;
  checkedAt: string;
  reason: NavigationReason;
  retryAfterSeconds?: number;
};
export type NavigationPlace = {
  id: string;
  name: string;
  schoolId: string;
  lat: number;
  lng: number;
};
export type CloudNavigationResult =
  | CloudNavigationFailure
  | {
      status: 'completed';
      provider: 'groq';
      model: 'openai/gpt-oss-120b';
      schoolId: string;
      checkedAt: string;
      sourceUpdatedAt: string | null;
      route: { from: NavigationPlace; to: NavigationPlace; navigationUrl: string };
    };
export type CloudNavigationPreview = {
  status: 'preview';
  provider: 'groq';
  model: 'openai/gpt-oss-120b';
  schoolId: string;
  query: string;
  checkedAt: string;
  sourceUpdatedAt: string | null;
  fingerprint: string;
  cloudReady: boolean;
  places: Array<{ ref: string; name: string; category: string; aliases: string[] }>;
};
export type CloudNavigationPreviewResult = CloudNavigationPreview | CloudNavigationFailure;
export type CloudNavigationInput = {
  scope: { uid: string; schoolId: string };
  query: string;
  isCurrent: () => boolean;
};
type Input = CloudNavigationInput;
export type NavigationTaskInput = Input & {
  requestId: string;
  consent: { provider: 'groq'; version: 1; schoolId: string; query: string; fingerprint: string };
};

export class CloudNavigationError extends Error {
  constructor(public readonly code: 'unconfigured' | 'session-changed' | 'invalid-response') {
    super(code);
    this.name = 'CloudNavigationError';
  }
}
const invalid = (): never => {
  throw new CloudNavigationError('invalid-response');
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const reasons = new Set<NavigationReason>([
  'not_configured',
  'rate_limited',
  'timeout',
  'canceled',
  'provider_error',
  'invalid_response',
  'no_places',
  'ambiguous_places',
  'source_changed',
  'permission_changed',
]);
const bounded = (value: unknown, length: number): value is string =>
  typeof value === 'string' && value.length <= length;

function parsePlace(value: unknown, schoolId: string): NavigationPlace {
  const place = object(value);
  if (
    !bounded(place.id, 128) ||
    !place.id.trim() ||
    place.id !== place.id.trim() ||
    place.id === '.' ||
    place.id === '..' ||
    place.id.includes('/') ||
    Array.from(place.id).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) ||
    !bounded(place.name, 240) ||
    !place.name.trim() ||
    place.schoolId !== schoolId ||
    typeof place.lat !== 'number' ||
    !Number.isFinite(place.lat) ||
    Math.abs(place.lat) > 90 ||
    typeof place.lng !== 'number' ||
    !Number.isFinite(place.lng) ||
    Math.abs(place.lng) > 180
  )
    return invalid();
  return { id: place.id, name: place.name, schoolId, lat: place.lat, lng: place.lng };
}

function parse(
  value: unknown,
  input: Input,
  phase: 'preview' | 'execute',
): CloudNavigationPreviewResult | CloudNavigationResult {
  const data = object(value);
  if (['actions', 'tools', 'tool_calls', 'function_call'].some((key) => key in data))
    return invalid();
  if (
    data.provider !== 'groq' ||
    (data.model !== undefined && data.model !== 'openai/gpt-oss-120b') ||
    data.schoolId !== input.scope.schoolId ||
    !date(data.checkedAt)
  )
    return invalid();
  const common = {
    provider: 'groq' as const,
    schoolId: input.scope.schoolId,
    checkedAt: data.checkedAt,
  };
  if (data.status === 'unavailable' || data.status === 'clarify' || data.status === 'stale') {
    if (!reasons.has(data.reason as NavigationReason)) return invalid();
    if (
      data.retryAfterSeconds !== undefined &&
      (typeof data.retryAfterSeconds !== 'number' ||
        !Number.isInteger(data.retryAfterSeconds) ||
        data.retryAfterSeconds < 1 ||
        data.retryAfterSeconds > 60)
    )
      return invalid();
    return {
      ...common,
      status: data.status,
      reason: data.reason as NavigationReason,
      ...(data.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: data.retryAfterSeconds as number }),
    };
  }
  if (
    data.model !== 'openai/gpt-oss-120b' ||
    (data.sourceUpdatedAt !== null && !date(data.sourceUpdatedAt))
  )
    return invalid();
  const source = {
    ...common,
    model: 'openai/gpt-oss-120b' as const,
    sourceUpdatedAt: data.sourceUpdatedAt as string | null,
  };
  if (phase === 'preview' && data.status === 'preview') {
    if (
      data.query !== input.query ||
      typeof data.cloudReady !== 'boolean' ||
      typeof data.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.fingerprint) ||
      !Array.isArray(data.places) ||
      data.places.length < 2 ||
      data.places.length > 40
    )
      return invalid();
    const refs = new Set<string>();
    const places = data.places.map((raw, index) => {
      const p = object(raw);
      if (
        typeof p.ref !== 'string' ||
        p.ref !== `p${index}` ||
        refs.has(p.ref) ||
        !bounded(p.name, 80) ||
        !p.name.trim() ||
        !bounded(p.category, 40) ||
        !Array.isArray(p.aliases) ||
        p.aliases.length > 6 ||
        p.aliases.some((alias) => !bounded(alias, 60))
      )
        return invalid();
      refs.add(p.ref);
      return { ref: p.ref, name: p.name, category: p.category, aliases: p.aliases as string[] };
    });
    return {
      ...source,
      status: 'preview',
      query: input.query,
      cloudReady: data.cloudReady,
      fingerprint: data.fingerprint,
      places,
    };
  }
  if (phase === 'execute' && data.status === 'completed') {
    const route = object(data.route);
    const from = parsePlace(route.from, input.scope.schoolId);
    const to = parsePlace(route.to, input.scope.schoolId);
    if (from.id === to.id) return invalid();
    const navigationUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${from.lat},${from.lng}`)}&destination=${encodeURIComponent(`${to.lat},${to.lng}`)}&travelmode=walking`;
    if (
      route.navigationUrl !== navigationUrl ||
      ['actions', 'tools', 'tool_calls'].some((key) => key in route)
    )
      return invalid();
    return {
      ...source,
      status: 'completed',
      route: { from, to, navigationUrl },
    };
  }
  return invalid();
}

function aborted(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

function checkSession(input: Input, signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted();
  let current = false;
  try {
    current = input.isCurrent() === true;
  } catch {
    /* Invalidated context fails closed. */
  }
  if (!current || !input.scope.uid || getAuthInstance()?.currentUser?.uid !== input.scope.uid)
    throw new CloudNavigationError('session-changed');
}

function snapshot(input: Input, signal?: AbortSignal): Input {
  if (isFirebaseMockMode()) throw new CloudNavigationError('unconfigured');
  if (!input || typeof input !== 'object' || !input.scope || typeof input.isCurrent !== 'function')
    return invalid();
  const captured = {
    scope: { uid: input.scope.uid, schoolId: input.scope.schoolId },
    query: input.query,
    isCurrent: input.isCurrent,
  };
  checkSession(captured, signal);
  if (
    typeof captured.query !== 'string' ||
    !captured.query ||
    captured.query !== captured.query.trim() ||
    captured.query.length > 240 ||
    typeof captured.scope.schoolId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(captured.scope.schoolId)
  )
    return invalid();
  return captured;
}

async function request(
  input: Input,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  checkSession(input, signal);
  const callable = httpsCallable<Record<string, unknown>, unknown>(
    getFunctionsInstance(),
    'askCampusAssistant',
  );
  let onAbort: (() => void) | undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(aborted());
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Callable cannot abort server work. Stop waiting and discard late responses only.
    const pending = Promise.resolve().then(() => {
      checkSession(input, signal);
      return callable(payload);
    });
    const { data } = await Promise.race([pending, interruption]);
    checkSession(input, signal);
    return data;
  } catch (error) {
    checkSession(input, signal);
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function createCloudNavigationRequestId(): string {
  const id = randomUUID();
  if (
    typeof id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
  )
    return invalid();
  return id;
}

export async function getCloudNavigationPreview(
  input: Input,
  signal?: AbortSignal,
): Promise<CloudNavigationPreviewResult> {
  const captured = snapshot(input, signal);
  const data = await request(
    captured,
    {
      task: 'public-campus-navigation',
      phase: 'preview',
      schoolId: captured.scope.schoolId,
      query: captured.query,
    },
    signal,
  );
  checkSession(captured, signal);
  const result = parse(data, captured, 'preview') as CloudNavigationPreviewResult;
  checkSession(captured, signal);
  return result;
}

export async function runCloudNavigationTask(
  input: NavigationTaskInput,
  signal?: AbortSignal,
): Promise<CloudNavigationResult> {
  const captured = snapshot(input, signal);
  const consent = object(input.consent);
  if (
    consent.provider !== 'groq' ||
    consent.version !== 1 ||
    consent.schoolId !== captured.scope.schoolId ||
    consent.query !== captured.query ||
    typeof consent.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(consent.fingerprint) ||
    typeof input.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
  )
    return invalid();
  const data = await request(
    captured,
    {
      task: 'public-campus-navigation',
      phase: 'execute',
      schoolId: captured.scope.schoolId,
      query: captured.query,
      requestId: input.requestId,
      consent: {
        provider: 'groq',
        version: 1,
        schoolId: captured.scope.schoolId,
        query: captured.query,
        fingerprint: consent.fingerprint,
      },
    },
    signal,
  );
  checkSession(captured, signal);
  const result = parse(data, captured, 'execute') as CloudNavigationResult;
  checkSession(captured, signal);
  return result;
}
