import { getAssistantLibraryCatalog, type AssistantLibraryCatalog } from '@campus/shared/src/assistantLibraryCatalog';
import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import { V2Error } from './contracts';
import { directorySchoolScope, ownFields } from './directoryFields';

export type LibraryCatalogRead = {
  version: 1;
  source: 'official-library-directory';
  schoolId: string;
  query: Record<string, never>;
  checkedAt: string;
  href: string;
  status: 'ready' | 'unavailable';
  library: AssistantLibraryCatalog | null;
  unavailable?: 'NOT_LISTED';
};

const RESULT_KEYS = ['version', 'source', 'schoolId', 'query', 'checkedAt', 'href', 'status', 'library', 'unavailable'];
const LIBRARY_KEYS = ['name', 'catalogUrl', 'websiteUrl', 'hoursUrl'];
const invalid = (): never => { throw new V2Error(422, 'INVALID_INPUT'); };

/** The reader takes no caller-selected field, URL or school. */
export function parseLibraryCatalogArguments(raw: unknown): Record<string, never> {
  ownFields(raw, []);
  return {};
}

function libraryHref(schoolId: string): string {
  return assistantServiceHref('library', schoolId) ?? invalid();
}

/** Local deterministic read. checkedAt is the read time, not a live library check. */
export function readLibraryCatalog(schoolId: string, args: unknown = {}, now = Date.now()): LibraryCatalogRead {
  const school = directorySchoolScope(schoolId);
  parseLibraryCatalogArguments(args);
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return invalid();
  const library = getAssistantLibraryCatalog(school);
  return {
    version: 1, source: 'official-library-directory', schoolId: school, query: {},
    checkedAt: new Date(now).toISOString(), href: libraryHref(school),
    status: library ? 'ready' : 'unavailable', library,
    ...(!library ? { unavailable: 'NOT_LISTED' as const } : {}),
  };
}

/** Verify the exact directory record and selected school at every boundary. */
export function parseLibraryCatalogResult(raw: unknown, schoolId: string, args: unknown = {}): LibraryCatalogRead {
  try {
    const school = directorySchoolScope(schoolId);
    parseLibraryCatalogArguments(args);
    const value = ownFields(raw, RESULT_KEYS);
    ownFields(value.query, []);
    if (value.version !== 1 || value.source !== 'official-library-directory' || value.schoolId !== school ||
        value.href !== libraryHref(school) || typeof value.checkedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.checkedAt)) || new Date(value.checkedAt).toISOString() !== value.checkedAt)
      return invalid();
    const expected = getAssistantLibraryCatalog(school);
    if (expected) {
      if (value.status !== 'ready' || value.unavailable !== undefined) return invalid();
      const library = ownFields(value.library, LIBRARY_KEYS);
      const actualKeys = Object.keys(library).sort().join();
      if (actualKeys !== Object.keys(expected).sort().join() ||
          Object.entries(expected).some(([key, item]) => library[key] !== item)) return invalid();
    } else if (value.status !== 'unavailable' || value.library !== null || value.unavailable !== 'NOT_LISTED') return invalid();
    return {
      version: 1, source: 'official-library-directory', schoolId: school, query: {},
      checkedAt: value.checkedAt, href: libraryHref(school),
      status: expected ? 'ready' : 'unavailable', library: expected,
      ...(!expected ? { unavailable: 'NOT_LISTED' as const } : {}),
    };
  } catch { throw new V2Error(502, 'INVALID_LIBRARY_CATALOG_RESULT'); }
}

export function formatLibraryCatalogRead(read: LibraryCatalogRead): string {
  if (read.status !== 'ready' || !read.library)
    return `所選校園尚無可核對的官方圖書館館藏入口，沒有改用其他學校。\n圖書館服務：${read.href}`;
  const { name, catalogUrl, websiteUrl, hoursUrl } = read.library;
  return [`圖書館：${name}`, `公開館藏目錄：${catalogUrl}`, `圖書館官網：${websiteUrl}`,
    ...(hoursUrl ? [`官方開館資訊頁：${hoursUrl}`] : []),
    '以上為校方公開入口；此步驟未查館藏、借閱紀錄，也未確認實際開館時間。',
    `圖書館服務：${read.href}`].join('\n');
}
