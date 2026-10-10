import { NuniError, nuniRecord } from '@campus/shared/src/nuni';

export type SchoolModules = { leave: boolean; identity: boolean; food: boolean };
export type AdminSchool = {
  kind: 'application' | 'tenant';
  applicationId: string | null;
  tenantId: string | null;
  displayName: string;
  emailDomain: string | null;
  lifecycle: 'pending' | 'provisioned' | 'open' | 'suspended' | 'rejected';
  description: string;
  modules: SchoolModules;
  peopleCount: number;
  merchantCount: number;
};
export type AdminProxy = { tenantId: string; expiresAt: string; extended: boolean; ended: boolean };
export type AdminBoard = {
  tenantId: string;
  tenantName: string;
  id: string;
  name: string;
  description: string | null;
  joinPolicy: 'open' | 'request' | 'invite-only';
  postingPolicy: 'members' | 'moderators';
  canPost: boolean;
};
export type AdminAudit = {
  id: string;
  actionLabel: string;
  actorName: string;
  targetSchoolName: string | null;
  detail: string;
  createdAt: string;
  via: 'proxy' | 'school_admin' | 'operator';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type AdminReport = {
  id: string;
  tenantId: string;
  postId: string;
  state: 'open' | 'hidden' | 'dismissed';
  version: number;
  reason: 'harassment' | 'spam' | 'privacy' | 'hate' | 'violence' | 'other';
  createdAt: string;
  detail: string;
  snapshot: {
    id: string;
    tenantId: string;
    tenantName: string;
    communityId: string;
    communityName: string;
    text: string;
    author: { displayName: string; isSelf: boolean };
    publishedAt: string;
    version: number;
  };
  decisionReason: string | null;
  canDecide: boolean;
};

function invalid(): never {
  throw new NuniError(502, 'INVALID_RESPONSE');
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : invalid();
}
function enumeration<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : invalid();
}
export function parseSchool(value: unknown): AdminSchool {
  const row = nuniRecord(value),
    modules = nuniRecord(row.modules);
  const result: AdminSchool = {
    kind: enumeration(row.kind, ['application', 'tenant']),
    applicationId: nullableText(row.applicationId),
    tenantId: nullableText(row.tenantId),
    displayName: text(row.displayName),
    emailDomain: nullableText(row.emailDomain),
    lifecycle: enumeration(row.lifecycle, [
      'pending',
      'provisioned',
      'open',
      'suspended',
      'rejected',
    ]),
    description: text(row.description),
    modules: {
      leave: bool(modules.leave),
      identity: bool(modules.identity),
      food: bool(modules.food),
    },
    peopleCount: count(row.peopleCount),
    merchantCount: count(row.merchantCount),
  };
  if (
    result.kind === 'tenant' &&
    (!result.tenantId || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(result.tenantId))
  )
    invalid();
  if (result.kind === 'application' && !result.applicationId) invalid();
  return result;
}
export function parseSchools(value: unknown): AdminSchool[] {
  const rows = nuniRecord(value).schools;
  return Array.isArray(rows) ? rows.map(parseSchool) : invalid();
}
export function parseProxy(value: unknown, tenantId: string): AdminProxy {
  const row = nuniRecord(value);
  if (row.tenantId !== tenantId || !Number.isFinite(Date.parse(text(row.expiresAt)))) invalid();
  return {
    tenantId,
    expiresAt: text(row.expiresAt),
    extended: bool(row.extended),
    ended: bool(row.ended),
  };
}
export function parseBoard(value: unknown): AdminBoard {
  const row = nuniRecord(value);
  return {
    tenantId: text(row.tenantId),
    tenantName: text(row.tenantName),
    id: text(row.id),
    name: text(row.name),
    description: nullableText(row.description),
    joinPolicy: enumeration(row.joinPolicy, ['open', 'request', 'invite-only']),
    postingPolicy: enumeration(row.postingPolicy, ['members', 'moderators']),
    canPost: bool(row.canPost),
  };
}
export function parseBoards(value: unknown): AdminBoard[] {
  const items = nuniRecord(value).items;
  return Array.isArray(items) ? items.map(parseBoard) : invalid();
}
export function parseAudit(value: unknown): AdminAudit[] {
  const rows = nuniRecord(value).records;
  if (!Array.isArray(rows)) invalid();
  return rows.map((value) => {
    const row = nuniRecord(value);
    const createdAt = text(row.createdAt);
    if (!Number.isFinite(Date.parse(createdAt))) invalid();
    return {
      id: text(row.id),
      actionLabel: text(row.actionLabel),
      actorName: text(row.actorName),
      targetSchoolName: nullableText(row.targetSchoolName),
      detail: text(row.detail),
      createdAt,
      via: enumeration(row.via, ['proxy', 'school_admin', 'operator']),
      before: row.before === null ? null : nuniRecord(row.before),
      after: row.after === null ? null : nuniRecord(row.after),
    };
  });
}

export function parseReports(value: unknown): AdminReport[] {
  const items = nuniRecord(value).items;
  if (!Array.isArray(items)) invalid();
  return items.map((value) => {
    const row = nuniRecord(value),
      snapshot = nuniRecord(row.snapshot),
      author = nuniRecord(snapshot.author);
    const result: AdminReport = {
      id: text(row.id),
      tenantId: text(row.tenantId),
      postId: text(row.postId),
      state: enumeration(row.state, ['open', 'hidden', 'dismissed']),
      version: count(row.version),
      reason: enumeration(row.reason, [
        'harassment',
        'spam',
        'privacy',
        'hate',
        'violence',
        'other',
      ]),
      createdAt: text(row.createdAt),
      detail: text(row.detail),
      decisionReason: nullableText(row.decisionReason),
      canDecide: bool(row.canDecide),
      snapshot: {
        id: text(snapshot.id),
        tenantId: text(snapshot.tenantId),
        tenantName: text(snapshot.tenantName),
        communityId: text(snapshot.communityId),
        communityName: text(snapshot.communityName),
        text: text(snapshot.text),
        author: { displayName: text(author.displayName), isSelf: bool(author.isSelf) },
        publishedAt: text(snapshot.publishedAt),
        version: count(snapshot.version),
      },
    };
    if (
      result.version < 1 ||
      result.snapshot.version < 1 ||
      result.tenantId !== result.snapshot.tenantId ||
      result.postId !== result.snapshot.id ||
      !Number.isFinite(Date.parse(result.createdAt))
    )
      invalid();
    return result;
  });
}

export async function adminRequest(
  path: string,
  context?: string,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(12000);
  const response = await fetch(`/api/platform-admin/${path}`, {
    method: input ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      ...(context ? { 'X-Campus-Session': context } : {}),
      ...(input ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    throw new NuniError(
      response.status,
      typeof row.error === 'string' ? row.error : 'REQUEST_FAILED',
    );
  }
  if (value === null) invalid();
  return value;
}

export function adminError(error: unknown): string {
  if (error instanceof NuniError) {
    if (error.status === 401) return '登入已失效，請重新登入。';
    if (error.code === 'PLATFORM_SOCIAL_POST_UNAVAILABLE')
      return '原貼文已移除或不再公開，請重新讀取檢舉後再決定是否駁回。';
    if (error.code === 'SCHOOL_OPS_PROXY_EXPIRED' || error.code === 'SCHOOL_OPS_PROXY_REQUIRED')
      return '代操作已到期或尚未開始，請重新取得代操作權限。';
    if (error.status === 403) return '目前帳號沒有這項管理權限，請重新確認登入狀態。';
    if (error.status === 409) return '資料或操作狀態已變更，請重新讀取後再試。';
    if (error.status === 429) return '操作較頻繁，請稍候再試。';
    if (error.status === 400 || error.status === 422) return '資料格式不符，請檢查欄位後再試。';
    if (error.code === 'INVALID_RESPONSE') return '收到的資料不完整，請重新讀取。';
  }
  return '目前無法完成操作，請確認連線後重試。';
}
