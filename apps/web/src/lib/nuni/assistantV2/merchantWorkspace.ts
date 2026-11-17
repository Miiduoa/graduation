import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import { findSchoolById } from '@campus/shared/src/schools';
import { parseMerchantWorkspaces, type NuniMerchantWorkspace } from '@campus/shared/src/nuniMerchant';
import { V2Error } from './contracts';

export type MerchantArguments = { tenantId?: string; locationId?: string };
export type MerchantTarget = { tenantId: string; locationId: string };
export const MERCHANT_QUEUE_STATES = [
  'payment-pending', 'paid', 'accepted', 'preparing', 'ready',
  'cancellation-pending-refund', 'rejection-pending-refund',
] as const;
export type MerchantQueueState = (typeof MERCHANT_QUEUE_STATES)[number];
export type MerchantOrderSummary = {
  status: 'ready' | 'unavailable' | 'not-read';
  total: number;
  counts: Record<MerchantQueueState, number>;
  hasMore: boolean;
};
export type MerchantShiftSummary = {
  status: 'open' | 'not-open' | 'unavailable' | 'not-read';
  openedAt?: string;
};
export type MerchantRead = {
  version: 1;
  source: 'platform-merchant';
  sourcePath: 'merchant-workspaces';
  schoolId: string;
  checkedAt: string;
  query: MerchantArguments;
  status: 'ready' | 'selection-required' | 'unavailable';
  workspaces: NuniMerchantWorkspace[];
  workspaceCount: number;
  scopeUnresolved: boolean;
  selected: NuniMerchantWorkspace | null;
  orders: MerchantOrderSummary;
  shift: MerchantShiftSummary;
  partial: boolean;
  href: string;
  unavailable?: 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE' | 'SCOPE_UNAVAILABLE';
};

function record(raw: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw new Error('Invalid record');
  const values: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error('Invalid field');
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined)
      throw new Error('Invalid field');
    values[key] = descriptor.value;
  }
  if (!required.every(key => Object.hasOwn(values, key))) throw new Error('Missing field');
  return values;
}

function list(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > max)
    throw new Error('Invalid list');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== raw.length + 1) throw new Error('Invalid list');
  return Array.from({ length: raw.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Invalid list');
    return descriptor.value;
  });
}

function text(raw: unknown, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim() || raw.length > max ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(raw)) throw new Error('Invalid text');
  return raw;
}

function tenantId(raw: unknown): string {
  const value = text(raw, 100);
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value)) throw new Error('Invalid tenant');
  return value;
}

function locationId(raw: unknown): string {
  const value = text(raw, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value))
    throw new Error('Invalid location');
  return value;
}

function validSchool(schoolId: string): void {
  if (typeof schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) ||
      ['all', 'personal'].includes(schoolId)) throw new Error('Invalid school');
}

function instant(raw: unknown): string {
  const value = text(raw, 40);
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error('Invalid instant');
  return value;
}

function number(raw: unknown, max = 100): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0 || Number(raw) > max) throw new Error('Invalid count');
  return Number(raw);
}

/** An explicit selection is an exact pair of source IDs. Names, roles, account
 * IDs, cursors and customer filters are not accepted as authority. The runtime
 * additionally binds these arguments to the user's exact parsed request. */
export function parseMerchantArguments(raw: unknown): MerchantArguments {
  try {
    const value = record(raw, ['tenantId', 'locationId'], []);
    if (value.tenantId === undefined && value.locationId === undefined) return {};
    if (value.tenantId === undefined || value.locationId === undefined) throw new Error('Incomplete scope');
    return { tenantId: tenantId(value.tenantId), locationId: locationId(value.locationId) };
  } catch { throw new V2Error(422, 'MERCHANT_INVALID_INPUT'); }
}

export function merchantHref(schoolId: string): string {
  try { validSchool(schoolId); }
  catch { throw new V2Error(422, 'MERCHANT_INVALID_INPUT'); }
  return assistantServiceHref('merchant', schoolId)!;
}

/** Whole explicit clauses only. In particular, a personal customer's orders,
 * a date-filtered queue or a named shop cannot widen into a merchant read. */
export function parseMerchantRead(question: string): { tool: 'get_merchant_overview'; args: MerchantArguments } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 120 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|看看|查|看|列出|顯示|核對|檢查|目前的|目前|現在的|現在))*/, '');
  value = value.replace(/(?:有哪些|有什麼|資訊|資料|概況|摘要)?(?:嗎|呢)?$/, '');
  return /^(?:我的?)?(?:店家(?:營運|訂單|待處理訂單|班次|交班)|門市(?:營運|訂單|待處理訂單|班次|交班)|授權門市|管理的門市|店家工作區|門市工作區)(?:狀態)?$/.test(value)
    ? { tool: 'get_merchant_overview', args: {} } : null;
}

/** This is the account-scoped merchant list, not the public food catalogue.
 * Reject altered coverage, duplicate identities and unrecognized private data
 * instead of filtering a malformed response into an apparent complete list. */
export function parseMerchantWorkspaceSource(raw: unknown, max = 100): NuniMerchantWorkspace[] {
  try {
    const value = record(raw, ['workspaces']);
    const items = list(value.workspaces, max);
    for (const item of items) {
      const row = record(item, ['tenantId', 'tenantName', 'merchantName', 'locationId', 'locationName',
        'campusName', 'merchantStatus', 'locationStatus', 'publicAccess', 'activated', 'missingRequirements']);
      tenantId(row.tenantId);
      locationId(row.locationId);
      for (const name of ['tenantName', 'merchantName', 'locationName', 'campusName']) text(row[name], 200);
      if (!['active', 'suspended'].includes(String(row.merchantStatus)) ||
          !['open', 'closed', 'suspended'].includes(String(row.locationStatus))) throw new Error('Invalid state');
      const missing = list(row.missingRequirements, 3);
      if (new Set(missing).size !== missing.length ||
          missing.some(item => !['settings', 'menu', 'online-payment'].includes(String(item))))
        throw new Error('Invalid requirements');
    }
    const parsed = parseMerchantWorkspaces({ workspaces: items });
    if (new Set(parsed.map(item => item.tenantId + ':' + item.locationId)).size !== parsed.length)
      throw new Error('Duplicate workspace');
    return parsed;
  } catch { throw new V2Error(502, 'INVALID_MERCHANT_RESULT'); }
}

export function emptyMerchantOrders(status: MerchantOrderSummary['status'] = 'not-read'): MerchantOrderSummary {
  return { status, total: 0,
    counts: Object.fromEntries(MERCHANT_QUEUE_STATES.map(state => [state, 0])) as MerchantOrderSummary['counts'],
    hasMore: false };
}

/** Revalidate the minimal projection at every tool, task and result boundary.
 * Customer IDs, names, notes, pickup credentials, menu lines and cash figures
 * have no fields in this contract and cannot reach chat through this reader. */
export function parseMerchantResult(raw: unknown, schoolId: string, args: unknown = {}, expectedTarget?: MerchantTarget): MerchantRead {
  try {
    validSchool(schoolId);
    const requested = parseMerchantArguments(args);
    const expected = expectedTarget === undefined ? undefined : parseMerchantArguments(expectedTarget);
    if (expected && (!expected.tenantId || !expected.locationId ||
        (requested.tenantId && JSON.stringify(requested) !== JSON.stringify(expected))))
      throw new Error('Invalid continuation scope');
    const value = record(raw, ['version', 'source', 'sourcePath', 'schoolId', 'checkedAt', 'query', 'status',
      'workspaces', 'workspaceCount', 'scopeUnresolved', 'selected', 'orders', 'shift', 'partial', 'href', 'unavailable'],
    ['version', 'source', 'sourcePath', 'schoolId', 'checkedAt', 'query', 'status',
      'workspaces', 'workspaceCount', 'scopeUnresolved', 'selected', 'orders', 'shift', 'partial', 'href']);
    const query = parseMerchantArguments(value.query);
    if (value.version !== 1 || value.source !== 'platform-merchant' || value.sourcePath !== 'merchant-workspaces' ||
        value.schoolId !== schoolId || JSON.stringify(query) !== JSON.stringify(requested) ||
        value.href !== merchantHref(schoolId) || !['ready', 'selection-required', 'unavailable'].includes(String(value.status)) ||
        typeof value.scopeUnresolved !== 'boolean' || typeof value.partial !== 'boolean') throw new Error('Invalid source');
    const workspaces = parseMerchantWorkspaceSource({ workspaces: value.workspaces }, 5);
    const workspaceCount = number(value.workspaceCount);
    if (workspaces.length !== Math.min(5, workspaceCount)) throw new Error('Invalid coverage');
    const selected = value.selected === null ? null : parseMerchantWorkspaceSource({ workspaces: [value.selected] }, 1)[0];
    if (selected && !workspaces.some(row => JSON.stringify(row) === JSON.stringify(selected))) throw new Error('Invalid selection');
    if (selected && query.tenantId && (selected.tenantId !== query.tenantId || selected.locationId !== query.locationId))
      throw new Error('Invalid selection');
    if (selected && expected && (selected.tenantId !== expected.tenantId || selected.locationId !== expected.locationId))
      throw new Error('Invalid continuation selection');
    const order = record(value.orders, ['status', 'total', 'counts', 'hasMore']);
    if (!['ready', 'unavailable', 'not-read'].includes(String(order.status)) || typeof order.hasMore !== 'boolean')
      throw new Error('Invalid orders');
    const count = record(order.counts, MERCHANT_QUEUE_STATES);
    const counts = Object.fromEntries(MERCHANT_QUEUE_STATES.map(state => [state, number(count[state])])) as MerchantOrderSummary['counts'];
    const total = number(order.total);
    if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== total ||
        (order.status !== 'ready' && (total !== 0 || order.hasMore))) throw new Error('Invalid orders');
    const shift = record(value.shift, ['status', 'openedAt'], ['status']);
    if (!['open', 'not-open', 'unavailable', 'not-read'].includes(String(shift.status)) ||
        (shift.status === 'open') !== Object.hasOwn(shift, 'openedAt')) throw new Error('Invalid shift');
    const orders: MerchantOrderSummary = { status: order.status as MerchantOrderSummary['status'], total, counts, hasMore: order.hasMore };
    const parsedShift: MerchantShiftSummary = { status: shift.status as MerchantShiftSummary['status'],
      ...(shift.openedAt ? { openedAt: instant(shift.openedAt) } : {}) };
    if (selected ? value.status !== 'ready' || orders.status === 'not-read' || parsedShift.status === 'not-read'
      : orders.status !== 'not-read' || parsedShift.status !== 'not-read') throw new Error('Invalid reader state');
    if (value.status === 'ready' && !selected && (workspaceCount !== 0 || value.scopeUnresolved || query.tenantId || expected))
      throw new Error('Missing selection');
    if (value.status === 'selection-required' && (selected || expected || (workspaceCount < 2 && !value.scopeUnresolved) || !value.partial))
      throw new Error('Invalid selection state');
    if (value.status === 'unavailable') {
      if (!['NOT_CONNECTED', 'SOURCE_UNAVAILABLE', 'SCOPE_UNAVAILABLE'].includes(String(value.unavailable)) ||
          selected || workspaces.length || workspaceCount || value.partial ||
          (value.unavailable === 'SCOPE_UNAVAILABLE') !== value.scopeUnresolved) throw new Error('Invalid unavailable source');
    } else {
      if (value.unavailable !== undefined) throw new Error('Invalid unavailable source');
      const partial = value.status === 'selection-required' || workspaceCount > workspaces.length || value.scopeUnresolved ||
        orders.hasMore || orders.status === 'unavailable' || parsedShift.status === 'unavailable';
      if (value.partial !== partial) throw new Error('Invalid partial state');
      if (selected && !query.tenantId && !expected && (workspaceCount !== 1 || value.scopeUnresolved))
        throw new Error('Ambiguous implicit selection');
    }
    return { version: 1, source: 'platform-merchant', sourcePath: 'merchant-workspaces', schoolId,
      checkedAt: instant(value.checkedAt), query, status: value.status as MerchantRead['status'], workspaces,
      workspaceCount, scopeUnresolved: value.scopeUnresolved, selected, orders, shift: parsedShift,
      partial: value.partial, href: value.href as string,
      ...(value.unavailable ? { unavailable: value.unavailable as MerchantRead['unavailable'] } : {}) };
  } catch { throw new V2Error(502, 'INVALID_MERCHANT_RESULT'); }
}

function excerpt(value: string, max: number): string {
  const plain = value.replace(/<[^>]*>/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\\`*_{}[\]()#+!>|]/g, '');
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
}
const taiwanTime = (value: string) => new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16).replace('T', ' ');
const stateLabels: Record<MerchantQueueState, string> = {
  'payment-pending': '待付款', paid: '已付款待接單', accepted: '已接單', preparing: '製作中', ready: '待取餐',
  'cancellation-pending-refund': '取消待退款', 'rejection-pending-refund': '拒單待退款',
};

/** The final facts come from this formatter. Source-controlled shop names are
 * quoted display text; no order note or shop name may supply further actions. */
export function formatMerchantRead(read: MerchantRead): string {
  const lines = [`校園：${findSchoolById(read.schoolId)?.name || read.schoolId}；查詢時間：${taiwanTime(read.checkedAt)}（台北）。`,
    `來源：本人授權門市 ${read.href}`];
  if (read.status === 'unavailable') {
    lines.push(read.unavailable === 'SCOPE_UNAVAILABLE'
      ? '授權門市與目前校園的對應尚未核對，尚未讀取門市訂單或班次。'
      : read.unavailable === 'NOT_CONNECTED' ? '目前未接通可核對的店家來源，無法判定門市營運狀態。'
        : '店家來源目前無法讀取，門市營運狀態尚待核對。');
    return lines.join('\n');
  }
  if (read.status === 'selection-required') {
    lines.push('需要先確認要查看的門市；尚未讀取任何門市訂單或班次。');
    for (const item of read.workspaces) lines.push(`・門市：「${excerpt(item.merchantName, 35)}／${excerpt(item.locationName, 35)}」（${excerpt(item.campusName, 25)}）`);
    if (read.workspaceCount > read.workspaces.length) lines.push(`另有 ${read.workspaceCount - read.workspaces.length} 間未展開。`);
    if (read.scopeUnresolved) lines.push('另有授權門市尚未核對校園對應，沒有自動選取。');
    lines.push('請在店家工作區選擇門市後查看營運資料。');
    return lines.join('\n');
  }
  const workspace = read.selected;
  if (!workspace) {
    lines.push('目前校園的授權門市清單沒有項目；可到店家工作區查看申請與授權進度。');
    return lines.join('\n');
  }
  lines.push(`門市：「${excerpt(workspace.merchantName, 45)}／${excerpt(workspace.locationName, 45)}」。`);
  const state = workspace.merchantStatus === 'suspended' || workspace.locationStatus === 'suspended' ? '已停權'
    : !workspace.activated ? '待完成營運設定'
      : workspace.locationStatus === 'open' && workspace.publicAccess ? '營業中'
        : workspace.locationStatus === 'closed' && !workspace.publicAccess ? '暫停接單' : '營運狀態待確認';
  lines.push(`門市來源狀態：${state}。`);
  const requirements = { settings: '營運設定', menu: '初始菜單', 'online-payment': '線上付款設定' };
  if (workspace.missingRequirements.length)
    lines.push('尚缺：' + workspace.missingRequirements.map(item => requirements[item as keyof typeof requirements]).join('、') + '。');
  if (read.orders.status === 'unavailable') lines.push('待處理訂單來源暫時無法讀取，不能視為沒有訂單。');
  else {
    lines.push(`本次可見待處理訂單：${read.orders.total} 筆${read.orders.hasMore ? '（尚有其餘頁面）' : ''}。`);
    const counts = MERCHANT_QUEUE_STATES.filter(state => read.orders.counts[state] > 0)
      .map(state => `${stateLabels[state]} ${read.orders.counts[state]} 筆`);
    if (counts.length) lines.push(counts.join('、') + '。');
  }
  lines.push(read.shift.status === 'open' ? `目前班次：已於 ${taiwanTime(read.shift.openedAt!)}（台北）開班。`
    : read.shift.status === 'not-open' ? '目前班次：來源確認沒有開啟中的班次。'
      : '目前班次：來源暫時無法讀取，交班狀態尚待核對。');
  if (read.scopeUnresolved || read.workspaceCount > read.workspaces.length) lines.push('門市目錄尚有未展開或未核對校園的部分。');
  return lines.join('\n');
}

/** The model receives no source-controlled names, customer text, identifiers,
 * credentials or financial records. The verified formatter supplies details. */
export function merchantModelSummary(read: MerchantRead): Record<string, unknown> {
  return { source: read.source, status: read.status, partial: read.partial,
    workspaceCount: read.workspaceCount, scopeUnresolved: read.scopeUnresolved,
    selected: read.selected !== null, orders: read.orders, shift: { status: read.shift.status } };
}
