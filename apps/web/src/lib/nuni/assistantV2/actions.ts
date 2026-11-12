import { operationSignal } from './operation';
import { cartArgs, foodCardArgs, priceCart } from './food';
import { courseworkStudyGuard, verifyCourseworkStudyGuard } from './courseworkStudy';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { validatePersonalImportSyncRecords } from '@campus/shared/src/imports/sync';
import { ASSISTANT_SERVICES, assistantServiceHref } from '@campus/shared/src/assistantServices';
import {
  createAssistantCalendarReceipt,
  parseAssistantCalendarExecutionResult,
  type AssistantCalendarExecutionResult,
} from '@campus/shared/src/assistantExecution';
import {
  addDays,
  canonical,
  eventArgs,
  fail,
  hash,
  id,
  object,
  requireAssistantPermission,
  type Adapter,
  type Binding,
  type Card,
  type CourseworkStudyGuard,
  type EventArgs,
  type Ledger,
  type Obj,
} from './contracts';
// Each process boot is a new issuance epoch. A lost owner is never reassigned.
const routeEpoch = randomUUID();
export function issueRoute(binding: Binding, secret: string) {
  const payload = { scope: hash({ session: binding.session, conversationId: binding.conversationId, schoolId: binding.schoolId }), binding: hash(binding), issuer: process.env.FLY_MACHINE_ID || 'local', epoch: routeEpoch };
  const body = Buffer.from(canonical(payload)).toString('base64url');
  return body + '.' + mac(secret, 'route:' + body);
}
function routePayload(token: unknown, secret: string) {
  if (typeof token !== 'string' || token.length > 2048) return fail('CONFIRMATION_REVOKED', 409);
  const [body, signature, extra] = token.split('.');
  const expected = mac(secret, 'route:' + body);
  if (extra || !signature || signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return fail('CONFIRMATION_REVOKED', 409);
  let payload: Obj;
  try { payload = object(JSON.parse(Buffer.from(body, 'base64url').toString())); }
  catch { return fail('CONFIRMATION_REVOKED', 409); }
  return payload;
}
export function routeTarget(token: unknown, scope: Omit<Binding, 'account'>, secret: string) {
  const payload = routePayload(token, secret);
  if (payload.scope !== hash(scope)) return fail('CONFIRMATION_REVOKED', 409);
  const owner = machineId(payload.issuer);
  if (owner === (process.env.FLY_MACHINE_ID || 'local') && payload.epoch !== routeEpoch)
    return fail('CONFIRMATION_REVOKED', 409);
  return owner;
}
export function routeOwner(token: unknown, binding: Binding, secret: string) {
  const payload = routePayload(token, secret);
  if (payload.binding !== hash(binding)) return fail('CONFIRMATION_REVOKED', 409);
  return routeTarget(token, { session: binding.session, conversationId: binding.conversationId, schoolId: binding.schoolId }, secret);
}
const proposals = new Map<string, { seq: string; expires: number; revoked: Set<string> }>();
type CalendarOperation = {
  bindingKey: string;
  proposalSeq: string;
  tail: Promise<void>;
  pending: number;
  uncertain: boolean;
};
// The queue remains held by the actual operation, even if its HTTP deadline has
// already returned. An upstream timeout cannot prove that a dispatched write
// will not commit later, so uncertain writes remain conservative until read back.
const calendarOperations = new Map<string, CalendarOperation>();
export function beginProposal(binding: Binding, now: number) {
  for (const [key, value] of proposals) if (value.expires <= now) proposals.delete(key);
  const seq = randomUUID();
  proposals.set(hash(binding), { seq, expires: now + 300000, revoked: new Set() });
  for (const [key, value] of calendarOperations)
    if (!value.pending && proposals.get(value.bindingKey)?.seq !== value.proposalSeq)
      calendarOperations.delete(key);
  return seq;
}
const routes: Record<string, string> = Object.fromEntries(
  ASSISTANT_SERVICES.map((service) => [service.id, service.href]),
);
export function pageArgs(raw: unknown): Obj {
  // tenantId is added only after an order was observed in its permitted realm.
  // The public propose_open_page tool schema intentionally does not accept it.
  const a = object(raw, ['page', 'entityId', 'tenantId']);
  if (typeof a.page !== 'string') return fail();
  const page = a.page.replace(/^\//, '') === 'club' ? 'clubs' : a.page.replace(/^\//, '');
  if (!Object.hasOwn(routes, page)) return fail();
  if (a.tenantId !== undefined && (page !== 'orders' || a.entityId === undefined)) return fail();
  if (a.entityId !== undefined && ['classroom', 'orders', 'cafeteria'].includes(page))
    return { page, entityId: id(a.entityId), ...(a.tenantId !== undefined ? { tenantId: id(a.tenantId) } : {}) };
  if (a.entityId !== undefined) id(a.entityId);
  return { page };
}
export function pageHref(raw: unknown, schoolId: string): string {
  const a = pageArgs(raw);
  const page = String(a.page),
    entity = a.entityId ? encodeURIComponent(String(a.entityId)) : '';
  const path =
    entity && page === 'classroom'
      ? '/classroom/course/' + entity
      : entity && page === 'cafeteria'
        ? '/cafeteria/' + entity
        : null;
  if (path) return path + '?schoolId=' + encodeURIComponent(schoolId);
  const href = assistantServiceHref(page, schoolId, 'platform');
  if (!href) return fail();
  if (entity && page === 'orders') {
    if (!a.tenantId) return fail('FORBIDDEN_SCOPE', 403);
    return href + '&tenant=' + encodeURIComponent(String(a.tenantId)) + '&order=' + entity;
  }
  return href;
}
function mac(secret: string, body: string) {
  if (secret.length < 32) return fail('CONFIGURATION_REQUIRED', 503);
  return createHmac('sha256', secret)
    .update('nuni-assistant-v2-confirm\0' + body)
    .digest('base64url');
}
export function signCard(
  binding: Binding,
  tool: Card['tool'],
  raw: unknown,
  revision: number,
  secret: string,
  now: number,
  proposalSeq: string = beginProposal(binding, now),
  previousEvent?: Card,
  studyGuard?: CourseworkStudyGuard,
): Card {
  operationSignal()?.throwIfAborted();
  const args =
    tool === 'propose_food_order'
      ? foodCardArgs(raw)
      : tool === 'propose_personal_event'
        ? { ...eventArgs(raw) }
        : pageArgs(raw);
  const mutationId = 'av2_' + randomUUID().replaceAll('-', '');
  const payload = {
    v: 2,
    proposalSeq,
    epoch: routeEpoch,
    ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
    stage: 'execute',
    binding: hash(binding),
    tool,
    argsHash: hash(args),
    ...(studyGuard ? { studyGuard: courseworkStudyGuard(studyGuard) } : {}),
    ...(previousEvent && {
      previousEventHash: hash(
        eventRecord(eventArgs(previousEvent.args), binding.schoolId, previousEvent.mutationId, now),
      ),
    }),
    revision,
    mutationId,
    iat: now,
    exp: now + 300000,
  };
  const body = Buffer.from(canonical(payload)).toString('base64url');
  return {
    tool,
    args,
    token: body + '.' + mac(secret, body),
    mutationId,
    schoolId: binding.schoolId,
    destination:
      tool === 'propose_food_order'
        ? String(args.reason)
        : tool === 'propose_personal_event'
          ? '個人行事曆（無推播提醒）'
          : pageHref(args, binding.schoolId),
  };
}
function signedPayload(raw: unknown, secret: string) {
  const v = object(raw, ['token', 'args']);
  if (typeof v.token !== 'string' || v.token.length > 4096)
    return fail('CONFIRMATION_INVALID', 409);
  const [body, signature, extra] = v.token.split('.');
  const expected = mac(secret, body || '');
  if (
    extra ||
    !signature ||
    Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return fail('CONFIRMATION_INVALID', 409);
  let p: Obj;
  try {
    p = object(JSON.parse(Buffer.from(body, 'base64url').toString()));
  } catch {
    return fail('CONFIRMATION_INVALID', 409);
  }
  return p;
}
export function machineId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw)) return fail();
  return raw;
}
export function cardIssuer(raw: unknown, secret: string) {
  const p = signedPayload(raw, secret);
  return p.issuer === undefined ? undefined : machineId(p.issuer);
}
/** Authenticate the original reviewed action without granting write authority. */
function authenticatedCard(binding: Binding, raw: unknown, secret: string, now: number) {
  const p = signedPayload(raw, secret);
  const v = object(raw, ['token', 'args']);
  if (
    p.v !== 2 ||
    p.stage !== 'execute' ||
    p.binding !== hash(binding) ||
    typeof p.epoch !== 'string' || !p.epoch || p.epoch.length > 100 ||
    typeof p.proposalSeq !== 'string' || !p.proposalSeq || p.proposalSeq.length > 100 ||
    !Number.isSafeInteger(p.iat) ||
    !Number.isSafeInteger(p.exp) ||
    Number(p.iat) < 0 ||
    Number(p.iat) > now ||
    Number(p.exp) - Number(p.iat) !== 300000 ||
    (p.previousEventHash !== undefined &&
      (typeof p.previousEventHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.previousEventHash))) ||
    !Number.isSafeInteger(p.revision) ||
    Number(p.revision) < 0 ||
    !['propose_personal_event', 'propose_open_page', 'propose_food_order'].includes(String(p.tool))
  )
    return fail('CONFIRMATION_INVALID', 409);
  if (p.issuer !== undefined) machineId(p.issuer);
  const studyGuard = p.studyGuard === undefined ? undefined : courseworkStudyGuard(p.studyGuard);
  if (studyGuard && p.tool !== 'propose_personal_event') return fail('CONFIRMATION_INVALID', 409);
  const args =
    p.tool === 'propose_food_order'
      ? foodCardArgs(v.args)
      : p.tool === 'propose_personal_event'
        ? { ...eventArgs(v.args) }
        : pageArgs(v.args);
  if (
    p.argsHash !== hash(args) ||
    typeof p.mutationId !== 'string' ||
    !/^av2_[a-f0-9]{32}$/.test(p.mutationId)
  )
    return fail('CONFIRMATION_INVALID', 409);
  return {
    payload: p,
    card: {
      tool: p.tool as Card['tool'],
      args,
      ...(studyGuard ? { studyGuard } : {}),
      previousEventHash: p.previousEventHash as string | undefined,
      revision: Number(p.revision),
      mutationId: p.mutationId,
      iat: Number(p.iat),
    },
  };
}
type AuthenticatedCard = ReturnType<typeof authenticatedCard>;
type VerifiedCard = AuthenticatedCard['card'];

function liveAuthorization(binding: Binding, p: Obj, now: number, allowRevoked = false) {
  if (p.issuer !== undefined && p.issuer !== process.env.FLY_MACHINE_ID)
    return fail('CONFIRMATION_REVOKED', 409);
  const current = proposals.get(hash(binding));
  if (!current || current.seq !== p.proposalSeq ||
      (!allowRevoked && current.revoked.has(String(p.mutationId))))
    return fail('CONFIRMATION_REVOKED', 409);
  if (p.epoch !== routeEpoch || Number(p.exp) <= now)
    return fail('CONFIRMATION_INVALID', 409);
  return current;
}

export function verifyCard(binding: Binding, raw: unknown, secret: string, now: number) {
  const authenticated = authenticatedCard(binding, raw, secret, now);
  liveAuthorization(binding, authenticated.payload, now);
  return authenticated.card;
}

async function calendarOperation<T>(
  binding: Binding,
  authenticated: AuthenticatedCard,
  work: (state: CalendarOperation) => Promise<T>,
): Promise<T> {
  const bindingKey = hash(binding), key = bindingKey + ':' + authenticated.card.mutationId;
  let state = calendarOperations.get(key);
  if (!state) {
    state = { bindingKey, proposalSeq: String(authenticated.payload.proposalSeq), tail: Promise.resolve(), pending: 0, uncertain: false };
    calendarOperations.set(key, state);
  }
  const before = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  state.pending++;
  try {
    await before;
    operationSignal()?.throwIfAborted();
    return await work(state);
  } finally {
    state.pending--;
    release();
    if (!state.pending && (!state.uncertain || proposals.get(bindingKey)?.seq !== state.proposalSeq))
      calendarOperations.delete(key);
  }
}

function elapsedClock(now: number, clock?: () => number) {
  const started = Date.now();
  return clock || (() => now + (Date.now() - started));
}

async function calendarLedger(binding: Binding, adapter: Adapter) {
  operationSignal()?.throwIfAborted();
  const ledger = await adapter.ledger();
  operationSignal()?.throwIfAborted();
  if (ledger.schoolId !== binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
  if (!Number.isSafeInteger(ledger.revision) || ledger.revision < 0 || !Array.isArray(ledger.records))
    return fail('INVALID_RESPONSE', 502);
  return ledger;
}

function calendarExpected(binding: Binding, p: VerifiedCard) {
  return { schoolId: binding.schoolId, mutationId: p.mutationId, event: p.args, storage: 'synced' as const };
}

function calendarMatch(binding: Binding, p: VerifiedCard, ledger: Ledger) {
  const expected = eventRecord(eventArgs(p.args), binding.schoolId, p.mutationId, p.iat);
  const matches = ledger.records.filter((row) => row.id === p.mutationId);
  return {
    record: matches.length === 1 && canonical(matches[0]) === canonical(expected) ? matches[0] : undefined,
    conflict: matches.length > 0,
  };
}

function calendarReceipt(binding: Binding, p: VerifiedCard, ledger: Ledger, now: number, replay: boolean) {
  const match = calendarMatch(binding, p, ledger);
  if (!match.record) return fail(match.conflict ? 'CONFIRMATION_CONFLICT' : 'EXECUTION_UNKNOWN', match.conflict ? 409 : 503);
  return createAssistantCalendarReceipt({
    ...calendarExpected(binding, p), record: match.record,
    verifiedAt: new Date(now).toISOString(), revision: ledger.revision, replay,
  });
}

function knownRevoked(binding: Binding, authenticated: AuthenticatedCard) {
  const { payload, card } = authenticated, current = proposals.get(hash(binding));
  return payload.epoch === routeEpoch &&
    (payload.issuer === undefined || payload.issuer === process.env.FLY_MACHINE_ID) &&
    Boolean(current && current.seq === payload.proposalSeq && current.revoked.has(card.mutationId));
}

function hasAuthorization(binding: Binding, raw: unknown, secret: string, now: number) {
  try { verifyCard(binding, raw, secret, now); return true; }
  catch { return false; }
}

function calendarRetryable(p: VerifiedCard, ledger: Ledger, now: number) {
  const event = eventArgs(p.args), [start] = eventInterval(event);
  return ledger.revision === p.revision &&
    (!p.previousEventHash || ledger.records.some((row) => row.kind === 'events' && hash(row) === p.previousEventHash)) &&
    (event.allDay || start < p.iat || start >= Math.floor(now / 60000) * 60000);
}

function calendarCheck(
  binding: Binding, p: VerifiedCard, ledger: Ledger, now: number,
  status: 'absent' | 'conflict' | 'revoked', authorizationValid: boolean,
  retryable: boolean, alreadyRevoked = false,
): AssistantCalendarExecutionResult {
  return parseAssistantCalendarExecutionResult({
    version: 1, operation: 'calendar.create', schoolId: binding.schoolId,
    mutationId: p.mutationId, storage: 'synced', status,
    checkedAt: new Date(now).toISOString(), revision: ledger.revision,
    authorizationValid, retryable, ...(status === 'revoked' ? { alreadyRevoked } : {}),
  }, calendarExpected(binding, p));
}

/** A signed old card permits checking its exact outcome, never a new write. */
export async function reconcile(
  binding: Binding, raw: unknown, secret: string, now: number, adapter: Adapter,
  writes = false, clock?: () => number,
): Promise<AssistantCalendarExecutionResult> {
  const authenticated = authenticatedCard(binding, raw, secret, now), p = authenticated.card;
  if (p.tool !== 'propose_personal_event') return fail('INVALID_INPUT', 422);
  const currentTime = elapsedClock(now, clock);
  return calendarOperation(binding, authenticated, async (state) => {
    const ledger = await calendarLedger(binding, adapter);
    let checkedAt = currentTime();
    const match = calendarMatch(binding, p, ledger);
    if (match.record) {
      const receipt = calendarReceipt(binding, p, ledger, checkedAt, true);
      state.uncertain = false;
      return receipt;
    }
    let permissionGranted = false;
    try {
      await requireAssistantPermission(adapter, 'createPersonalEvent');
      permissionGranted = true;
    } catch {
      // Receipt checks stay available even when the setting cannot be read.
    }
    checkedAt = currentTime();
    const authorizationValid = permissionGranted && hasAuthorization(binding, raw, secret, checkedAt);
    if (match.conflict) return calendarCheck(binding, p, ledger, checkedAt, 'conflict', authorizationValid, false);
    if (knownRevoked(binding, authenticated)) {
      if (state.uncertain) return fail('EXECUTION_UNKNOWN', 503);
      return calendarCheck(binding, p, ledger, checkedAt, 'revoked', false, false, true);
    }
    return calendarCheck(binding, p, ledger, checkedAt, 'absent', authorizationValid,
      writes && authorizationValid && !state.uncertain && calendarRetryable(p, ledger, checkedAt));
  });
}

export async function revoke(
  binding: Binding, raw: unknown, secret: string, now: number, adapter: Adapter, clock?: () => number,
) {
  const authenticated = authenticatedCard(binding, raw, secret, now), p = authenticated.card;
  const currentTime = elapsedClock(now, clock);
  if (p.tool !== 'propose_personal_event') {
    const current = liveAuthorization(binding, authenticated.payload, currentTime(), true);
    const alreadyRevoked = current.revoked.has(p.mutationId);
    current.revoked.add(p.mutationId);
    return { revoked: true, alreadyRevoked };
  }
  return calendarOperation(binding, authenticated, async (state) => {
    const ledger = await calendarLedger(binding, adapter), checkedAt = currentTime();
    const match = calendarMatch(binding, p, ledger);
    if (match.record) {
      const receipt = calendarReceipt(binding, p, ledger, checkedAt, true);
      state.uncertain = false;
      return receipt;
    }
    if (match.conflict) return calendarCheck(binding, p, ledger, checkedAt, 'conflict',
      hasAuthorization(binding, raw, secret, checkedAt), false);
    // Repeated cancellation may acknowledge this registry's revocation. Expired
    // or old-process authorization is never used to assert that work was stopped.
    const current = liveAuthorization(binding, authenticated.payload, checkedAt, true);
    const alreadyRevoked = current.revoked.has(p.mutationId);
    current.revoked.add(p.mutationId);
    if (state.uncertain) return fail('EXECUTION_UNKNOWN', 503);
    return calendarCheck(binding, p, ledger, checkedAt, 'revoked', false, false, alreadyRevoked);
  });
}
export function eventRecord(args: EventArgs, schoolId: string, mutationId: string, iat: number) {
  return {
    ...args,
    id: mutationId,
    kind: 'events' as const,
    schoolId,
    academicYear: '',
    semester: '',
    batchId: mutationId,
    importedAt: new Date(iat).toISOString(),
    source: { type: 'paste' as const, name: '助理確認', line: 1, rawText: '' },
  };
}
export async function confirm(
  binding: Binding,
  raw: unknown,
  secret: string,
  now: number,
  adapter: Adapter,
  writes: boolean,
  clock?: () => number,
) {
  const currentTime = elapsedClock(now, clock);
  const p = verifyCard(binding, raw, secret, now);
  if (p.tool === 'propose_food_order') {
    await requireAssistantPermission(adapter, 'prepareFoodOrder');
    const cart = cartArgs(p.args.cart);
    if (
      !(await adapter.realms()).some(
        (r) => r.tenantId === cart.tenantId && r.schoolId === binding.schoolId,
      )
    )
      return fail('FORBIDDEN_SCOPE', 403);
    if (!adapter.food) return fail('ORDERING_DISABLED', 403);
    if (p.args.mode === 'page' || !adapter.food.enabled() || adapter.food.paymentRequired) {
      await requireAssistantPermission(adapter, 'prepareFoodOrder');
      verifyCard(binding, raw, secret, currentTime());
      operationSignal()?.throwIfAborted();
      return { href: String(p.args.href), reason: p.args.reason };
    }
    const summary = priceCart(cart, await adapter.food.menu(cart.tenantId, cart.locationId));
    if (canonical(summary) !== canonical(p.args.summary)) return fail('PRICE_CHANGED', 409);
    await requireAssistantPermission(adapter, 'prepareFoodOrder');
    verifyCard(binding, raw, secret, currentTime());
    operationSignal()?.throwIfAborted();
    return adapter.food.submit(cart, p.mutationId);
  }
  if (p.tool === 'propose_open_page') return { href: pageHref(p.args, binding.schoolId) };
  if (!writes) return fail('ASSISTANT_WRITE_UNAVAILABLE', 403);
  await requireAssistantPermission(adapter, 'createPersonalEvent');
  const authenticated = authenticatedCard(binding, raw, secret, now);
  return calendarOperation(binding, authenticated, async (state) => {
    verifyCard(binding, raw, secret, currentTime());
    const ledger = await calendarLedger(binding, adapter);
    const event = eventArgs(p.args);
    const row = eventRecord(event, binding.schoolId, p.mutationId, p.iat);
    const match = calendarMatch(binding, p, ledger);
    if (match.record) {
      const receipt = calendarReceipt(binding, p, ledger, currentTime(), true);
      state.uncertain = false;
      return receipt;
    }
    if (match.conflict) return fail('CONFIRMATION_CONFLICT', 409);
    if (
      ledger.revision !== p.revision ||
      (p.previousEventHash &&
        !ledger.records.some((r) => r.kind === 'events' && hash(r) === p.previousEventHash))
    ) {
      return fail('PERSONAL_IMPORT_REVISION_CONFLICT', 409);
    }
    const records = validatePersonalImportSyncRecords([...ledger.records, row], binding.schoolId);
    if (p.studyGuard)
      await verifyCourseworkStudyGuard(adapter, binding, p.studyGuard, event, ledger, currentTime());
    await requireAssistantPermission(adapter, 'createPersonalEvent');
    const writeTime = currentTime();
    verifyCard(binding, raw, secret, writeTime);
    const [start] = eventInterval(event);
    if (p.studyGuard?.policy === 'coursework-gap' && start <= writeTime)
      return fail('STUDY_SLOT_CHANGED', 409);
    // An explicitly backdated entry can still be recorded. Recheck a prospective
    // timed card after reading the ledger and before its first write.
    if (!event.allDay && start >= p.iat && start < Math.floor(writeTime / 60000) * 60000)
      return fail('EVENT_START_PASSED', 409);
    operationSignal()?.throwIfAborted();
    state.uncertain = true;
    await adapter.write({
      schoolId: binding.schoolId,
      expectedRevision: p.revision,
      records,
      mutationId: p.mutationId,
    });
    // A successful transport response is not proof. Read a fresh authoritative
    // snapshot and compare the complete expected row, including its fixed ID.
    const verified = await calendarLedger(binding, adapter);
    const receipt = calendarReceipt(binding, p, verified, currentTime(), false);
    state.uncertain = false;
    return receipt;
  });
}
export function eventInterval(a: EventArgs): [number, number] {
  return [
    Date.parse(`${a.date}T${a.allDay ? '00:00' : a.startTime}:00+08:00`),
    Date.parse(
      `${a.endDate || (a.allDay ? addDays(a.date, 1) : a.date)}T${a.allDay ? '00:00' : a.endTime}:00+08:00`,
    ),
  ];
}
