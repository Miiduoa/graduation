import { NuniError, nuniRecord } from '@campus/shared/src/nuni';

export type PublicBoard = {
  tenantId: string;
  tenantName: string;
  id: string;
  name: string;
  description: string | null;
  canPost: boolean;
};
export type PublicPost = {
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
export type PublicFeed = { items: PublicPost[]; nextCursor: string | null };
export type PublicBlock = { id: string; displayName: string; version: number; createdAt: string };
export type PublicReport = {
  id: string;
  tenantId: string;
  postId: string;
  state: 'open' | 'hidden' | 'dismissed';
  reason: string;
  createdAt: string;
  version: number;
};
export const reportReasons = [
  { value: 'harassment', label: '騷擾或霸凌' },
  { value: 'spam', label: '垃圾訊息或詐騙' },
  { value: 'privacy', label: '洩漏個人資料' },
  { value: 'hate', label: '仇恨或歧視' },
  { value: 'violence', label: '暴力或威脅' },
  { value: 'other', label: '其他問題' },
];
function invalid(): never {
  throw new NuniError(502, 'INVALID_RESPONSE');
}
function text(value: unknown) {
  return typeof value === 'string' ? value : invalid();
}
function bool(value: unknown) {
  return typeof value === 'boolean' ? value : invalid();
}
function version(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : invalid();
}
function date(value: unknown) {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function rows(value: unknown) {
  const items = nuniRecord(value).items;
  return Array.isArray(items) ? items : invalid();
}
export function parseBoards(value: unknown): PublicBoard[] {
  return rows(value).map((value) => {
    const row = nuniRecord(value);
    return {
      tenantId: text(row.tenantId),
      tenantName: text(row.tenantName),
      id: text(row.id),
      name: text(row.name),
      description: row.description === null ? null : text(row.description),
      canPost: bool(row.canPost),
    };
  });
}
export function parsePost(value: unknown): PublicPost {
  const row = nuniRecord(value),
    author = nuniRecord(row.author);
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    tenantName: text(row.tenantName),
    communityId: text(row.communityId),
    communityName: text(row.communityName),
    text: text(row.text),
    author: { displayName: text(author.displayName), isSelf: bool(author.isSelf) },
    publishedAt: date(row.publishedAt),
    version: version(row.version),
  };
}
export function parseFeed(value: unknown): PublicFeed {
  const row = nuniRecord(value);
  return {
    items: rows(value).map(parsePost),
    nextCursor: row.nextCursor === null ? null : text(row.nextCursor),
  };
}
export function parseBlocks(value: unknown): PublicBlock[] {
  return rows(value).map((value) => {
    const row = nuniRecord(value);
    return {
      id: text(row.id),
      displayName: text(row.displayName),
      version: version(row.version),
      createdAt: date(row.createdAt),
    };
  });
}
export function parseReport(value: unknown): PublicReport {
  const row = nuniRecord(value),
    state = text(row.state);
  if (state !== 'open' && state !== 'hidden' && state !== 'dismissed') invalid();
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    postId: text(row.postId),
    state,
    reason: text(row.reason),
    createdAt: date(row.createdAt),
    version: version(row.version),
  };
}
export function parseReports(value: unknown): PublicReport[] {
  return rows(value).map(parseReport);
}
export async function socialRequest(
  path: string,
  context: string,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/social/${path}`, {
    method: input ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
    headers: {
      'X-Campus-Session': context,
      ...(input ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    try {
      const value = nuniRecord(await response.json());
      if (typeof value.error === 'string') code = value.error;
    } catch {}
    throw new NuniError(response.status, code);
  }
  return response.json() as Promise<unknown>;
}
export function sessionLost(error: unknown) {
  return error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');
}
export function socialError(error: unknown) {
  if (sessionLost(error)) return '登入已失效或帳號已變更，請重新登入。';
  if (error instanceof NuniError) {
    if (error.code === 'PLATFORM_SOCIAL_REPORT_PENDING')
      return '你已檢舉這則貼文，可在「我的檢舉」查看處理狀態。';
    if (error.code === 'PLATFORM_SOCIAL_MEMBERSHIP_REQUIRED')
      return '這個看板需要成員資格才能發表，請選擇其他公開看板。';
    if (error.code === 'SOCIAL_PARTICIPATION_RESTRICTED')
      return '目前帳號暫時無法發表，請查看原社群的帳號狀態。';
    if (error.status === 403) return '目前帳號沒有這項操作的權限。';
    if (error.status === 404) return '這則公開內容已無法使用，請更新動態。';
    if (error.status === 409) return '資料已變更，請更新內容後重試。';
    if (error.status === 422 || error.status === 400) return '請確認填寫內容，再試一次。';
    if (error.status === 429) return '操作過於頻繁，請稍後再試。';
  }
  return '目前無法連線，請重試。尚未確認成功的操作不會顯示為完成。';
}
