import {
  formatPublicSchoolAddress,
  getPublicSchoolInfo,
  getSafePublicSchoolWebsiteUrl,
  PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
  PUBLIC_SCHOOL_INFO_SOURCE_URL,
} from '@campus/shared/src/publicSchoolInfo';
import { V2Error } from './contracts';

export type SchoolInfoField = 'overview' | 'address' | 'phone' | 'website';
export type SchoolInfoArguments = { field?: SchoolInfoField };
type SchoolInfoQuery = { field: SchoolInfoField };
export type SchoolInfoContact = {
  canonicalSchoolId: string;
  name: string;
  address: string;
  telephone: string;
  websiteUrl: string;
  academicYear: string;
};
export type SchoolInfoRead = {
  version: 1;
  source: 'bundled-moe-school-info';
  schoolId: string;
  query: SchoolInfoQuery;
  checkedAt: string;
  snapshotDate: string;
  sourceUrl: string;
  href: string;
  status: 'ready' | 'unavailable';
  info: SchoolInfoContact | null;
  unavailable?: 'NOT_LISTED';
};

const FIELDS: readonly SchoolInfoField[] = ['overview', 'address', 'phone', 'website'];
const CONTACT_KEYS = ['canonicalSchoolId', 'name', 'address', 'telephone', 'websiteUrl', 'academicYear'] as const;
const RESULT_KEYS = ['version', 'source', 'schoolId', 'query', 'checkedAt', 'snapshotDate', 'sourceUrl',
  'href', 'status', 'info', 'unavailable'];
const invalid = (): never => { throw new V2Error(422, 'INVALID_INPUT'); };

/** Reject accessors and unexpected fields before reading any caller values. */
function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return invalid();
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !keys.includes(key)) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    out[key] = descriptor.value;
  }
  return out;
}

function schoolScope(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw)) return invalid();
  return raw;
}

export function parseSchoolInfoArguments(raw: unknown): SchoolInfoQuery {
  const value = record(raw, ['field']);
  if (value.field !== undefined && !FIELDS.includes(value.field as SchoolInfoField)) return invalid();
  return { field: (value.field as SchoolInfoField | undefined) ?? 'overview' };
}

function schoolInfoHref(schoolId: string): string {
  return '/school-info?' + new URLSearchParams({ schoolId });
}

function contact(schoolId: string): SchoolInfoContact | null {
  const source = getPublicSchoolInfo(schoolId);
  if (!source) return null;
  const websiteUrl = getSafePublicSchoolWebsiteUrl(source.websiteUrl);
  if (!websiteUrl) return null;
  const info: SchoolInfoContact = {
    canonicalSchoolId: source.id,
    name: source.name,
    address: formatPublicSchoolAddress(source),
    telephone: source.telephone,
    websiteUrl,
    academicYear: source.academicYear,
  };
  // The bundled directory is the same source as the school-info screen. A
  // malformed entry cannot become an invented switchboard or fallback campus.
  if (CONTACT_KEYS.some(key => !info[key].trim() || info[key].length > (key === 'websiteUrl' ? 600 : 240) ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(info[key]))) return null;
  return info;
}

/** Read a versioned local public source. checkedAt is when this snapshot was
 * read, not a claim that the university's contacts were checked live. */
export function readSchoolInfo(schoolId: string, args: unknown = {}, now = Date.now()): SchoolInfoRead {
  const school = schoolScope(schoolId);
  const query = parseSchoolInfoArguments(args);
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return invalid();
  const info = contact(school);
  return {
    version: 1,
    source: 'bundled-moe-school-info',
    schoolId: school,
    query,
    checkedAt: new Date(now).toISOString(),
    snapshotDate: PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
    sourceUrl: PUBLIC_SCHOOL_INFO_SOURCE_URL,
    href: schoolInfoHref(school),
    status: info ? 'ready' : 'unavailable',
    info,
    ...(!info ? { unavailable: 'NOT_LISTED' as const } : {}),
  };
}

/** Verify the exact bundled record, selected school and requested field again
 * at the tool/answer boundary. URLs and contact details never come from a model. */
export function parseSchoolInfoResult(raw: unknown, schoolId: string, args: unknown = {}): SchoolInfoRead {
  try {
    const school = schoolScope(schoolId);
    const query = parseSchoolInfoArguments(args);
    const value = record(raw, RESULT_KEYS);
    const returnedQuery = parseSchoolInfoArguments(value.query);
    if (value.version !== 1 || value.source !== 'bundled-moe-school-info' || value.schoolId !== school ||
        returnedQuery.field !== query.field || value.snapshotDate !== PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE ||
        value.sourceUrl !== PUBLIC_SCHOOL_INFO_SOURCE_URL || value.href !== schoolInfoHref(school) ||
        typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) ||
        new Date(value.checkedAt).toISOString() !== value.checkedAt) return invalid();
    const expected = contact(school);
    if (expected) {
      if (value.status !== 'ready' || value.unavailable !== undefined) return invalid();
      const info = record(value.info, CONTACT_KEYS);
      if (CONTACT_KEYS.some(key => info[key] !== expected[key])) return invalid();
    } else if (value.status !== 'unavailable' || value.info !== null || value.unavailable !== 'NOT_LISTED') return invalid();
    return {
      version: 1, source: 'bundled-moe-school-info', schoolId: school, query,
      checkedAt: value.checkedAt, snapshotDate: PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
      sourceUrl: PUBLIC_SCHOOL_INFO_SOURCE_URL, href: schoolInfoHref(school),
      status: expected ? 'ready' : 'unavailable', info: expected,
      ...(!expected ? { unavailable: 'NOT_LISTED' as const } : {}),
    };
  } catch { throw new V2Error(502, 'INVALID_SCHOOL_INFO_RESULT'); }
}

/** Whole-clause grammar only: a named campus, department, person, live status,
 * route, or extra operation must remain with the conversational planner. */
export { parseSchoolInfoRead } from '@campus/shared/src/assistantPublicReadIntent';

export function formatSchoolInfoRead(read: SchoolInfoRead): string {
  const lines: string[] = [];
  if (read.status !== 'ready' || !read.info) {
    lines.push('所選校園尚無可核對的教育部公開聯絡資料。');
    lines.push(`資料快照：${read.snapshotDate}。`, `學校資訊：${read.href}`, `來源：${read.sourceUrl}`);
    return lines.join('\n');
  }
  const info = read.info;
  lines.push(`學校：${info.name}。`, `資料版本：教育部 ${info.academicYear} 學年度公開資料（快照 ${read.snapshotDate}）。`);
  if (read.query.field === 'overview' || read.query.field === 'address') lines.push(`地址：${info.address}`);
  if (read.query.field === 'overview' || read.query.field === 'phone') lines.push(`總機：${info.telephone}`);
  if (read.query.field === 'overview' || read.query.field === 'website') lines.push(`官方網站：${info.websiteUrl}`);
  lines.push(`學校資訊：${read.href}`, `來源：${read.sourceUrl}`);
  return lines.join('\n');
}
