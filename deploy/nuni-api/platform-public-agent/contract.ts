import { createHash } from 'node:crypto';

export const PUBLIC_TASKS = ['campus-service-entry', 'public-campus-navigation'] as const;
export type PublicTaskName = (typeof PUBLIC_TASKS)[number];
export const FREE_PROVIDER = 'groq' as const;
export const FREE_MODEL = 'openai/gpt-oss-120b' as const;
export const DETERMINISTIC_PROVIDER = 'deterministic' as const;
export const DETERMINISTIC_MODEL = 'public-poi-exact-match-v1' as const;
export function isExecutionPair(provider: unknown, model: unknown, task: unknown): boolean {
  return (
    (provider === FREE_PROVIDER && model === FREE_MODEL) ||
    (task === 'public-campus-navigation' &&
      provider === DETERMINISTIC_PROVIDER &&
      model === DETERMINISTIC_MODEL)
  );
}

export class PublicAgentError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode = 422,
  ) {
    super(code);
  }
}
export interface PlatformTaskActor {
  platformAccountId: string;
  credentialId: string;
  expiresAt: number;
  /** Derived after resolveSession succeeds; never accepted in a request body. */
  sessionHash: string;
}
export interface TaskBinding {
  task: PublicTaskName;
  requestId: string;
  schoolId: string;
  payloadHash: string;
  provider: typeof FREE_PROVIDER | typeof DETERMINISTIC_PROVIDER;
  model: typeof FREE_MODEL | typeof DETERMINISTIC_MODEL;
}
export interface ParsedPublicTask {
  binding: Readonly<TaskBinding>;
  data: Readonly<Record<string, unknown>>;
}

const fail = (): never => {
  throw new PublicAgentError('PUBLIC_AGENT_INVALID_INPUT');
};
export function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) return fail();
    result[key] = descriptor.value;
  }
  if (keys.some((key) => !Object.hasOwn(result, key))) return fail();
  return result;
}
function identifier(value: unknown, min: number, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  )
    return fail();
  return value;
}
function inputText(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return fail();
  return value;
}
export function taskName(value: unknown): PublicTaskName {
  if (value !== 'campus-service-entry' && value !== 'public-campus-navigation') return fail();
  return value;
}
export function parseOperationLookup(value: unknown): {
  task: PublicTaskName;
  requestId: string;
  schoolId: string;
} {
  const input = exactRecord(value, ['task', 'requestId', 'schoolId']);
  return {
    task: taskName(input.task),
    requestId: identifier(input.requestId, 8, 100),
    schoolId: identifier(input.schoolId, 2, 40),
  };
}

/** Two public, content-bound requests only. Suggestions never grant access to their destination. */
export function parseConfirmedTask(value: unknown): ParsedPublicTask {
  const envelope = exactRecord(value, ['task', 'data']);
  const task = taskName(envelope.task);
  const data = exactRecord(
    envelope.data,
    task === 'campus-service-entry'
      ? ['schoolId', 'utterance', 'requestId', 'consent']
      : ['task', 'phase', 'schoolId', 'query', 'requestId', 'consent'],
  );
  const schoolId = identifier(data.schoolId, 2, 40);
  const requestId = identifier(data.requestId, 8, 100);
  const consent = exactRecord(
    data.consent,
    task === 'campus-service-entry'
      ? ['model', 'provider', 'purpose', 'schoolId', 'utterance', 'version']
      : ['provider', 'version', 'schoolId', 'query', 'fingerprint'],
  );
  const provider =
    consent.provider === DETERMINISTIC_PROVIDER && task === 'public-campus-navigation'
      ? DETERMINISTIC_PROVIDER
      : FREE_PROVIDER;
  const model = provider === DETERMINISTIC_PROVIDER ? DETERMINISTIC_MODEL : FREE_MODEL;
  if (consent.provider !== provider || consent.version !== 1 || consent.schoolId !== schoolId)
    return fail();
  let text: string;
  let fingerprint: string | null = null;
  let clean: Record<string, unknown>;
  if (task === 'campus-service-entry') {
    text = inputText(data.utterance, 400);
    if (consent.model !== FREE_MODEL || consent.purpose !== task || consent.utterance !== text)
      return fail();
    clean = {
      schoolId,
      utterance: text,
      requestId,
      consent: Object.freeze({
        version: 1,
        purpose: task,
        provider,
        model: FREE_MODEL,
        schoolId,
        utterance: text,
      }),
    };
  } else {
    text = inputText(data.query, 240);
    if (
      data.task !== task ||
      data.phase !== 'execute' ||
      consent.query !== text ||
      typeof consent.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(consent.fingerprint)
    )
      return fail();
    fingerprint = consent.fingerprint;
    clean = {
      task,
      phase: 'execute',
      schoolId,
      query: text,
      requestId,
      consent: Object.freeze({
        provider,
        version: 1,
        schoolId,
        query: text,
        fingerprint,
      }),
    };
  }
  const payloadHash = createHash('sha256')
    .update(JSON.stringify([task, schoolId, text, provider, model, 1, fingerprint]))
    .digest('hex');
  return Object.freeze({
    binding: Object.freeze({
      task,
      requestId,
      schoolId,
      payloadHash,
      provider,
      model,
    }),
    data: Object.freeze(clean),
  });
}
