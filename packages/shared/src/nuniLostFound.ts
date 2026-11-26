import { NuniError } from './nuni';
import type { LostFoundWriteFields } from './lostFoundFields';

export const NUNI_LOST_FOUND_BODY_LIMIT = 16 * 1024;
export const NUNI_LOST_FOUND_PAGE_LIMIT = 50;
export const NUNI_LOST_FOUND_CATEGORIES = [
  'electronics', 'cards', 'documents', 'wallet', 'clothing',
  'accessories', 'books', 'keys', 'other',
] as const;
export const NUNI_LOST_FOUND_CONTACT_NOTE =
  '聯絡方式會顯示給所有已登入使用者（不限本校）；結案後會清除聯絡方式。';

export type NuniLostFoundItem = Omit<LostFoundWriteFields, 'contactInfo'> & {
  id: string;
  schoolId: string;
  status: 'open' | 'resolved';
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  isOwner: boolean;
  /** List summaries omit contact; an authenticated detail request includes it. */
  contactInfo?: string;
};
export type NuniLostFoundPage = {
  schoolId: string;
  items: NuniLostFoundItem[];
  nextCursor: string | null;
};
export type NuniLostFoundListInput = {
  schoolId: string;
  mine?: boolean;
  q?: string;
  type?: 'lost' | 'found';
  category?: string;
  status?: 'open' | 'resolved' | 'all';
  cursor?: string;
  limit?: number;
};
export type NuniLostFoundExportInput = Pick<NuniLostFoundListInput, 'schoolId' | 'cursor' | 'limit'>;
export type NuniLostFoundTarget = { schoolId: string; id: string };
export type NuniLostFoundCreateInput = NuniLostFoundTarget & {
  mutationId: string;
  fields: LostFoundWriteFields;
};
export type NuniLostFoundMutationInput = NuniLostFoundTarget & {
  expectedVersion: number;
  mutationId: string;
};
export type NuniLostFoundUpdateInput = NuniLostFoundMutationInput & { fields: LostFoundWriteFields };
export type NuniLostFoundRemoval = NuniLostFoundTarget & { removed: true };
export type NuniLostFoundRequests = {
  list: NuniLostFoundListInput;
  get: NuniLostFoundTarget;
  create: NuniLostFoundCreateInput;
  update: NuniLostFoundUpdateInput;
  resolve: NuniLostFoundMutationInput;
  remove: NuniLostFoundMutationInput;
  export: NuniLostFoundExportInput;
};
export type NuniLostFoundAction = keyof NuniLostFoundRequests;
export type NuniLostFoundResponses = {
  list: NuniLostFoundPage;
  get: { item: NuniLostFoundItem };
  create: { item: NuniLostFoundItem };
  update: { item: NuniLostFoundItem };
  resolve: { item: NuniLostFoundItem };
  remove: NuniLostFoundRemoval;
  export: NuniLostFoundPage;
};
export type NuniLostFoundTransport = (
  path: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

const actions: NuniLostFoundAction[] = ['list', 'get', 'create', 'update', 'resolve', 'remove', 'export'];
const itemId = /^plf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const schoolId = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const token = /^[A-Za-z0-9_-]{1,1024}$/;
type Fail = () => never;
const invalidInput: Fail = () => { throw new NuniError(422, 'LOST_FOUND_INVALID_INPUT'); };
const invalidResponse: Fail = () => { throw new NuniError(502, 'INVALID_RESPONSE'); };

function object(value: unknown, allowed: readonly string[], fail: Fail): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) return fail();
    result[key] = descriptor.value;
  }
  return result;
}
function text(value: unknown, min: number, max: number, fail: Fail, trim = true): string {
  if (typeof value !== 'string') return fail();
  const parsed = trim ? value.trim() : value;
  if (parsed.length < min || parsed.length > max ||
    !/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF])*$/.test(parsed)) return fail();
  for (const character of parsed) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return fail();
  }
  return parsed;
}
function choice<T extends string>(value: unknown, choices: readonly T[], fail: Fail): T {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fail();
}
function integer(value: unknown, min: number, max: number, fail: Fail): number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fail();
}
function scope(value: unknown, fail: Fail): string {
  return typeof value === 'string' && value.trim() === value && schoolId.test(value) &&
    !['personal', 'all', 'unavailable-campus'].includes(value) ? value : fail();
}
function id(value: unknown, fail: Fail): string {
  return typeof value === 'string' && value.length === 40 && itemId.test(value) ? value : fail();
}
function cursor(value: unknown, fail: Fail): string {
  return typeof value === 'string' && value.trim() === value && token.test(value) ? value : fail();
}
function day(value: unknown, fail: Fail): string {
  const parsed = text(value, 10, 10, fail, false);
  if (!/^(?:19|[2-9]\d)\d{2}-\d{2}-\d{2}$/.test(parsed) ||
    !Number.isFinite(Date.parse(parsed)) || new Date(parsed).toISOString().slice(0, 10) !== parsed) return fail();
  return parsed;
}
function instant(value: unknown, fail: Fail): string {
  const parsed = text(value, 24, 24, fail, false);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) ||
    !Number.isFinite(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed) return fail();
  return parsed;
}
function fields(value: unknown, fail: Fail, create = false): LostFoundWriteFields {
  const row = object(value, ['type', 'title', 'description', 'category', 'location', 'date', 'contactInfo'], fail);
  return {
    type: choice(row.type, ['lost', 'found'], fail),
    title: text(row.title, 1, 80, fail),
    description: text(row.description, 1, 2000, fail),
    category: choice(row.category, NUNI_LOST_FOUND_CATEGORIES, fail),
    location: text(row.location, 1, 120, fail),
    date: day(row.date, fail),
    ...(row.contactInfo === undefined ? (create ? { contactInfo: '' } : {})
      : { contactInfo: text(row.contactInfo, 0, 200, fail) }),
  };
}

export function isNuniLostFoundAction(value: string): value is NuniLostFoundAction {
  return actions.includes(value as NuniLostFoundAction);
}

export function validateNuniLostFoundRequest<A extends NuniLostFoundAction>(
  action: A,
  value: unknown,
): NuniLostFoundRequests[A] {
  if (!isNuniLostFoundAction(action)) return invalidInput();
  const allowed = action === 'list' ? ['schoolId', 'mine', 'q', 'type', 'category', 'status', 'cursor', 'limit']
    : action === 'export' ? ['schoolId', 'cursor', 'limit']
      : action === 'get' ? ['schoolId', 'id']
        : action === 'create' ? ['schoolId', 'id', 'mutationId', 'fields']
          : action === 'update' ? ['schoolId', 'id', 'expectedVersion', 'mutationId', 'fields']
            : ['schoolId', 'id', 'expectedVersion', 'mutationId'];
  const row = object(value, allowed, invalidInput);
  const result: Record<string, unknown> = { schoolId: scope(row.schoolId, invalidInput) };
  if (action === 'list' || action === 'export') {
    if (row.cursor !== undefined) result.cursor = cursor(row.cursor, invalidInput);
    if (row.limit !== undefined) result.limit = integer(row.limit, 1, NUNI_LOST_FOUND_PAGE_LIMIT, invalidInput);
    if (action === 'list') {
      if (row.mine !== undefined) {
        if (typeof row.mine !== 'boolean') return invalidInput();
        result.mine = row.mine;
      }
      if (row.q !== undefined) result.q = text(row.q, 0, 100, invalidInput);
      if (row.type !== undefined) result.type = choice(row.type, ['lost', 'found'], invalidInput);
      if (row.category !== undefined) result.category = choice(row.category, NUNI_LOST_FOUND_CATEGORIES, invalidInput);
      if (row.status !== undefined) result.status = choice(row.status, ['open', 'resolved', 'all'], invalidInput);
    }
  } else {
    result.id = id(row.id, invalidInput);
    if (action !== 'get') {
      if (typeof row.mutationId !== 'string' || row.mutationId.trim() !== row.mutationId ||
        !/^[A-Za-z0-9_-]{8,100}$/.test(row.mutationId)) return invalidInput();
      result.mutationId = row.mutationId;
      if (action !== 'create') result.expectedVersion = integer(row.expectedVersion, 1, 2_147_483_646, invalidInput);
      if (action === 'create' || action === 'update') result.fields = fields(row.fields, invalidInput, action === 'create');
    }
  }
  return result as NuniLostFoundRequests[A];
}

function item(value: unknown, input: NuniLostFoundTarget | { schoolId: string }, contact: boolean, own: boolean) {
  const row = object(value, ['id', 'schoolId', 'type', 'title', 'description', 'category', 'location', 'date',
    'contactInfo', 'status', 'version', 'createdAt', 'updatedAt', 'resolvedAt', 'isOwner'], invalidResponse);
  const itemId = id(row.id, invalidResponse);
  const itemSchool = scope(row.schoolId, invalidResponse);
  if (itemSchool !== input.schoolId || ('id' in input && itemId !== input.id) ||
    typeof row.isOwner !== 'boolean' || (own && !row.isOwner) ||
    (contact ? typeof row.contactInfo !== 'string' : row.contactInfo !== undefined)) return invalidResponse();
  const status = choice(row.status, ['open', 'resolved'], invalidResponse);
  const resolvedAt = row.resolvedAt === null ? null : instant(row.resolvedAt, invalidResponse);
  if ((status === 'open') !== (resolvedAt === null) ||
    (status === 'resolved' && row.contactInfo !== undefined && row.contactInfo !== '')) return invalidResponse();
  const parsedFields = fields({ type: row.type, title: row.title, description: row.description,
    category: row.category, location: row.location, date: row.date,
    ...(contact ? { contactInfo: row.contactInfo } : {}) }, invalidResponse);
  return {
    ...parsedFields, id: itemId, schoolId: itemSchool, status,
    version: integer(row.version, 1, 2_147_483_647, invalidResponse),
    createdAt: instant(row.createdAt, invalidResponse), updatedAt: instant(row.updatedAt, invalidResponse),
    resolvedAt, isOwner: row.isOwner,
  } satisfies NuniLostFoundItem;
}

export function parseNuniLostFoundResponse<A extends NuniLostFoundAction>(
  action: A,
  value: unknown,
  input: NuniLostFoundRequests[A],
): NuniLostFoundResponses[A] {
  if (action === 'remove') {
    const row = object(value, ['id', 'schoolId', 'removed'], invalidResponse);
    if (row.removed !== true || row.id !== (input as NuniLostFoundTarget).id || row.schoolId !== input.schoolId) return invalidResponse();
    return { removed: true, id: row.id, schoolId: row.schoolId } as NuniLostFoundResponses[A];
  }
  if (action === 'list' || action === 'export') {
    const request = input as NuniLostFoundListInput;
    const row = object(value, ['schoolId', 'items', 'nextCursor'], invalidResponse);
    if (row.schoolId !== input.schoolId || !Array.isArray(row.items) ||
      row.items.length > (request.limit ?? NUNI_LOST_FOUND_PAGE_LIMIT)) return invalidResponse();
    const parsed = row.items.map(entry => item(entry, input, action === 'export', action === 'export' || request.mine === true));
    const status = action === 'export' ? 'all' : request.status ?? (request.mine ? 'all' : 'open');
    if (new Set(parsed.map(entry => entry.id)).size !== parsed.length || parsed.some(entry =>
      (status !== 'all' && entry.status !== status) || (request.type && entry.type !== request.type) ||
      (request.category && entry.category !== request.category))) return invalidResponse();
    const nextCursor = row.nextCursor === null ? null : cursor(row.nextCursor, invalidResponse);
    if (nextCursor !== null && (!parsed.length || nextCursor === request.cursor)) return invalidResponse();
    return { schoolId: input.schoolId, items: parsed, nextCursor } as NuniLostFoundResponses[A];
  }
  const row = object(value, ['item'], invalidResponse);
  const parsed = item(row.item, input, true, action !== 'get');
  if (action === 'create' || action === 'update') {
    const request = input as NuniLostFoundCreateInput | NuniLostFoundUpdateInput;
    const expectedVersion = action === 'create' ? 1 : (request as NuniLostFoundUpdateInput).expectedVersion + 1;
    if (parsed.status !== 'open' || parsed.version !== expectedVersion ||
      Object.entries(request.fields).some(([key, value]) =>
        value !== undefined && parsed[key as keyof NuniLostFoundItem] !== value)) return invalidResponse();
  } else if (action === 'resolve') {
    if (parsed.status !== 'resolved' || parsed.contactInfo !== '' ||
      parsed.version !== (input as NuniLostFoundMutationInput).expectedVersion + 1) return invalidResponse();
  }
  return { item: parsed } as NuniLostFoundResponses[A];
}

/** The caller binds this transport to one verified session and guards stale UI results. */
export function createNuniLostFound(transport: NuniLostFoundTransport) {
  async function run<A extends NuniLostFoundAction>(action: A, raw: NuniLostFoundRequests[A]) {
    const input = validateNuniLostFoundRequest(action, raw);
    const value = await transport(`lost-found/${action}`, { ...input });
    return parseNuniLostFoundResponse(action, value, input);
  }
  return {
    list: (input: NuniLostFoundListInput) => run('list', input),
    get: async (input: NuniLostFoundTarget) => (await run('get', input)).item,
    create: async (input: NuniLostFoundCreateInput) => (await run('create', input)).item,
    update: async (input: NuniLostFoundUpdateInput) => (await run('update', input)).item,
    resolve: async (input: NuniLostFoundMutationInput) => (await run('resolve', input)).item,
    remove: (input: NuniLostFoundMutationInput) => run('remove', input),
    export: (input: NuniLostFoundExportInput) => run('export', input),
  };
}
