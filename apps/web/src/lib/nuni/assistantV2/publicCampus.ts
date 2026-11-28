import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import { findSchoolById } from '@campus/shared/src/schools';
import { object, text, V2Error } from './contracts';

export type PublicCampusKind = 'announcements' | 'events';
export type PublicCampusTool = 'get_campus_announcements' | 'get_campus_events';
export type PublicCampusSource = 'school-announcements' | 'school-club-events' | 'school-events' | 'legacy-events';
export type PublicCampusItem = {
  id: string;
  schoolId: string;
  title: string;
  summary: string;
  href: string;
  publishedAt?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  office?: string;
  originalUrl?: string;
};
export type PublicCampusRead = {
  version: 1;
  kind: PublicCampusKind;
  schoolId: string;
  source: PublicCampusSource;
  sourcePath: string;
  checkedAt: string;
  status: 'ready' | 'unavailable';
  items: PublicCampusItem[];
  partial: boolean;
  href: string;
  unavailable?: 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE' | 'HIDDEN_SCHOOL';
};

export function publicCampusToolKind(name: unknown): PublicCampusKind | null {
  return name === 'get_campus_announcements' ? 'announcements' : name === 'get_campus_events' ? 'events' : null;
}

/** Whole, generic read requests only. Dates, named subjects, writes and negation
 * are not silently reduced to an unfiltered recent feed. */
export { parsePublicCampusRead } from '@campus/shared/src/assistantPublicReadIntent';

export function publicCampusSourcePath(schoolId: string, source: PublicCampusSource): string {
  return source === 'legacy-events' ? 'events'
    : `schools/${schoolId}/${source === 'school-announcements' ? 'announcements' : source === 'school-club-events' ? 'clubEvents' : 'events'}`;
}

function instant(value: unknown): string {
  const raw = text(value, 40);
  if (!Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) throw new Error('Invalid time');
  return raw;
}

function cleanString(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) throw new Error('Invalid public campus text');
  return value;
}

/** Recheck kind, school, provenance and bounded text before any answer is used. */
export function parsePublicCampusResult(raw: unknown, schoolId: string, kind: PublicCampusKind): PublicCampusRead {
  try {
    const value = object(raw, ['version', 'kind', 'schoolId', 'source', 'sourcePath', 'checkedAt', 'status', 'items', 'partial', 'href', 'unavailable']);
    if (value.version !== 1 || value.kind !== kind || value.schoolId !== schoolId ||
        !['ready', 'unavailable'].includes(String(value.status)) || typeof value.partial !== 'boolean' ||
        !Array.isArray(value.items) || value.items.length > 5 ||
        (kind === 'announcements' ? value.source !== 'school-announcements'
          : !['school-club-events', 'school-events', 'legacy-events'].includes(String(value.source)))) throw new Error('Invalid source');
    const source = value.source as PublicCampusSource;
    if (value.sourcePath !== publicCampusSourcePath(schoolId, source) ||
        value.href !== assistantServiceHref(kind, schoolId)) throw new Error('Invalid scope');
    if (value.status === 'unavailable' ? !['NOT_CONNECTED', 'SOURCE_UNAVAILABLE', 'HIDDEN_SCHOOL'].includes(String(value.unavailable)) || value.items.length > 0
      : value.unavailable !== undefined) throw new Error('Invalid status');
    const items = value.items.map((rawItem) => {
      const item = object(rawItem, ['id', 'schoolId', 'title', 'summary', 'href', 'publishedAt', 'startsAt', 'endsAt', 'location', 'office', 'originalUrl']);
      const id = cleanString(item.id, 200);
      if (id.includes('/') || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(id) || item.schoolId !== schoolId)
        throw new Error('Invalid item scope');
      const expected = new URLSearchParams({ schoolId });
      if (kind === 'events') expected.set('source', source);
      const href = `/${kind}/${encodeURIComponent(id)}?${expected.toString()}`;
      if (item.href !== href) throw new Error('Invalid source link');
      const parsed: PublicCampusItem = { id, schoolId, title: cleanString(item.title, 160),
        summary: cleanString(item.summary, 320, true), href };
      for (const key of ['publishedAt', 'startsAt', 'endsAt'] as const)
        if (item[key] !== undefined) parsed[key] = instant(item[key]);
      for (const key of ['location', 'office'] as const)
        if (item[key] !== undefined) parsed[key] = cleanString(item[key], 120);
      if (kind === 'announcements' ? !parsed.publishedAt || parsed.startsAt || parsed.endsAt : !parsed.startsAt || parsed.publishedAt)
        throw new Error('Invalid item time');
      if (item.originalUrl !== undefined) {
        const url = new URL(cleanString(item.originalUrl, 1000));
        if (url.protocol !== 'https:' || url.username || url.password || /[\p{Cc}\p{Cf}]/u.test(url.href)) throw new Error('Invalid URL');
        parsed.originalUrl = url.href;
      }
      return parsed;
    });
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate public items');
    return { version: 1, kind, schoolId, source, sourcePath: value.sourcePath as string, checkedAt: instant(value.checkedAt),
      status: value.status as PublicCampusRead['status'], items, partial: value.partial,
      href: value.href as string,
      ...(value.unavailable ? { unavailable: value.unavailable as PublicCampusRead['unavailable'] } : {}) };
  } catch {
    throw new V2Error(502, 'INVALID_PUBLIC_CAMPUS_RESULT');
  }
}

function taiwanTime(value: string): string {
  return new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Text comes from verified public records. It is never a tool instruction. */
export function formatPublicCampusRead(read: PublicCampusRead): string {
  const name = read.kind === 'announcements' ? '學生公告' : '公開活動';
  // The task-card contract limits summaries to 1,200 characters. Scope and
  // incomplete coverage always precede excerpts, so clipping cannot hide them.
  const lines = [`校園：${findSchoolById(read.schoolId)?.name || read.schoolId}；查詢時間：${taiwanTime(read.checkedAt)}（台北）。`,
    `來源：${read.href}`];
  if (read.status === 'unavailable') {
    lines.push(read.unavailable === 'SOURCE_UNAVAILABLE'
      ? `目前無法完整核對${name}來源，尚不能確認內容。`
      : `目前沒有接通可核對的${name}來源，尚不能據此判定沒有公告或活動。`);
    return lines.join('\n');
  }
  if (read.partial) lines.push('部分來源、其餘頁面或未列出的項目尚未完整核對，以上不是完整清單。');
  lines.push(read.kind === 'announcements' ? '目前公告牆已讀取的學生公告（非完整歷史）：' : '已讀取資料中的近期活動（沒有報名或新增行程）：');
  const excerpt = (value: string, max: number) => value.length > max ? value.slice(0, max - 1) + '…' : value;
  let shown = 0;
  for (const item of read.items) {
    const date = item.publishedAt || item.startsAt!;
    const url = item.originalUrl || item.href;
    const entry = `・${excerpt(item.title, 70)}｜${taiwanTime(date)}` +
      (item.location ? '｜' + excerpt(item.location, 45) : '') + (item.office ? '｜' + excerpt(item.office, 30) : '') +
      (item.summary ? `\n摘要：${excerpt(item.summary, 90)}` : '') + (url.length <= 180 ? `\n${url}` : '');
    if (shown >= 3 || lines.join('\n').length + entry.length > 1080) break;
    lines.push(entry);
    shown++;
  }
  if (!read.items.length) lines.push(read.kind === 'announcements'
    ? '本次讀取的學生公告牆沒有列出可顯示項目；未包含所有處室與歷史公告。'
    : '本次已讀取的公開活動資料沒有列出時間可核對的近期活動；不代表校內沒有其他活動。');
  if (shown < read.items.length) lines.push(`另有 ${read.items.length - shown} 筆已讀取項目未展開，請從上述來源查看。`);
  return lines.join('\n');
}
