import { nthuCourseIdentity } from '@campus/shared/src/nthuCourseSchedule';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import {
  evaluatePublicCourseFilters,
  hasPublicCourseFilters,
  parsePublicCourseFilters,
  type PublicCourseFilters,
} from '@campus/shared/src/publicCourseFilters';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { boundedBytes } from '../nuni/server';

// NTHU publishes this daily JSON explicitly for analysis and system integration.
// https://curricul.site.nthu.edu.tw/p/404-1208-111356.php?Lang=zh-tw
const operation = resolvePublicCourseOperation('nthu')!;
const MAX_BYTES = 6 * 1024 * 1024;
const MATCH_LIMIT = 50;
type CatalogEntry = { course: PublicCatalogCourse; searchText: string };

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/臺/g, '台');
}

function parseCatalog(json: string): CatalogEntry[] {
  const rows: unknown = JSON.parse(json);
  if (!Array.isArray(rows) || !rows.length || rows.length > 20_000) throw new Error('Invalid course catalog');
  const fields = ['科號', '課程中文名稱', '課程英文名稱', '學分數', '授課教師', '教室與上課時間', '停開註記'];
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object' || fields.some(field => typeof row[field] !== 'string')) {
      throw new Error('Incomplete course row');
    }
    const identity = nthuCourseIdentity(row['科號']);
    if (!identity || !row['課程中文名稱'].trim()) throw new Error('Missing course identity');
    const stopped = row['停開註記'].trim();
    if (stopped === '停開') return [];
    if (stopped) throw new Error('Unrecognized course status');
    const meetings = row['教室與上課時間'].split(/\r?\n/).filter((line: string) => line.trim()).map((line: string) => {
      const cells = line.split('\t');
      if (cells.length !== 2) throw new Error('Unrecognized room/time pair');
      return { room: cells[0].trim(), time: cells[1].trim() };
    });
    if (meetings.length > 32) throw new Error('Too many room/time pairs');
    const course: PublicCatalogCourse = {
      code: row['科號'],
      section: identity.section,
      title: row['課程中文名稱'].trim(),
      department: identity.departmentCode,
      teacher: row['授課教師'].trim(),
      time: meetings.map((meeting: { time: string }) => meeting.time).join('\n'),
      room: meetings.map((meeting: { room: string }) => meeting.room).join('\n'),
      semester: identity.semester,
      credits: row['學分數'].trim(),
      meetings,
    };
    return [{
      course,
      searchText: normalize([
        course.code, course.code.replace(/\s/g, ''), course.title, row['課程英文名稱'],
        course.department, course.teacher, course.room,
      ].join(' ')),
    }];
  });
}

async function loadCourses(): Promise<{ rows: CatalogEntry[]; fetchedAt: string }> {
  const response = await fetch(operation.upstreamUrl, {
    headers: { Accept: 'application/json, text/plain' },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  try {
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || (mime !== 'application/json' && mime !== 'text/plain')) throw new Error('Course catalog unavailable');
    const bytes = await boundedBytes(response, MAX_BYTES);
    return { rows: parseCatalog(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), fetchedAt: new Date().toISOString() };
  } finally {
    if (!response.bodyUsed) await response.body?.cancel();
  }
}

// Cache one complete public snapshot per process. Searches share in-flight reads
// and a failed refresh remains rejected for 15 seconds before retrying upstream.
let snapshot: { rows: Promise<{ rows: CatalogEntry[]; fetchedAt: string }>; expires: number } | undefined;

export async function searchNthuCourseCatalog(query: string, requestedFilters?: PublicCourseFilters): Promise<PublicCourseCatalogResponse> {
  const filters = parsePublicCourseFilters(requestedFilters === undefined ? {} : requestedFilters);
  if (!filters) throw new Error('Invalid course filters');
  const filtered = hasPublicCourseFilters(filters);
  if (!snapshot || Date.now() >= snapshot.expires) {
    const next = { rows: loadCourses(), expires: Date.now() + 15 * 60_000 };
    snapshot = next;
    next.rows.catch(() => { next.expires = Date.now() + 15_000; });
  }
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const currentSnapshot = snapshot;
  if (!currentSnapshot) throw new Error('Public catalog snapshot unavailable');
  const { rows, fetchedAt } = await currentSnapshot.rows;
  let unresolvedCount = 0;
  const matches = rows.filter(row => {
    if (!terms.every(term => row.searchText.includes(term))) return false;
    const match = evaluatePublicCourseFilters(row.course, 'nthu', filters);
    if (match === 'unresolved') unresolvedCount += 1;
    return match === 'match';
  });
  return {
    schoolId: 'nthu', sourceUrl: operation.sourceUrl, fetchedAt,
    courses: matches.slice(0, MATCH_LIMIT).map(row => row.course),
    truncated: matches.length > MATCH_LIMIT,
    ...(filtered ? { filters, unresolvedCount } : {}),
  };
}
