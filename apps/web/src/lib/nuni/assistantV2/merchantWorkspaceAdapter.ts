import { parseNuniFoodMerchantOrders, parseNuniFoodShift } from '@campus/shared/src/nuniFood';
import { V2Error } from './contracts';
import {
  emptyMerchantOrders, merchantHref, parseMerchantArguments, parseMerchantResult, parseMerchantWorkspaceSource,
  type MerchantArguments, type MerchantRead, type MerchantTarget,
} from './merchantWorkspace';

export type MerchantTransport = (
  path: string, input?: Record<string, unknown>, query?: Record<string, string>,
) => Promise<unknown>;
export type MerchantReaderOptions = {
  schoolId: string;
  args: unknown;
  request: MerchantTransport;
  /** The caller's existing trusted school/realm mapping, never a model lookup. */
  scopedRealm: (raw: Record<string, unknown>) => { tenantId: string; schoolId?: string };
  /** Recheck the original session, cancellation and operation scope. */
  guard: () => void;
  now?: number;
  /** Internal signed continuation identity; never a model-facing argument. */
  expectedTarget?: MerchantTarget;
};

function sourceFailure(error: unknown): 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE' | null {
  if (!error || typeof error !== 'object') return null;
  const failure = error as { status?: number; code?: string };
  if (failure.status === 401 || failure.status === 403 || failure.status === 429 ||
      ['SESSION_CHANGED', 'ABORTED', 'API_BUDGET_EXCEEDED', 'CONFIGURATION_REQUIRED', 'INVALID_RESPONSE',
        'INVALID_MERCHANT_RESULT', 'TOOL_TIMEOUT', 'DEADLINE_EXCEEDED'].includes(failure.code || '')) return null;
  return failure.status === 404 ? 'NOT_CONNECTED' : failure.status === 503 ? 'SOURCE_UNAVAILABLE' : null;
}

function realmRows(raw: unknown): Record<string, unknown>[] {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => key !== 'realms'))
      throw new Error('Invalid realms');
    const realms = (raw as { realms?: unknown }).realms;
    if (!Array.isArray(realms) || realms.length > 100 ||
        Object.keys(realms).length !== realms.length) throw new Error('Invalid realms');
    const seen = new Set<string>();
    return realms.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid realm');
      const value = raw as Record<string, unknown>;
      if (typeof value.tenantId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(value.tenantId) ||
          seen.has(value.tenantId) || (value.schoolId !== undefined &&
            (typeof value.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.schoolId))))
        throw new Error('Invalid realm');
      seen.add(value.tenantId);
      return value;
    });
  } catch { throw new V2Error(502, 'INVALID_MERCHANT_RESULT'); }
}

/** Four bounded authenticated GETs at most. No public-food substitution, school
 * credential, buyer-order endpoint, mutations, background requests or retries.
 * Every source is re-read on every call; selection is never inferred from names. */
export async function readMerchantOverview(options: MerchantReaderOptions): Promise<MerchantRead> {
  const { schoolId, request, guard, scopedRealm } = options;
  const args: MerchantArguments = parseMerchantArguments(options.args);
  const expected = options.expectedTarget === undefined ? undefined : parseMerchantArguments(options.expectedTarget);
  if (expected && (!expected.tenantId || !expected.locationId ||
      (args.tenantId && JSON.stringify(args) !== JSON.stringify(expected))))
    throw new V2Error(422, 'MERCHANT_INVALID_INPUT');
  const target = expected ?? (args.tenantId ? args : undefined);
  const href = merchantHref(schoolId);
  const checkedAt = new Date(options.now ?? Date.now()).toISOString();
  const result: MerchantRead = { version: 1, source: 'platform-merchant', sourcePath: 'merchant-workspaces',
    schoolId, checkedAt, query: args, status: 'ready', workspaces: [], workspaceCount: 0, scopeUnresolved: false,
    selected: null, orders: emptyMerchantOrders(), shift: { status: 'not-read' }, partial: false, href };
  const get = async (path: string): Promise<unknown> => {
    guard();
    try {
      const raw = await request(path);
      guard();
      return raw;
    } catch (error) {
      // A source failure must not hide a concurrently invalidated account.
      guard();
      throw error;
    }
  };
  const finish = () => { guard(); return parseMerchantResult(result, schoolId, args, options.expectedTarget); };
  let rawWorkspaces: unknown;
  try { rawWorkspaces = await get('merchant-workspaces'); }
  catch (error) {
    const reason = sourceFailure(error);
    if (!reason) throw error;
    result.status = 'unavailable'; result.unavailable = reason;
    return finish();
  }
  const workspaces = parseMerchantWorkspaceSource(rawWorkspaces);
  if (!workspaces.length) {
    if (target) throw new V2Error(403, 'FORBIDDEN_SCOPE');
    return finish();
  }
  let rawRealms: unknown;
  try { rawRealms = await get('realms'); }
  catch (error) {
    const reason = sourceFailure(error);
    if (!reason) throw error;
    result.status = 'unavailable'; result.unavailable = reason;
    return finish();
  }
  const realms = new Map<string, string | undefined>();
  for (const raw of realmRows(rawRealms)) {
    guard();
    const scoped = scopedRealm(raw);
    if (scoped.tenantId !== raw.tenantId || (raw.schoolId !== undefined && raw.schoolId !== scoped.schoolId) || (scoped.schoolId !== undefined &&
        (typeof scoped.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(scoped.schoolId))))
      throw new V2Error(502, 'INVALID_MERCHANT_RESULT');
    realms.set(scoped.tenantId, scoped.schoolId);
  }
  guard();
  result.scopeUnresolved = workspaces.some(workspace => !realms.get(workspace.tenantId));
  const candidates = workspaces.filter(workspace => realms.get(workspace.tenantId) === schoolId);
  result.workspaceCount = candidates.length;
  result.workspaces = candidates.slice(0, 5);
  if (target) {
    const selected = candidates.find(row => row.tenantId === target.tenantId && row.locationId === target.locationId);
    if (!selected) throw new V2Error(403, 'FORBIDDEN_SCOPE');
    result.selected = selected;
    if (!result.workspaces.some(row => row.tenantId === selected.tenantId && row.locationId === selected.locationId))
      result.workspaces = [...candidates.slice(0, 4), selected];
  } else if (candidates.length === 1 && !result.scopeUnresolved) result.selected = candidates[0];
  else if (!candidates.length && result.scopeUnresolved) {
    result.status = 'unavailable'; result.unavailable = 'SCOPE_UNAVAILABLE';
    return finish();
  } else if (candidates.length > 1 || result.scopeUnresolved) {
    result.status = 'selection-required'; result.partial = true;
    return finish();
  } else return finish();
  const selected = result.selected!;
  const base = `merchant-workspaces/${selected.tenantId}/${selected.locationId}`;
  let rawOrders: unknown;
  try { rawOrders = await get(`${base}/orders`); }
  catch (error) {
    if (!sourceFailure(error)) throw error;
    result.orders = emptyMerchantOrders('unavailable');
  }
  if (rawOrders !== undefined) {
    const page = parseNuniFoodMerchantOrders(rawOrders, selected.locationId);
    if (new Set(page.orders.map(row => row.id)).size !== page.orders.length ||
        page.orders.some(row => !/^[A-Za-z0-9_-]{1,100}$/.test(row.id)))
      throw new V2Error(502, 'INVALID_MERCHANT_RESULT');
    result.orders = emptyMerchantOrders('ready');
    result.orders.total = page.orders.length;
    for (const row of page.orders) result.orders.counts[row.state]++;
    result.orders.hasMore = Boolean(page.nextCursor);
  }
  guard();
  let rawShift: unknown;
  try { rawShift = await get(`${base}/shift`); }
  catch (error) {
    const failure = error as { status?: number; code?: string };
    if (failure.status === 404 && failure.code === 'FOOD_SHIFT_NOT_FOUND') result.shift = { status: 'not-open' };
    else if (sourceFailure(error)) result.shift = { status: 'unavailable' };
    else throw error;
  }
  if (rawShift !== undefined) {
    const shift = parseNuniFoodShift(rawShift, selected.locationId);
    if (shift.state !== 'open' || Date.parse(shift.openedAt) > Date.parse(checkedAt))
      throw new V2Error(502, 'INVALID_MERCHANT_RESULT');
    result.shift = { status: 'open', openedAt: new Date(shift.openedAt).toISOString() };
  }
  result.partial = result.scopeUnresolved || result.workspaceCount > result.workspaces.length ||
    result.orders.hasMore || result.orders.status === 'unavailable' || result.shift.status === 'unavailable';
  return finish();
}
