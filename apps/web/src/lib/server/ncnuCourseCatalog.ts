import { readImportDelimitedRecords } from '@campus/shared/src/imports/aiDelimitedText';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { boundedBytes } from '../nuni/server';

// The public guest list links to a complete current-semester CSV export, without a session.
const operation = resolvePublicCourseOperation('ncnu')!;
const MAX_BYTES = 2 * 1024 * 1024;
const MATCH_LIMIT = 50;
const columns: Record<Exclude<keyof PublicCatalogCourse, 'meetings'>, string> = {
  code: '課號', section: '班別', title: '中文課名', department: '開課系所', teacher: '開課教師',
  time: '時間', room: '地點', semester: '學期', credits: '學分數',
};

function parseCatalog(csv: string): PublicCatalogCourse[] {
  const records = readImportDelimitedRecords(csv, ',');
  const header = records?.[0]?.cells;
  if (!records || !header || new Set(header).size !== header.length) throw new Error('Invalid course catalog');
  const keys = Object.keys(columns) as (keyof typeof columns)[];
  const indices = keys.map(key => header.indexOf(columns[key]));
  if (indices.includes(-1)) throw new Error('Unrecognized course catalog columns');

  return records.slice(1).map(({ cells }) => {
    if (cells.length !== header.length) throw new Error('Incomplete course row');
    const row = {} as PublicCatalogCourse;
    keys.forEach((key, i) => { row[key] = cells[indices[i]].trim(); });
    if (!row.code || !row.title || !row.semester) throw new Error('Missing course identity');
    return row;
  });
}

async function loadCourses() {
  const response = await fetch(operation.upstreamUrl, {
    headers: { Accept: 'text/csv' },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  try {
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/csv') {
      throw new Error('Course catalog unavailable');
    }
    const bytes = await boundedBytes(response, MAX_BYTES);
    return { rows: parseCatalog(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), fetchedAt: new Date().toISOString() };
  } finally {
    // Release unconsumed bodies as well (e.g. wrong MIME type or declared size).
    if (!response.bodyUsed) await response.body?.cancel();
  }
}

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/臺/g, '台');
}

// Per-process, one public catalog regardless of query. Coalesce concurrent refreshes
// and back off briefly on failure so each keystroke cannot trigger an upstream download.
let snapshot: { rows: Promise<{ rows: PublicCatalogCourse[]; fetchedAt: string }>; expires: number } | undefined;

export async function searchNcnuCourseCatalog(query: string): Promise<PublicCourseCatalogResponse> {
  if (!snapshot || Date.now() >= snapshot.expires) {
    const next = { rows: loadCourses(), expires: Date.now() + 15 * 60_000 };
    snapshot = next;
    next.rows.catch(() => { next.expires = Date.now() + 15_000; });
  }
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const currentSnapshot = snapshot;
  if (!currentSnapshot) throw new Error('Public catalog snapshot unavailable');
  const { rows, fetchedAt } = await currentSnapshot.rows;
  const matches = rows.filter(row => {
    const text = normalize([row.code, row.title, row.department, row.teacher, row.room].join(' '));
    return terms.every(term => text.includes(term));
  });
  return { schoolId: 'ncnu', sourceUrl: operation.sourceUrl, fetchedAt, courses: matches.slice(0, MATCH_LIMIT), truncated: matches.length > MATCH_LIMIT };
}
