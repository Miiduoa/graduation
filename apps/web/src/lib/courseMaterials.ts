import type {
  NuniMaterial,
  NuniMaterialPage,
  NuniUnit,
  NuniWorkspace,
} from '@campus/shared/src/nuni';
import { NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';

export const MATERIAL_NEW_MS = 7 * 24 * 60 * 60 * 1000;
export const MATERIAL_HOME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const MATERIAL_READ_KEY_PREFIX = 'nuni-material-read:';
export const MATERIAL_SIZE_UNKNOWN = '大小未提供（教材沒有檔案大小欄位）';
export const MATERIAL_COURSE_BATCH = 4;
export const MATERIAL_CURSOR_CYCLE_MESSAGE =
  '教材分頁出現重複游標，已停止繼續載入，清單可能不完整。請重新讀取教材。';

export type MaterialKind =
  | 'pdf'
  | 'slides'
  | 'document'
  | 'spreadsheet'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'link'
  | 'text';

export type MaterialCabinetGroup = {
  id: string | null;
  title: string;
  materials: NuniMaterial[];
};

export type SearchableMaterial = {
  id: string;
  workspaceId: string;
  courseTitle: string;
  title: string;
  body: string;
  unitTitle: string | null;
  createdAt: string;
};

export type MaterialSearchSeed = {
  items: SearchableMaterial[];
  /** Only courses whose seed catalogue is demonstrably complete. */
  courseIds: string[];
  truncated: boolean;
};

export type MaterialDiscoveryFence = {
  cancelled: () => boolean;
};

export type CourseMaterialPageProgress<T extends { id: string }> = {
  items: T[];
  nextCursor: string | null;
  complete: boolean;
  denied: boolean;
  seenCursors: string[];
  error: string | null;
  /** Continuation is impossible; caller must restart from the first page. */
  needsRestart: boolean;
};

export type CourseMaterialCatalogEntry = CourseMaterialPageProgress<SearchableMaterial> & {
  courseId: string;
  courseTitle: string;
};

export type SearchableMaterialsCatalog = {
  items: SearchableMaterial[];
  courses: CourseMaterialCatalogEntry[];
  skipped: number;
  /** True when at least one course still has more pages or a stalled incomplete read. */
  truncated: boolean;
  partialError: string | null;
};

export function toSearchableMaterial(
  course: { id: string; title: string },
  item: NuniMaterial,
): SearchableMaterial {
  return {
    id: item.id,
    workspaceId: item.workspaceId || course.id,
    courseTitle: course.title,
    title: item.title,
    body: item.body,
    unitTitle: item.unitTitle,
    createdAt: item.createdAt,
  };
}

export function emptyCourseMaterialPageProgress<T extends { id: string }>(): CourseMaterialPageProgress<T> {
  return {
    items: [],
    nextCursor: null,
    complete: false,
    denied: false,
    seenCursors: [],
    error: null,
    needsRestart: false,
  };
}

function dedupeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((item) => item.id));
  const added = incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return added.length ? [...existing, ...added] : existing;
}

/**
 * Merge one materialsPage result into local progress. Detects repeated/cyclic
 * cursors and never marks those courses complete.
 */
export function mergeMaterialPageProgress<T extends { id: string }>(
  previous: CourseMaterialPageProgress<T>,
  page: { materials: T[]; nextCursor: string | null },
  requestedCursor: string | undefined,
): CourseMaterialPageProgress<T> {
  const requestKey = requestedCursor ?? '';
  const seenCursors = previous.seenCursors.includes(requestKey)
    ? previous.seenCursors
    : [...previous.seenCursors, requestKey];
  const items = dedupeById(previous.items, page.materials);
  const nextCursor = page.nextCursor;
  if (nextCursor === null) {
    return {
      items,
      nextCursor: null,
      complete: true,
      denied: false,
      seenCursors,
      error: null,
      needsRestart: false,
    };
  }
  if (nextCursor === requestedCursor || seenCursors.includes(nextCursor)) {
    return {
      items,
      nextCursor: null,
      complete: false,
      denied: false,
      seenCursors,
      error: MATERIAL_CURSOR_CYCLE_MESSAGE,
      needsRestart: true,
    };
  }
  return {
    items,
    nextCursor,
    complete: false,
    denied: false,
    seenCursors,
    error: null,
    needsRestart: false,
  };
}

export function flattenSearchableCatalog(
  courses: CourseMaterialCatalogEntry[],
): SearchableMaterial[] {
  const catalog: SearchableMaterial[] = [];
  const seen = new Set<string>();
  for (const course of courses) {
    if (course.denied) continue;
    for (const item of course.items) {
      const key = `${item.workspaceId}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      catalog.push(item);
    }
  }
  return catalog;
}

function summarizeCatalog(
  courses: CourseMaterialCatalogEntry[],
  skipped: number,
): SearchableMaterialsCatalog {
  const active = courses.filter((course) => !course.denied);
  const partialError =
    active.map((course) => course.error).find((message) => message && message.length > 0) ?? null;
  return {
    items: flattenSearchableCatalog(courses),
    courses,
    skipped,
    truncated: active.some(
      (course) =>
        !course.complete || !!course.error || !!course.nextCursor || course.needsRestart,
    ),
    partialError,
  };
}

export type MaterialOpenAction = {
  href: string | null;
  label: string;
  downloadName: string | null;
};

const KIND_LABEL: Record<MaterialKind, string> = {
  pdf: 'PDF',
  slides: '簡報',
  document: '文件',
  spreadsheet: '試算表',
  image: '圖片',
  video: '影片',
  audio: '音訊',
  archive: '壓縮檔',
  link: '連結',
  text: '文字',
};

const DOWNLOADABLE: MaterialKind[] = [
  'pdf',
  'slides',
  'document',
  'spreadsheet',
  'image',
  'archive',
  'audio',
];

export function materialKindLabel(kind: MaterialKind): string {
  return KIND_LABEL[kind];
}

export function firstSafeMaterialUrl(text: string): string | null {
  const expression = /https?:\/\/[^\s<>"']+/gi;
  for (const match of text.matchAll(expression)) {
    const candidate = match[0].replace(/[。，、；：！？）〉》」』】,.;!?)]+$/u, '');
    try {
      const url = new URL(candidate);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        return url.href;
      }
    } catch {
      /* Skip values that look like URLs but are not. */
    }
  }
  return null;
}

function extensionOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  } catch {
    return '';
  }
}

export function materialKindFromUrl(url: string | null): MaterialKind | null {
  if (!url) return null;
  const ext = extensionOf(url);
  if (ext === 'pdf') return 'pdf';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'slides';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'document';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'spreadsheet';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'gz'].includes(ext)) return 'archive';
  return 'link';
}

export function describeMaterial(item: { title: string; body: string }): {
  kind: MaterialKind;
  kindLabel: string;
  sizeLabel: string;
  open: MaterialOpenAction;
} {
  const href = firstSafeMaterialUrl(item.body);
  const kind = materialKindFromUrl(href) ?? 'text';
  const chars = item.body.trim().length;
  const sizeLabel = href ? MATERIAL_SIZE_UNKNOWN : `約 ${chars} 字`;
  const downloadable = !!href && DOWNLOADABLE.includes(kind);
  const filename = href ? filenameFromUrl(href, item.title) : null;
  return {
    kind,
    kindLabel: materialKindLabel(kind),
    sizeLabel,
    open: {
      href,
      label: href ? (downloadable ? '下載' : '開啟') : '閱讀',
      downloadName: downloadable ? filename : null,
    },
  };
}

function filenameFromUrl(url: string, title: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (name && name !== '.' && name !== '..' && !name.includes('/')) return name.slice(0, 120);
  } catch {
    /* Fall through to a title-based name. */
  }
  return `${title.replace(/[/\\?%*:|"<>]/g, '').slice(0, 80) || '教材'}`;
}

export function groupMaterialsByUnit(
  materials: NuniMaterial[],
  units?: NuniUnit[] | null,
): MaterialCabinetGroup[] {
  const newestFirst = (a: NuniMaterial, b: NuniMaterial) =>
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  if (!units) {
    const loose: MaterialCabinetGroup = { id: null, title: '尚未分類', materials: [] };
    const byUnit = new Map<string, MaterialCabinetGroup>();
    for (const item of materials) {
      if (!item.unitId || !item.unitTitle) {
        loose.materials.push(item);
        continue;
      }
      const group = byUnit.get(item.unitId) ?? {
        id: item.unitId,
        title: item.unitTitle,
        materials: [],
      };
      group.materials.push(item);
      byUnit.set(item.unitId, group);
    }
    const groups = [...byUnit.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-TW'));
    for (const group of [...groups, loose]) group.materials.sort(newestFirst);
    return [...groups, loose].filter((group) => group.materials.length > 0);
  }
  const ordered = [...units].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const groups: MaterialCabinetGroup[] = ordered.map((unit) => ({
    id: unit.id,
    title: unit.title,
    materials: [],
  }));
  const loose: MaterialCabinetGroup = {
    id: null,
    title: ordered.length ? '其他內容' : '尚未分類',
    materials: [],
  };
  const byUnit = new Map(groups.map((group) => [group.id, group]));
  for (const item of materials) {
    const target = (item.unitId ? byUnit.get(item.unitId) : undefined) ?? loose;
    target.materials.push(item);
  }
  for (const group of [...groups, loose]) group.materials.sort(newestFirst);
  return [...groups, loose].filter((group) => group.materials.length > 0);
}

export function courseMaterialHref(workspaceId: string, materialId: string): string {
  return `/classroom/course/${encodeURIComponent(workspaceId)}#material-${encodeURIComponent(materialId)}`;
}

export function isMaterialNew(createdAt: string, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created <= MATERIAL_NEW_MS && now >= created - 60_000;
}

function storageKey(accountId: string): string {
  return `${MATERIAL_READ_KEY_PREFIX}${accountId}`;
}

export function listReadMaterialIds(
  accountId: string,
  storage?: Pick<Storage, 'getItem'> | null,
): Set<string> {
  if (!accountId || !storage) return new Set();
  try {
    const raw = storage.getItem(storageKey(accountId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
  } catch {
    return new Set();
  }
}

const readListeners = new Set<() => void>();

export function subscribeMaterialReads(onChange: () => void) {
  readListeners.add(onChange);
  if (typeof window === 'undefined') {
    return () => {
      readListeners.delete(onChange);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(MATERIAL_READ_KEY_PREFIX)) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    readListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function notifyMaterialReads() {
  readListeners.forEach((listener) => listener());
}

export function markMaterialRead(
  accountId: string,
  materialId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): Set<string> {
  const ids = listReadMaterialIds(accountId, storage);
  if (!accountId || !materialId || !storage) return ids;
  ids.add(materialId);
  try {
    storage.setItem(storageKey(accountId), JSON.stringify([...ids].slice(-400)));
  } catch {
    /* Private mode or quota: unread badges stay until storage is available. */
  }
  notifyMaterialReads();
  return ids;
}

export function isMaterialUnread(
  accountId: string,
  materialId: string,
  storage?: Pick<Storage, 'getItem'> | null,
): boolean {
  return !listReadMaterialIds(accountId, storage).has(materialId);
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, '');
}

function tokens(query: string): string[] {
  return normalize(query)
    .split(/[\s,，、;；]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = new Array<number>(rows * cols);
  for (let i = 0; i < rows; i++) grid[i * cols] = i;
  for (let j = 0; j < cols; j++) grid[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i * cols + j] = Math.min(
        grid[(i - 1) * cols + j] + 1,
        grid[i * cols + j - 1] + 1,
        grid[(i - 1) * cols + j - 1] + cost,
      );
    }
  }
  return grid[a.length * cols + b.length];
}

function orderedCoverage(query: string, haystack: string): number {
  if (!query) return 0;
  let index = 0;
  let hit = 0;
  for (const char of query) {
    const found = haystack.indexOf(char, index);
    if (found < 0) continue;
    hit += 1;
    index = found + 1;
  }
  return hit / query.length;
}

function windowTypo(token: string, haystack: string): boolean {
  if (token.length < 2 || token.length > 24 || /^\d+$/.test(token)) return false;
  for (let i = 0; i + token.length <= haystack.length; i++) {
    if (levenshtein(token, haystack.slice(i, i + token.length)) <= 1) return true;
  }
  return false;
}

export function materialSearchHaystack(item: SearchableMaterial): string {
  return [item.title, item.courseTitle, item.unitTitle ?? '', item.body].join('\n');
}

export function materialSearchScore(query: string, item: SearchableMaterial): number {
  const raw = query.trim();
  if (!raw) return 0;
  const haystack = materialSearchHaystack(item);
  const folded = compact(haystack);
  const needle = compact(raw);
  if (!needle) return 0;
  if (folded.includes(needle)) return 100 + Math.min(needle.length, 20);
  const parts = tokens(raw);
  let score = 0;
  let matched = 0;
  for (const part of parts) {
    const compactPart = part.replace(/\s+/g, '');
    if (!compactPart) continue;
    if (folded.includes(compactPart)) {
      matched += 1;
      score += compactPart.length >= 2 ? 24 : 12;
      continue;
    }
    if (windowTypo(compactPart, folded)) {
      matched += 1;
      score += 16;
      continue;
    }
    const coverage = orderedCoverage(compactPart, folded);
    if (coverage >= 0.7) {
      matched += 1;
      score += Math.round(coverage * 12);
    }
  }
  if (parts.length && matched === parts.length) return score + 8;
  if (parts.length === 1 && matched === 1) return score;
  return parts.length === 0 && orderedCoverage(needle, folded) >= 0.75 ? 10 : 0;
}

export function searchCourseMaterials(
  query: string,
  items: SearchableMaterial[],
): SearchableMaterial[] {
  const raw = query.trim();
  if (!raw) return [];
  return items
    .map((item) => ({ item, score: materialSearchScore(raw, item) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.item.createdAt.localeCompare(a.item.createdAt) ||
        a.item.title.localeCompare(b.item.title, 'zh-TW'),
    )
    .map((entry) => entry.item);
}

type MaterialPageClient = {
  materialsPage(id: string, cursor?: string): Promise<NuniMaterialPage>;
};

function isAccessDenied(error: unknown): boolean {
  return error instanceof NuniError && [403, 404].includes(error.status);
}

function isInvalidMaterialCursor(error: unknown): boolean {
  return error instanceof NuniError && error.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID';
}

function stalledCursorProgress<T extends { id: string }>(
  previous: CourseMaterialPageProgress<T>,
  error: unknown,
): CourseMaterialPageProgress<T> {
  return {
    ...previous,
    nextCursor: null,
    complete: false,
    denied: false,
    error: nuniErrorMessage(error),
    needsRestart: true,
  };
}

function fenceCancelled(fence?: MaterialDiscoveryFence | null): boolean {
  return fence?.cancelled() === true;
}

async function readMaterialPage(
  classes: MaterialPageClient,
  courseId: string,
  cursor: string | undefined,
  fence?: MaterialDiscoveryFence | null,
): Promise<NuniMaterialPage | 'cancelled'> {
  if (fenceCancelled(fence)) return 'cancelled';
  const page = await classes.materialsPage(courseId, cursor);
  if (fenceCancelled(fence)) return 'cancelled';
  return page;
}

function seededCompleteEntry(
  course: NuniWorkspace,
  seed: MaterialSearchSeed,
): CourseMaterialCatalogEntry {
  return {
    courseId: course.id,
    courseTitle: course.title,
    items: seed.items.filter((item) => item.workspaceId === course.id),
    nextCursor: null,
    complete: true,
    denied: false,
    seenCursors: [''],
    error: null,
    needsRestart: false,
  };
}

async function loadCourseFirstSearchPage(
  classes: MaterialPageClient,
  course: NuniWorkspace,
  fence?: MaterialDiscoveryFence | null,
): Promise<CourseMaterialCatalogEntry | 'cancelled'> {
  try {
    const page = await readMaterialPage(classes, course.id, undefined, fence);
    if (page === 'cancelled') return 'cancelled';
    const progress = mergeMaterialPageProgress<SearchableMaterial>(
      emptyCourseMaterialPageProgress(),
      {
        materials: page.materials.map((item) =>
          toSearchableMaterial({ id: course.id, title: course.title }, item),
        ),
        nextCursor: page.nextCursor,
      },
      undefined,
    );
    return { courseId: course.id, courseTitle: course.title, ...progress };
  } catch (error) {
    if (fenceCancelled(fence)) return 'cancelled';
    if (isAccessDenied(error)) {
      return {
        courseId: course.id,
        courseTitle: course.title,
        items: [],
        nextCursor: null,
        complete: false,
        denied: true,
        seenCursors: [],
        error: null,
        needsRestart: false,
      };
    }
    throw error;
  }
}

export async function loadSearchableMaterials(
  classes: MaterialPageClient,
  workspaces: NuniWorkspace[],
  seed?: MaterialSearchSeed | null,
  fence?: MaterialDiscoveryFence | null,
): Promise<SearchableMaterialsCatalog> {
  const seeded = new Set(seed?.courseIds ?? []);
  const active = workspaces.filter((course) => course.state === 'active');
  const courses: CourseMaterialCatalogEntry[] = [];
  let skipped = 0;
  for (let start = 0; start < active.length; start += MATERIAL_COURSE_BATCH) {
    if (fenceCancelled(fence)) {
      return summarizeCatalog(courses, skipped);
    }
    const slice = active.slice(start, start + MATERIAL_COURSE_BATCH);
    const batch = await Promise.all(
      slice.map(async (course) => {
        if (seeded.has(course.id) && seed) {
          return seededCompleteEntry(course, seed);
        }
        return loadCourseFirstSearchPage(classes, course, fence);
      }),
    );
    for (const entry of batch) {
      if (entry === 'cancelled') return summarizeCatalog(courses, skipped);
      if (entry.denied) skipped += 1;
      courses.push(entry);
    }
  }
  if (fenceCancelled(fence)) return summarizeCatalog(courses, skipped);
  return summarizeCatalog(courses, skipped);
}

export async function continueSearchableMaterials(
  classes: MaterialPageClient,
  catalog: SearchableMaterialsCatalog,
  fence?: MaterialDiscoveryFence | null,
): Promise<SearchableMaterialsCatalog> {
  const pending = catalog.courses.filter(
    (course) =>
      !course.denied && !course.complete && !course.needsRestart && !!course.nextCursor,
  );
  if (!pending.length) return catalog;
  const courses = catalog.courses.map((course) => ({ ...course, items: [...course.items] }));
  let skipped = catalog.skipped;
  for (let start = 0; start < pending.length; start += MATERIAL_COURSE_BATCH) {
    if (fenceCancelled(fence)) return summarizeCatalog(courses, skipped);
    const slice = pending.slice(start, start + MATERIAL_COURSE_BATCH);
    await Promise.all(
      slice.map(async (target) => {
        const index = courses.findIndex((course) => course.courseId === target.courseId);
        if (index < 0) return;
        const current = courses[index];
        const cursor = current.nextCursor;
        if (!cursor || current.seenCursors.includes(cursor)) {
          courses[index] = {
            ...current,
            nextCursor: null,
            complete: false,
            error: MATERIAL_CURSOR_CYCLE_MESSAGE,
            needsRestart: true,
          };
          return;
        }
        try {
          const page = await readMaterialPage(classes, current.courseId, cursor, fence);
          if (page === 'cancelled') return;
          const progress = mergeMaterialPageProgress<SearchableMaterial>(
            current,
            {
              materials: page.materials.map((item) =>
                toSearchableMaterial(
                  { id: current.courseId, title: current.courseTitle },
                  item,
                ),
              ),
              nextCursor: page.nextCursor,
            },
            cursor,
          );
          courses[index] = { ...current, ...progress };
        } catch (error) {
          if (fenceCancelled(fence)) return;
          if (isAccessDenied(error)) {
            courses[index] = {
              ...current,
              items: [],
              nextCursor: null,
              complete: false,
              denied: true,
              seenCursors: [],
              error: null,
              needsRestart: false,
            };
            skipped += 1;
            return;
          }
          if (isInvalidMaterialCursor(error)) {
            courses[index] = {
              courseId: current.courseId,
              courseTitle: current.courseTitle,
              ...stalledCursorProgress(current, error),
            };
            return;
          }
          courses[index] = {
            ...current,
            error: nuniErrorMessage(error),
            needsRestart: false,
          };
        }
      }),
    );
  }
  if (fenceCancelled(fence)) return summarizeCatalog(courses, skipped);
  return summarizeCatalog(courses, skipped);
}

/**
 * Replace stalled courses with a fresh first-page read. Confirmed rows stay
 * visible until the replacement page succeeds; 403/404 still evict.
 */
export async function restartSearchableMaterials(
  classes: MaterialPageClient,
  catalog: SearchableMaterialsCatalog,
  fence?: MaterialDiscoveryFence | null,
): Promise<SearchableMaterialsCatalog> {
  const stalled = catalog.courses.filter((course) => !course.denied && course.needsRestart);
  if (!stalled.length) return catalog;
  const courses = catalog.courses.map((course) => ({ ...course, items: [...course.items] }));
  let skipped = catalog.skipped;
  for (let start = 0; start < stalled.length; start += MATERIAL_COURSE_BATCH) {
    if (fenceCancelled(fence)) return summarizeCatalog(courses, skipped);
    const slice = stalled.slice(start, start + MATERIAL_COURSE_BATCH);
    await Promise.all(
      slice.map(async (target) => {
        const index = courses.findIndex((course) => course.courseId === target.courseId);
        if (index < 0) return;
        const current = courses[index];
        try {
          const page = await readMaterialPage(classes, current.courseId, undefined, fence);
          if (page === 'cancelled') return;
          const progress = mergeMaterialPageProgress<SearchableMaterial>(
            emptyCourseMaterialPageProgress(),
            {
              materials: page.materials.map((item) =>
                toSearchableMaterial(
                  { id: current.courseId, title: current.courseTitle },
                  item,
                ),
              ),
              nextCursor: page.nextCursor,
            },
            undefined,
          );
          courses[index] = {
            courseId: current.courseId,
            courseTitle: current.courseTitle,
            ...progress,
          };
        } catch (error) {
          if (fenceCancelled(fence)) return;
          if (isAccessDenied(error)) {
            courses[index] = {
              ...current,
              items: [],
              nextCursor: null,
              complete: false,
              denied: true,
              seenCursors: [],
              error: null,
              needsRestart: false,
            };
            skipped += 1;
            return;
          }
          courses[index] = {
            courseId: current.courseId,
            courseTitle: current.courseTitle,
            ...stalledCursorProgress(current, error),
          };
        }
      }),
    );
  }
  if (fenceCancelled(fence)) return summarizeCatalog(courses, skipped);
  return summarizeCatalog(courses, skipped);
}

export async function loadCourseMaterialsPage(
  classes: MaterialPageClient,
  courseId: string,
  previous: CourseMaterialPageProgress<NuniMaterial> | null,
  fence?: MaterialDiscoveryFence | null,
): Promise<CourseMaterialPageProgress<NuniMaterial> | 'cancelled'> {
  const base = previous ?? emptyCourseMaterialPageProgress<NuniMaterial>();
  const cursor = previous?.nextCursor ?? undefined;
  if (previous && (!cursor || previous.needsRestart)) return base;
  if (cursor && base.seenCursors.includes(cursor)) {
    return {
      ...base,
      nextCursor: null,
      complete: false,
      error: MATERIAL_CURSOR_CYCLE_MESSAGE,
      needsRestart: true,
    };
  }
  try {
    const page = await readMaterialPage(classes, courseId, cursor, fence);
    if (page === 'cancelled') return 'cancelled';
    return mergeMaterialPageProgress(base, page, cursor);
  } catch (error) {
    if (fenceCancelled(fence)) return 'cancelled';
    if (isAccessDenied(error)) {
      return {
        items: [],
        nextCursor: null,
        complete: false,
        denied: true,
        seenCursors: [],
        error: null,
        needsRestart: false,
      };
    }
    if (!previous) throw error;
    if (isInvalidMaterialCursor(error)) {
      return stalledCursorProgress(base, error);
    }
    return {
      ...base,
      error: nuniErrorMessage(error),
      needsRestart: false,
    };
  }
}

/**
 * Fresh first-page read for a stalled course. Keeps previous rows until the
 * replacement page confirms access; denial still evicts.
 */
export async function restartCourseMaterialsPage(
  classes: MaterialPageClient,
  courseId: string,
  previous: CourseMaterialPageProgress<NuniMaterial>,
  fence?: MaterialDiscoveryFence | null,
): Promise<CourseMaterialPageProgress<NuniMaterial> | 'cancelled'> {
  try {
    const page = await readMaterialPage(classes, courseId, undefined, fence);
    if (page === 'cancelled') return 'cancelled';
    return mergeMaterialPageProgress(emptyCourseMaterialPageProgress<NuniMaterial>(), page, undefined);
  } catch (error) {
    if (fenceCancelled(fence)) return 'cancelled';
    if (isAccessDenied(error)) {
      return {
        items: [],
        nextCursor: null,
        complete: false,
        denied: true,
        seenCursors: [],
        error: null,
        needsRestart: false,
      };
    }
    return stalledCursorProgress(previous, error);
  }
}
