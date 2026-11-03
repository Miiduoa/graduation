import type { PublicAgentAction } from './platformPublicAgentGateway';

type Row = Record<string, unknown>;
const fail = (): never => {
  throw new Error('PUBLIC_AGENT_INVALID_RESPONSE');
};
function row(value: unknown, keys: readonly string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const object = value as Row;
  if (
    Object.keys(object).length !== keys.length ||
    Object.keys(object).some((key) => !keys.includes(key))
  )
    return fail();
  return object;
}
function str(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    [...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
  )
    return fail();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail();
  return value;
}
function match(value: unknown, pattern: RegExp, max = 120): string {
  const result = str(value, max);
  if (!pattern.test(result)) return fail();
  return result;
}
const task = 'public-campus-navigation';
const operationId = (value: unknown) => match(value, /^pago_[a-f0-9-]{36}$/u);
function taskRequest(value: unknown) {
  const r = row(value, ['task', 'data']);
  if (r.task !== task) return fail();
  const d = row(r.data, ['task', 'phase', 'schoolId', 'query', 'requestId', 'consent']);
  if (d.task !== task || d.phase !== 'execute') return fail();
  const schoolId = match(d.schoolId, /^[A-Za-z0-9_-]{2,40}$/u, 40),
    query = str(d.query, 240);
  const requestId = match(d.requestId, /^[A-Za-z0-9_-]{8,100}$/u, 100);
  const c = row(d.consent, ['version', 'provider', 'schoolId', 'query', 'fingerprint']);
  if (
    c.version !== 1 ||
    c.provider !== 'deterministic' ||
    c.schoolId !== schoolId ||
    c.query !== query
  )
    return fail();
  const fingerprint = match(c.fingerprint, /^[a-f0-9]{64}$/u, 64);
  return {
    task,
    data: {
      task,
      phase: 'execute',
      schoolId,
      query,
      requestId,
      consent: { version: 1, provider: 'deterministic', schoolId, query, fingerprint },
    },
  };
}
function place(value: unknown) {
  const p = row(value, ['id', 'name', 'lat', 'lng', 'sourceUrl']);
  const id = match(p.id, /^[A-Za-z0-9_-]{1,120}$/u),
    name = str(p.name, 100);
  if (
    typeof p.lat !== 'number' ||
    !Number.isFinite(p.lat) ||
    Math.abs(p.lat) > 90 ||
    typeof p.lng !== 'number' ||
    !Number.isFinite(p.lng) ||
    Math.abs(p.lng) > 180
  )
    return fail();
  const sourceUrl = str(p.sourceUrl, 240),
    url = new URL(sourceUrl);
  if (
    url.origin !== 'https://www.openstreetmap.org' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/(node|way|relation)\/\d+$/u.test(url.pathname) ||
    url.href !== sourceUrl
  )
    return fail();
  return { id, name, lat: p.lat, lng: p.lng, sourceUrl };
}
function receipt(value: unknown, query: string) {
  const r = row(value, ['kind', 'from', 'to', 'url', 'sourceDate', 'sourceLabel', 'mode']);
  if (r.kind !== 'walking-route' || r.mode !== 'deterministic') return fail();
  const from = place(r.from),
    to = place(r.to);
  if (from.id === to.id || query !== `從${from.name}到${to.name}`) return fail();
  const sourceDate = match(r.sourceDate, /^\d{4}-\d{2}-\d{2}$/u, 10),
    sourceLabel = str(r.sourceLabel, 120);
  if (
    !Number.isFinite(Date.parse(sourceDate)) ||
    new Date(`${sourceDate}T00:00:00Z`).toISOString().slice(0, 10) !== sourceDate
  )
    return fail();
  const expected = new URL('https://www.google.com/maps/dir/');
  expected.searchParams.set('api', '1');
  expected.searchParams.set('origin', `${from.lat},${from.lng}`);
  expected.searchParams.set('destination', `${to.lat},${to.lng}`);
  expected.searchParams.set('travelmode', 'walking');
  if (r.url !== expected.href) return fail();
  return {
    kind: 'walking-route',
    from,
    to,
    url: expected.href,
    sourceDate,
    sourceLabel,
    mode: 'deterministic',
  };
}
function operation(value: unknown, input: unknown) {
  const base = value as Row;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return fail();
  const status = base.status;
  if (status === 'pending' || status === 'unknown') {
    const r = row(base, ['status', 'operationId', 'expiresAt']);
    return { status, operationId: operationId(r.operationId), expiresAt: number(r.expiresAt) };
  }
  if (status === 'failed') {
    const r = row(base, ['status', 'operationId', 'expiresAt', 'failureCode']);
    if (
      typeof r.failureCode !== 'string' ||
      !['SOURCE_CHANGED', 'INVALID_RESULT', 'EXECUTION_FAILED'].includes(r.failureCode)
    )
      return fail();
    return {
      status,
      operationId: operationId(r.operationId),
      expiresAt: number(r.expiresAt),
      failureCode: r.failureCode,
    };
  }
  if (status === 'completed') {
    const r = row(base, ['status', 'operationId', 'expiresAt', 'result']);
    const expected = taskRequest(input),
      result = row(r.result, ['task', 'schoolId', 'sourceFingerprint', 'checkedAt', 'receipt']);
    if (
      result.task !== task ||
      result.schoolId !== expected.data.schoolId ||
      result.sourceFingerprint !== expected.data.consent.fingerprint
    )
      return fail();
    return {
      status,
      operationId: operationId(r.operationId),
      expiresAt: number(r.expiresAt),
      result: {
        task,
        schoolId: expected.data.schoolId,
        sourceFingerprint: expected.data.consent.fingerprint,
        checkedAt: number(result.checkedAt),
        receipt: receipt(result.receipt, expected.data.query),
      },
    };
  }
  return fail();
}
/** Strict wire projection: no token, unvalidated URL, arbitrary fields or other task. */
export function projectPlatformPublicAgent(
  action: PublicAgentAction,
  value: unknown,
  input: Row,
): unknown {
  if (action === 'preview') {
    const r = row(value, ['request', 'receipt', 'checkedAt', 'dataScope', 'execution']);
    const request = taskRequest(r.request);
    if (
      request.data.schoolId !== input.schoolId ||
      request.data.query !== input.query ||
      request.data.requestId !== input.requestId ||
      r.execution !== 'deterministic' ||
      !Array.isArray(r.dataScope) ||
      JSON.stringify(r.dataScope) !== JSON.stringify(['所選校園', '起點與終點', '公開地點目錄'])
    )
      return fail();
    return {
      request,
      receipt: receipt(r.receipt, request.data.query),
      checkedAt: number(r.checkedAt),
      dataScope: ['所選校園', '起點與終點', '公開地點目錄'],
      execution: 'deterministic',
    };
  }
  if (action === 'confirm') {
    const r = row(value, ['confirmationId', 'expiresAt']);
    return {
      confirmationId: match(r.confirmationId, /^pagc_[a-f0-9-]{36}$/u),
      expiresAt: number(r.expiresAt),
    };
  }
  if (action === 'status') {
    if (value === null) return null;
    const r = row(value, ['status', 'operationId']);
    if (
      typeof r.status !== 'string' ||
      !['pending', 'unknown', 'completed', 'failed'].includes(r.status)
    )
      return fail();
    return { status: r.status, operationId: operationId(r.operationId) };
  }
  if (action === 'ack') {
    const r = row(value, ['status', 'operationId']);
    if (r.status !== 'acknowledged' || r.operationId !== input.operationId) return fail();
    return { status: 'acknowledged', operationId: operationId(r.operationId) };
  }
  if (action === 'read' && value === null) return null;
  return operation(value, action === 'execute' ? input.request : input);
}
