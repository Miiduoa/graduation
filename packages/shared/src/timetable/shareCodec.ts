import { cleanCourses, cleanMeta, type PersonalCourse, type TimetableMeta } from './course';

export type TimetableSharePayload = {
  v: 1;
  id: string;
  name: string;
  t: number;
  courses: PersonalCourse[];
  meta: TimetableMeta;
};

function nodeBuffer():
  | { from(data: string, encoding: 'binary' | 'base64'): { toString(encoding: 'binary' | 'base64'): string } }
  | undefined {
  const candidate = (globalThis as { Buffer?: unknown }).Buffer as
    | { from(data: string, encoding: 'binary' | 'base64'): { toString(encoding: 'binary' | 'base64'): string } }
    | undefined;
  return candidate;
}

function toBase64Url(bytes: string): string {
  let encoded = '';
  if (typeof btoa === 'function') encoded = btoa(bytes);
  else {
    const buffer = nodeBuffer();
    if (!buffer) throw new Error('無法編碼分享碼');
    encoded = buffer.from(bytes, 'binary').toString('base64');
  }
  return encoded.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(value: string): string {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  if (typeof atob === 'function') return atob(base64);
  const buffer = nodeBuffer();
  if (!buffer) throw new Error('無法解碼分享碼');
  return buffer.from(base64, 'base64').toString('binary');
}

export function encodeTimetableShare(payload: TimetableSharePayload): string {
  const body = {
    v: 1 as const,
    id: String(payload.id || ''),
    name: String(payload.name || '我的課表').slice(0, 40),
    t: Number(payload.t) || Date.now(),
    courses: cleanCourses(payload.courses),
    meta: cleanMeta(payload.meta),
  };
  const raw = unescape(encodeURIComponent(JSON.stringify(body)));
  return `NL1-${toBase64Url(raw)}`;
}

export function decodeTimetableShare(input: string): TimetableSharePayload {
  let value = String(input || '').trim();
  if (value.includes('#share=')) value = decodeURIComponent(value.split('#share=')[1].split('&')[0]);
  if (value.includes('#friend=')) value = decodeURIComponent(value.split('#friend=')[1].split('&')[0]);
  const prefix = value.startsWith('NL1-') ? 'NL1-' : value.startsWith('PU1-') ? 'PU1-' : '';
  if (!prefix) throw new Error('分享碼格式不正確');
  const parsed = JSON.parse(decodeURIComponent(escape(fromBase64Url(value.slice(prefix.length)))));
  if (!parsed.id || !Array.isArray(parsed.courses)) throw new Error('分享碼資料不完整');
  return {
    v: 1,
    id: String(parsed.id),
    name: String(parsed.name || '課表').slice(0, 40),
    t: Number(parsed.t) || Date.now(),
    courses: cleanCourses(parsed.courses),
    meta: cleanMeta(parsed.meta || {}),
  };
}

export const SHARE_SNAPSHOT_NOTICE =
  '這份課表寫在連結裡，拿到連結的人都能看見當時的快照。登入後可改用七天內有效的分享連結，並可撤回。';
