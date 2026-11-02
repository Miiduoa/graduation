import { httpsCallable } from 'firebase/functions';
import {
  normalizeCampusSemanticResult,
  type CampusSemanticResult,
} from '@campus/shared/src/campusSemantic';
import { areFunctionsConfigured } from './functionsUrl';
import { getAuth, getFunctionsInstance, isFirebaseConfigured } from './firebase';

export type CampusIntentConsent = {
  version: 1;
  purpose: 'campus-service-entry';
  provider: 'groq';
  model: 'openai/gpt-oss-120b';
  schoolId: string;
  utterance: string;
};
export type CampusIntentReason =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'provider_error'
  | 'invalid_response'
  | 'permission_changed'
  | 'account_changed'
  | 'canceled';
export type CampusIntentResult = CampusSemanticResult & {
  checkedAt: string;
  reason?: CampusIntentReason;
  retryAfterSeconds?: number;
};
type ClientErrorCode =
  | 'invalid-request'
  | 'invalid-response'
  | 'unconfigured'
  | 'session-changed'
  | 'canceled'
  | 'request-failed'
  | 'rate-limited';
export class CampusIntentClientError extends Error {
  constructor(public readonly code: ClientErrorCode) {
    super(code);
    this.name = 'CampusIntentClientError';
  }
}
type Input = {
  uid: string;
  schoolId: string;
  utterance: string;
  requestId: string;
  consent: CampusIntentConsent;
  signal?: AbortSignal;
};
const reasons = new Set<CampusIntentReason>([
  'not_configured',
  'rate_limited',
  'timeout',
  'provider_error',
  'invalid_response',
  'permission_changed',
  'account_changed',
  'canceled',
]);
const receiptKeys = new Set([
  'status',
  'source',
  'summary',
  'destinations',
  'clarifyingQuestion',
  'previews',
  'provider',
  'model',
  'requestId',
  'schoolId',
  'utterance',
  'checkedAt',
  'reason',
  'retryAfterSeconds',
]);

function validConsent(input: Input): boolean {
  const consent = input.consent;
  return (
    typeof input.schoolId === 'string' &&
    /^[A-Za-z0-9_-]{2,40}$/.test(input.schoolId) &&
    typeof input.utterance === 'string' &&
    input.utterance.length > 0 &&
    input.utterance.length <= 400 &&
    input.utterance === input.utterance.trim() &&
    !Array.from(input.utterance).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) &&
    typeof input.requestId === 'string' &&
    /^[A-Za-z0-9_-]{8,128}$/.test(input.requestId) &&
    !!consent &&
    typeof consent === 'object' &&
    !Array.isArray(consent) &&
    Object.keys(consent).length === 6 &&
    consent.version === 1 &&
    consent.purpose === 'campus-service-entry' &&
    consent.provider === 'groq' &&
    consent.model === 'openai/gpt-oss-120b' &&
    consent.schoolId === input.schoolId &&
    consent.utterance === input.utterance
  );
}

function readReceipt(value: unknown, input: Input): CampusIntentResult {
  const invalid = (): never => {
    throw new CampusIntentClientError('invalid-response');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !receiptKeys.has(key)) ||
    row.provider !== input.consent.provider ||
    row.model !== input.consent.model ||
    row.requestId !== input.requestId ||
    row.schoolId !== input.schoolId ||
    row.utterance !== input.utterance ||
    typeof row.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.checkedAt)) ||
    new Date(row.checkedAt).toISOString() !== row.checkedAt ||
    !Array.isArray(row.previews) ||
    row.previews.length !== 0
  )
    return invalid();
  const result = normalizeCampusSemanticResult(row);
  if (!result) return invalid();
  if (result.status === 'unavailable') {
    if (result.source !== 'fallback' || !reasons.has(row.reason as CampusIntentReason))
      return invalid();
    if (
      row.retryAfterSeconds !== undefined &&
      (row.reason !== 'rate_limited' ||
        !Number.isInteger(row.retryAfterSeconds) ||
        Number(row.retryAfterSeconds) < 1 ||
        Number(row.retryAfterSeconds) > 60)
    )
      return invalid();
    return {
      ...result,
      checkedAt: row.checkedAt,
      reason: row.reason as CampusIntentReason,
      ...(row.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: row.retryAfterSeconds as number }),
    };
  }
  if (result.source !== 'model' || row.reason !== undefined || row.retryAfterSeconds !== undefined)
    return invalid();
  return { ...result, checkedAt: row.checkedAt };
}

export async function interpretCampusRequest(input: Input): Promise<CampusIntentResult> {
  if (!validConsent(input)) throw new CampusIntentClientError('invalid-request');
  if (!input.uid || !isFirebaseConfigured() || !areFunctionsConfigured())
    throw new CampusIntentClientError('unconfigured');
  const assertCurrent = () => {
    if (input.signal?.aborted) throw new CampusIntentClientError('canceled');
    if (getAuth()?.currentUser?.uid !== input.uid)
      throw new CampusIntentClientError('session-changed');
  };
  assertCurrent();
  const callable = httpsCallable<
    {
      schoolId: string;
      utterance: string;
      requestId: string;
      consent: CampusIntentConsent;
    },
    unknown
  >(getFunctionsInstance(), 'understandCampusRequest');
  let onAbort: (() => void) | undefined;
  try {
    const canceled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new CampusIntentClientError('canceled'));
      input.signal?.addEventListener('abort', onAbort, { once: true });
    });
    assertCurrent();
    // The signal cancels this wait, not a Callable already accepted by the server.
    const answer = await Promise.race([
      callable({
        schoolId: input.schoolId,
        utterance: input.utterance,
        requestId: input.requestId,
        consent: {
          version: 1,
          purpose: 'campus-service-entry',
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          schoolId: input.schoolId,
          utterance: input.utterance,
        },
      }),
      canceled,
    ]);
    assertCurrent();
    return readReceipt(answer.data, input);
  } catch (error) {
    if (error instanceof CampusIntentClientError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'functions/resource-exhausted') throw new CampusIntentClientError('rate-limited');
    throw new CampusIntentClientError('request-failed');
  } finally {
    if (onAbort) input.signal?.removeEventListener('abort', onAbort);
  }
}
