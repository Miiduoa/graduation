import { httpsCallable } from 'firebase/functions';
import { getAuth, getFunctionsInstance, isFirebaseConfigured } from './firebase';
import { areFunctionsConfigured } from './functionsUrl';
import { readOnlyAssistantCards } from './assistantPresentation';

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
type Input = { userId: string; schoolId: string; query: string };
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
  Number.isFinite(Date.parse(value));
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

function parse(
  value: unknown,
  input: Input,
  phase: 'preview' | 'execute',
): CloudNavigationPreviewResult | CloudNavigationResult {
  const data = object(value);
  if (data.provider !== 'groq' || data.schoolId !== input.schoolId || !date(data.checkedAt))
    return invalid();
  const common = { provider: 'groq' as const, schoolId: input.schoolId, checkedAt: data.checkedAt };
  if (data.status === 'unavailable' || data.status === 'clarify' || data.status === 'stale') {
    if (!reasons.has(data.reason as NavigationReason)) return invalid();
    if (
      data.retryAfterSeconds !== undefined &&
      (typeof data.retryAfterSeconds !== 'number' ||
        !Number.isFinite(data.retryAfterSeconds) ||
        data.retryAfterSeconds < 0 ||
        data.retryAfterSeconds > 3600)
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
    const places = data.places.map((raw) => {
      const p = object(raw);
      if (
        typeof p.ref !== 'string' ||
        !/^p\d{1,2}$/.test(p.ref) ||
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
    const cards = readOnlyAssistantCards(
      [{ kind: 'directions_card', payload: { ...route, schoolId: input.schoolId } }],
      input.schoolId,
    );
    if (cards.length !== 1) return invalid();
    const verified = cards[0].payload as {
      from: NavigationPlace;
      to: NavigationPlace;
      navigationUrl: string;
    };
    return {
      ...source,
      status: 'completed',
      route: { from: verified.from, to: verified.to, navigationUrl: verified.navigationUrl },
    };
  }
  return invalid();
}

async function request(
  input: Input,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!isFirebaseConfigured() || !areFunctionsConfigured())
    throw new CloudNavigationError('unconfigured');
  const checkSession = () => {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (!input.userId || getAuth()?.currentUser?.uid !== input.userId)
      throw new CloudNavigationError('session-changed');
  };
  checkSession();
  if (
    !input.query.trim() ||
    input.query.length > 240 ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.schoolId)
  )
    return invalid();
  const callable = httpsCallable<Record<string, unknown>, unknown>(
    getFunctionsInstance(),
    'askCampusAssistant',
  );
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException('Request aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Firebase Callable has no transport cancellation. Stop waiting and discard late results.
    const { data } = await Promise.race([callable(payload), aborted]);
    checkSession();
    return data;
  } catch (error) {
    checkSession();
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export async function getCloudNavigationPreview(
  input: Input,
  signal?: AbortSignal,
): Promise<CloudNavigationPreviewResult> {
  const data = await request(
    input,
    {
      task: 'public-campus-navigation',
      phase: 'preview',
      schoolId: input.schoolId,
      query: input.query,
    },
    signal,
  );
  return parse(data, input, 'preview') as CloudNavigationPreviewResult;
}

export async function runCloudNavigationTask(
  input: NavigationTaskInput,
  signal?: AbortSignal,
): Promise<CloudNavigationResult> {
  if (
    input.consent.provider !== 'groq' ||
    input.consent.version !== 1 ||
    input.consent.schoolId !== input.schoolId ||
    input.consent.query !== input.query ||
    !/^[a-f0-9]{64}$/.test(input.consent.fingerprint) ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
  )
    return invalid();
  const data = await request(
    input,
    {
      task: 'public-campus-navigation',
      phase: 'execute',
      schoolId: input.schoolId,
      query: input.query,
      requestId: input.requestId,
      consent: input.consent,
    },
    signal,
  );
  return parse(data, input, 'execute') as CloudNavigationResult;
}
