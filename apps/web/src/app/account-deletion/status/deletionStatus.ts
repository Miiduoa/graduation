export const NUNI_API_ORIGIN = 'https://api.nuni.tw';
export const DELETION_STATUS_ACCESS_PATH = '/privacy/deletion-status-access';
export const PUBLIC_STATUS_PATH = '/v1/public/privacy/deletion-status';
export const PUBLIC_REVOKE_PATH = '/v1/public/privacy/deletion-status/revoke';
export const REVOKE_CONFIRMATION = 'revoke-deletion-status-access';

export const CAPABILITY_TOKEN = /^pd1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export const PUBLIC_PAGE_INTRO =
  '用查詢碼就能查刪除進度，不需要登入；這一頁不會顯示你是誰，也不會列出資料內容。';
export const REVOKE_CONFIRM_BODY =
  '撤銷後這組查詢碼立刻失效。這只會停用查詢碼本身，不會取消刪除請求，也不代表資料已處理完。';
export const INVALID_TOKEN_COPY = '查詢碼格式不正確，請重新貼上完整的查詢碼（以 pd1_ 開頭）。';
export const NOT_FOUND_COPY = '找不到這筆查詢。查詢碼可能不對、已被更換、已撤銷或已過期。';
export const COOKIE_ABSENT_COPY = '這個瀏覽器沒有保存查詢碼，或它已失效。請改貼查詢碼。';
export const QUERY_UNAVAILABLE_COPY = '目前查不到進度，請稍後再試。';
export const REVOKED_COPY = '這組查詢碼已撤銷。';

export const STAGE_LABELS = {
  'awaiting-review': '審核中，還沒有開始處理',
  approved: '已核准，等待開始處理',
  working: '處理中',
  'needs-attention': '部分項目沒有完成，校方會跟進處理',
  completed: '已完成',
  'completed-with-retention': '已完成，部分資料依法保留',
} as const;

const COUNT_LABELS = [
  ['pending', '待處理'],
  ['deleted', '已刪除'],
  ['anonymized', '已匿名化'],
  ['retainedWithBasis', '依法保留'],
  ['failed', '未完成'],
] as const;

export type DeletionStage = keyof typeof STAGE_LABELS;
export type TerminalReceiptCode = 'completed' | 'completed-with-retention';

export type DeletionCounts = {
  pending: number;
  deleted: number;
  anonymized: number;
  retainedWithBasis: number;
  failed: number;
};

export type DeletionProjection = {
  stage: DeletionStage;
  counts: DeletionCounts;
  updatedAt: string;
  terminalReceipt?: { code: TerminalReceiptCode; sha256: string };
};

export type CookieQueryResult =
  | { kind: 'ok'; projection: DeletionProjection }
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorPayload(value: unknown): { code?: string; message?: string } {
  const body = asRecord(value);
  const error = asRecord(body.error);
  return {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
  };
}

export function parseCapabilityToken(value: string): string | null {
  const token = value.trim();
  return CAPABILITY_TOKEN.test(token) ? token : null;
}

function parseCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function parseProjection(value: unknown): DeletionProjection | null {
  const row = asRecord(value);
  const stage = row.stage;
  if (typeof stage !== 'string' || !(stage in STAGE_LABELS) || typeof row.updatedAt !== 'string')
    return null;
  const rawCounts = asRecord(row.counts);
  const counts = {
    pending: parseCount(rawCounts.pending),
    deleted: parseCount(rawCounts.deleted),
    anonymized: parseCount(rawCounts.anonymized),
    retainedWithBasis: parseCount(rawCounts.retainedWithBasis),
    failed: parseCount(rawCounts.failed),
  };
  if (Object.values(counts).some((count) => count === null)) return null;
  const projection: DeletionProjection = {
    stage: stage as DeletionStage,
    counts: counts as DeletionCounts,
    updatedAt: row.updatedAt,
  };
  const completed = stage === 'completed' || stage === 'completed-with-retention';
  if (row.terminalReceipt) {
    const receipt = asRecord(row.terminalReceipt);
    if (
      (receipt.code !== 'completed' && receipt.code !== 'completed-with-retention') ||
      typeof receipt.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256)
    ) {
      return null;
    }
    projection.terminalReceipt = { code: receipt.code, sha256: receipt.sha256 };
  } else if (completed) {
    return null;
  }
  return projection;
}

export function stageLabel(stage: DeletionStage): string {
  return STAGE_LABELS[stage];
}

export function formatCounts(counts: DeletionCounts): string {
  const parts = COUNT_LABELS.filter(([key]) => counts[key] > 0).map(
    ([key, label]) => `${label} ${counts[key]} 類`,
  );
  return parts.length ? parts.join('、') : '尚未開始逐類處理';
}

export function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function publicFailure(status: number, body: unknown): Error {
  const error = errorPayload(body);
  if (status === 404 || error.code === 'NOT_FOUND') return new Error(NOT_FOUND_COPY);
  return new Error(error.message || QUERY_UNAVAILABLE_COPY);
}

export async function queryPublicStatus(capabilityToken: string): Promise<DeletionProjection> {
  const response = await fetch(`${NUNI_API_ORIGIN}${PUBLIC_STATUS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilityToken }),
    cache: 'no-store',
  });
  const body = await readJson(response);
  if (!response.ok) throw publicFailure(response.status, body);
  const projection = parseProjection(body);
  if (!projection) throw new Error(QUERY_UNAVAILABLE_COPY);
  return projection;
}

export async function revokePublicStatus(capabilityToken: string): Promise<void> {
  const response = await fetch(`${NUNI_API_ORIGIN}${PUBLIC_REVOKE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilityToken, confirmation: REVOKE_CONFIRMATION }),
    cache: 'no-store',
  });
  const body = await readJson(response);
  if (!response.ok) throw publicFailure(response.status, body);
}

async function cookieAccess(action: 'query' | 'revoke'): Promise<{ status: number; value: unknown }> {
  const response = await fetch(DELETION_STATUS_ACCESS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    cache: 'no-store',
  });
  return { status: response.status, value: await readJson(response) };
}

export async function queryCookieStatus(): Promise<CookieQueryResult> {
  const { status, value } = await cookieAccess('query');
  if (status === 200) {
    const projection = parseProjection(value);
    return projection ? { kind: 'ok', projection } : { kind: 'error', message: QUERY_UNAVAILABLE_COPY };
  }
  if (status === 404) return { kind: 'absent' };
  return { kind: 'error', message: errorPayload(value).message || QUERY_UNAVAILABLE_COPY };
}

export async function revokeCookieStatus(): Promise<boolean> {
  const { status } = await cookieAccess('revoke');
  return status === 200;
}
