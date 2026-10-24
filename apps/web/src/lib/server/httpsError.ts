export type FunctionsErrorCode =
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'data-loss';

const HTTP: Record<FunctionsErrorCode, { status: number; statusText: string }> = {
  ok: { status: 200, statusText: 'OK' },
  cancelled: { status: 499, statusText: 'CANCELLED' },
  unknown: { status: 500, statusText: 'UNKNOWN' },
  'invalid-argument': { status: 400, statusText: 'INVALID_ARGUMENT' },
  'deadline-exceeded': { status: 504, statusText: 'DEADLINE_EXCEEDED' },
  'not-found': { status: 404, statusText: 'NOT_FOUND' },
  'already-exists': { status: 409, statusText: 'ALREADY_EXISTS' },
  'permission-denied': { status: 403, statusText: 'PERMISSION_DENIED' },
  unauthenticated: { status: 401, statusText: 'UNAUTHENTICATED' },
  'resource-exhausted': { status: 429, statusText: 'RESOURCE_EXHAUSTED' },
  'failed-precondition': { status: 400, statusText: 'FAILED_PRECONDITION' },
  aborted: { status: 409, statusText: 'ABORTED' },
  'out-of-range': { status: 400, statusText: 'OUT_OF_RANGE' },
  unimplemented: { status: 501, statusText: 'UNIMPLEMENTED' },
  internal: { status: 500, statusText: 'INTERNAL' },
  unavailable: { status: 503, statusText: 'UNAVAILABLE' },
  'data-loss': { status: 500, statusText: 'DATA_LOSS' },
};

export class HttpsError extends Error {
  readonly code: FunctionsErrorCode;
  readonly details: unknown;
  readonly httpErrorCode: { canonicalName: string; status: number };

  constructor(code: FunctionsErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
    const mapped = HTTP[code] ?? HTTP.internal;
    this.httpErrorCode = { canonicalName: mapped.statusText, status: mapped.status };
  }

  toJSON(): { status: string; message: string; details?: unknown } {
    const json: { status: string; message: string; details?: unknown } = {
      status: this.httpErrorCode.canonicalName,
      message: this.message,
    };
    if (this.details !== undefined) json.details = this.details;
    return json;
  }
}

export function callableErrorBody(error: HttpsError): { error: ReturnType<HttpsError['toJSON']> } {
  return { error: error.toJSON() };
}
