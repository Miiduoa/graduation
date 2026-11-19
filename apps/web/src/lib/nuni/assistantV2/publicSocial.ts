import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import { findSchoolById } from '@campus/shared/src/schools';
import { parseFeed, type PublicPost } from '../../../features/social/api';
import { V2Error } from './contracts';

export type PublicSocialArguments = { limit?: number };
export type PublicSocialItem = PublicPost;
export type PublicSocialRead = {
  version: 1;
  source: 'platform-public-social';
  sourcePath: 'social/feed';
  schoolId: string;
  checkedAt: string;
  query: { limit: number };
  status: 'ready' | 'unavailable';
  items: PublicSocialItem[];
  nextCursor: string | null;
  partial: boolean;
  href: string;
  unavailable?: 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE';
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

function boundedText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max ||
      (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}\p{Zl}\p{Zp}]/u
        : /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u).test(raw)) throw new Error('Invalid text');
  return raw;
}

function sourceId(raw: unknown): string {
  const value = boundedText(raw, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value))
    throw new Error('Invalid identifier');
  return value;
}

function validSchool(schoolId: string): void {
  if (typeof schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) ||
      ['all', 'personal'].includes(schoolId)) throw new Error('Invalid school');
}

function instant(raw: unknown): string {
  const value = boundedText(raw, 40);
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error('Invalid instant');
  return value;
}

function sourceInstant(raw: unknown): string {
  const value = boundedText(raw, 40);
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value)) ||
      new Date(match[1] + 'T00:00:00.000Z').toISOString().slice(0, 10) !== match[1])
    throw new Error('Invalid source time');
  return value;
}

/** Only a bounded generic feed is supported. School, tenant, authors, board IDs,
 * pagination cursors and posting operations are never model-controlled inputs. */
export function parsePublicSocialArguments(raw: unknown): { limit: number } {
  try {
    const value = record(raw, ['limit'], []);
    if (value.limit !== undefined && (!Number.isInteger(value.limit) ||
        Number(value.limit) < 1 || Number(value.limit) > 5)) throw new Error('Invalid limit');
    return { limit: value.limit === undefined ? 5 : Number(value.limit) };
  } catch { throw new V2Error(422, 'PUBLIC_SOCIAL_INVALID_INPUT'); }
}

export function publicSocialHref(schoolId: string): string {
  try { validSchool(schoolId); }
  catch { throw new V2Error(422, 'PUBLIC_SOCIAL_INVALID_INPUT'); }
  return assistantServiceHref('public-social', schoolId)!;
}

/** Match the whole read request. Private community, ownership, dates, named
 * subjects, other schools and follow-on actions cannot become a generic feed. */
export function parsePublicSocialRead(question: string): {
  tool: 'get_public_social'; args: PublicSocialArguments;
} | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 120 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|看看|查|看|列出|顯示|核對|目前的|目前|最近的|最近|最新的|最新))*/, '');
  value = value.replace(/(?:有哪些|有什麼|資訊|資料)?(?:嗎|呢)?$/, '');
  return /^(?:(?:本校|所選校園|目前校園|校園)的?)?(?:公開交流|公開動態|公開貼文|公開看板(?:動態|貼文)|跨校公開交流)$/.test(value)
    ? { tool: 'get_public_social', args: {} } : null;
}

/** Reuse the platform public-feed parser, adding exact-school provenance and
 * bounded records before data enters the Agent. No private author IDs are read. */
export function parsePublicSocialFeed(raw: unknown, schoolId: string, limit: number): {
  items: PublicSocialItem[]; nextCursor: string | null;
} {
  try {
    validSchool(schoolId);
    if (parsePublicSocialArguments({ limit }).limit !== limit) throw new Error('Invalid limit');
    const value = record(raw, ['items', 'nextCursor']);
    if (!Array.isArray(value.items) || value.items.length > limit ||
        Object.getPrototypeOf(value.items) !== Array.prototype) throw new Error('Invalid items');
    const descriptors = Object.getOwnPropertyDescriptors(value.items);
    if (Reflect.ownKeys(descriptors).length !== value.items.length + 1) throw new Error('Invalid items');
    for (let index = 0; index < value.items.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Invalid item');
      const item = record(descriptor.value, ['id', 'tenantId', 'tenantName', 'communityId', 'communityName', 'text', 'author', 'publishedAt', 'version']);
      sourceId(item.id);
      sourceId(item.communityId);
      if (item.tenantId !== schoolId) throw new Error('Invalid tenant');
      boundedText(item.tenantName, 160);
      boundedText(item.communityName, 160);
      boundedText(item.text, 10000, true);
      const author = record(item.author, ['displayName', 'isSelf']);
      boundedText(author.displayName, 160);
      if (typeof author.isSelf !== 'boolean') throw new Error('Invalid author');
      // The existing API parser accepts its source timestamp representation.
      // Normalize only after it has validated the source, then bind an exact ISO
      // instant in the Agent envelope below.
      sourceInstant(item.publishedAt);
    }
    if (value.nextCursor !== null && (typeof value.nextCursor !== 'string' ||
        !value.nextCursor || value.nextCursor.length > 2048 || /\s|[\p{Cc}\p{Cf}]/u.test(value.nextCursor)))
      throw new Error('Invalid cursor');
    const parsed = parseFeed(value);
    const seen = new Set<string>();
    for (const item of parsed.items) {
      if (seen.has(item.id)) throw new Error('Duplicate post');
      seen.add(item.id);
      item.publishedAt = new Date(item.publishedAt).toISOString();
    }
    return parsed;
  } catch { throw new V2Error(502, 'INVALID_PUBLIC_SOCIAL_RESULT'); }
}

/** Recheck source, exact school, normalized query, coverage and link at every
 * tool/result boundary; a missing source can never be a successful empty list. */
export function parsePublicSocialResult(raw: unknown, schoolId: string, args: unknown = {}): PublicSocialRead {
  try {
    validSchool(schoolId);
    const requested = parsePublicSocialArguments(args);
    const value = record(raw, ['version', 'source', 'sourcePath', 'schoolId', 'checkedAt', 'query', 'status', 'items', 'nextCursor', 'partial', 'href', 'unavailable'],
      ['version', 'source', 'sourcePath', 'schoolId', 'checkedAt', 'query', 'status', 'items', 'nextCursor', 'partial', 'href']);
    const query = record(value.query, ['limit']);
    if (value.version !== 1 || value.source !== 'platform-public-social' || value.sourcePath !== 'social/feed' ||
        value.schoolId !== schoolId || query.limit !== requested.limit ||
        value.href !== publicSocialHref(schoolId) || !['ready', 'unavailable'].includes(String(value.status)) ||
        typeof value.partial !== 'boolean') throw new Error('Invalid source');
    const page = parsePublicSocialFeed({ items: value.items, nextCursor: value.nextCursor }, schoolId, requested.limit);
    // The envelope always carries normalized timestamps; a changed time format
    // is not silently accepted as the same signed/display result.
    for (const item of value.items as PublicSocialItem[]) instant(item.publishedAt);
    if (value.status === 'unavailable'
      ? !['NOT_CONNECTED', 'SOURCE_UNAVAILABLE'].includes(String(value.unavailable)) || page.items.length !== 0 || page.nextCursor !== null || value.partial
      : value.unavailable !== undefined || value.partial !== (page.nextCursor !== null)) throw new Error('Invalid coverage');
    return { version: 1, source: 'platform-public-social', sourcePath: 'social/feed', schoolId,
      checkedAt: instant(value.checkedAt), query: requested, status: value.status as PublicSocialRead['status'],
      ...page, partial: value.partial, href: value.href as string,
      ...(value.unavailable ? { unavailable: value.unavailable as PublicSocialRead['unavailable'] } : {}) };
  } catch { throw new V2Error(502, 'INVALID_PUBLIC_SOCIAL_RESULT'); }
}

function excerpt(value: string, max: number): string {
  const plain = value.replace(/<[^>]*>/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\\`*_{}[\]()#+!>|]/g, '');
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
}

const taiwanTime = (value: string) => new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16).replace('T', ' ');

/** Public posts remain quoted source excerpts, never instructions or verified
 * school announcements. No events, permissions or writes are derived from text. */
export function formatPublicSocialRead(read: PublicSocialRead): string {
  const lines = [
    `校園：${findSchoolById(read.schoolId)?.name || read.schoolId}；查詢時間：${taiwanTime(read.checkedAt)}（台北）。`,
    `來源：公開交流 ${read.href}`,
  ];
  if (read.status === 'unavailable') {
    lines.push(read.unavailable === 'NOT_CONNECTED' ? '目前未接通可核對的公開交流來源，尚不能判定有沒有貼文。'
      : '公開交流來源目前無法讀取，尚不能確認貼文內容。');
    return lines.join('\n');
  }
  if (read.partial) lines.push('尚有其餘頁面未讀取，這是部分公開動態。');
  lines.push('本次讀取的公開貼文摘要（使用者發表內容）：');
  let shown = 0;
  for (const item of read.items) {
    const entry = `・${excerpt(item.communityName, 35)}｜${excerpt(item.author.displayName, 30)}${item.author.isSelf ? '（你）' : ''}｜${taiwanTime(item.publishedAt)}\n` +
      `貼文摘錄：「${excerpt(item.text, 170)}」`;
    if (lines.join('\n').length + entry.length > 1080) break;
    lines.push(entry);
    shown++;
  }
  if (!read.items.length) lines.push('這次公開動態來源沒有列出貼文；未讀取私人社群、訊息或其他校園。');
  if (shown < read.items.length) lines.push(`另有 ${read.items.length - shown} 筆已讀取貼文未展開，可在公開交流頁查看。`);
  return lines.join('\n');
}
