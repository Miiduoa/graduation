import { operationSignal } from './operation';
import { cartArgs, foodCardArgs, priceCart } from './food';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { validatePersonalImportSyncRecords } from '@campus/shared/src/imports/sync';
import {
  addDays,
  canonical,
  eventArgs,
  fail,
  hash,
  id,
  object,
  type Adapter,
  type Binding,
  type Card,
  type EventArgs,
  type Obj,
} from './contracts';
const proposals = new Map<string, { seq: string; expires: number; revoked: Set<string> }>();
export function beginProposal(binding: Binding, now: number) {
  for (const [key, value] of proposals) if (value.expires <= now) proposals.delete(key);
  const seq = randomUUID();
  proposals.set(hash(binding), { seq, expires: now + 300000, revoked: new Set() });
  return seq;
}
export function revoke(binding: Binding, raw: unknown, secret: string, now: number) {
  const p = verifyCard(binding, raw, secret, now);
  proposals.get(hash(binding))!.revoked.add(p.mutationId);
  return { revoked: true };
}
const routes: Record<string, string> = {
  today: '/today',
  timetable: '/timetable',
  calendar: '/calendar',
  classroom: '/classroom',
  orders: '/orders',
  clubs: '/clubs',
  map: '/map',
  bus: '/bus',
  cafeteria: '/cafeteria',
  announcements: '/announcements',
  events: '/events',
};
export function pageArgs(raw: unknown): Obj {
  const a = object(raw, ['page', 'entityId']);
  if (typeof a.page !== 'string' || !Object.hasOwn(routes, a.page)) return fail();
  if (a.entityId !== undefined && !['classroom', 'orders', 'cafeteria'].includes(a.page))
    return fail();
  return { page: a.page, ...(a.entityId === undefined ? {} : { entityId: id(a.entityId) }) };
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
        : routes[page];
  return (
    path +
    '?schoolId=' +
    encodeURIComponent(schoolId) +
    (entity && page === 'orders' ? '&orderId=' + entity : '')
  );
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
    ...(process.env.FLY_MACHINE_ID ? { issuer: machineId(process.env.FLY_MACHINE_ID) } : {}),
    stage: 'execute',
    binding: hash(binding),
    tool,
    argsHash: hash(args),
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
export function verifyCard(binding: Binding, raw: unknown, secret: string, now: number) {
  const p = signedPayload(raw, secret);
  const v = object(raw, ['token', 'args']);
  if (p.issuer !== undefined && p.issuer !== process.env.FLY_MACHINE_ID)
    return fail('CONFIRMATION_REVOKED', 409);
  const current = proposals.get(hash(binding));
  if (!current || current.seq !== p.proposalSeq || current.revoked.has(String(p.mutationId)))
    return fail('CONFIRMATION_REVOKED', 409);
  if (
    p.v !== 2 ||
    p.stage !== 'execute' ||
    p.binding !== hash(binding) ||
    !Number.isSafeInteger(p.iat) ||
    !Number.isSafeInteger(p.exp) ||
    Number(p.iat) > now ||
    Number(p.exp) <= now ||
    Number(p.exp) - Number(p.iat) !== 300000 ||
    !Number.isSafeInteger(p.revision) ||
    Number(p.revision) < 0 ||
    !['propose_personal_event', 'propose_open_page', 'propose_food_order'].includes(String(p.tool))
  )
    return fail('CONFIRMATION_INVALID', 409);
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
    tool: p.tool as Card['tool'],
    args,
    revision: Number(p.revision),
    mutationId: p.mutationId,
    iat: Number(p.iat),
  };
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
) {
  const p = verifyCard(binding, raw, secret, now);
  if (p.tool === 'propose_food_order') {
    const cart = cartArgs(p.args.cart);
    if (
      !(await adapter.realms()).some(
        (r) => r.tenantId === cart.tenantId && r.schoolId === binding.schoolId,
      )
    )
      return fail('FORBIDDEN_SCOPE', 403);
    if (!adapter.food) return fail('ORDERING_DISABLED', 403);
    if (p.args.mode === 'page' || !adapter.food.enabled() || adapter.food.paymentRequired)
      return { href: String(p.args.href), reason: p.args.reason };
    const summary = priceCart(cart, await adapter.food.menu(cart.tenantId, cart.locationId));
    if (canonical(summary) !== canonical(p.args.summary)) return fail('PRICE_CHANGED', 409);
    verifyCard(binding, raw, secret, now);
    operationSignal()?.throwIfAborted();
    return adapter.food.submit(cart, p.mutationId);
  }
  if (p.tool === 'propose_open_page') return { href: pageHref(p.args, binding.schoolId) };
  if (!writes) return fail('ASSISTANT_WRITE_UNAVAILABLE', 403);
  const ledger = await adapter.ledger();
  if (ledger.schoolId !== binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
  const row = eventRecord(eventArgs(p.args), binding.schoolId, p.mutationId, p.iat);
  const existing = ledger.records.find((r) => r.id === p.mutationId);
  if (existing) {
    if (canonical(existing) !== canonical(row)) return fail('CONFIRMATION_CONFLICT', 409);
    return { confirmed: true, replay: true, mutationId: p.mutationId };
  }
  if (ledger.revision !== p.revision) return fail('PERSONAL_IMPORT_REVISION_CONFLICT', 409);
  const records = validatePersonalImportSyncRecords([...ledger.records, row], binding.schoolId);
  verifyCard(binding, raw, secret, now);
  operationSignal()?.throwIfAborted();
  await adapter.write({
    schoolId: binding.schoolId,
    expectedRevision: p.revision,
    records,
    mutationId: p.mutationId,
  });
  return { confirmed: true, replay: false, mutationId: p.mutationId };
}
export function eventInterval(a: EventArgs): [number, number] {
  return [
    Date.parse(`${a.date}T${a.allDay ? '00:00' : a.startTime}:00+08:00`),
    Date.parse(
      `${a.endDate || (a.allDay ? addDays(a.date, 1) : a.date)}T${a.allDay ? '00:00' : a.endTime}:00+08:00`,
    ),
  ];
}
