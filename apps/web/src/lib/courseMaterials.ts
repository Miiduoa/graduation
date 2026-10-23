import type { NuniMaterial, NuniUnit, NuniWorkspace } from '@campus/shared/src/nuni';
import { NuniError } from '@campus/shared/src/nuni';

export const MATERIAL_NEW_MS = 7 * 24 * 60 * 60 * 1000;
export const MATERIAL_HOME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const MATERIAL_READ_KEY_PREFIX = 'nuni-material-read:';
export const MATERIAL_SIZE_UNKNOWN = '大小未提供（教材沒有檔案大小欄位）';

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

type MaterialClient = {
  materials(id: string): Promise<NuniMaterial[]>;
};

export async function loadSearchableMaterials(
  classes: MaterialClient,
  workspaces: NuniWorkspace[],
): Promise<{ items: SearchableMaterial[]; skipped: number; truncated: boolean }> {
  const catalog: SearchableMaterial[] = [];
  let skipped = 0;
  let truncated = false;
  const active = workspaces.filter((course) => course.state === 'active');
  const batchSize = 4;
  for (let start = 0; start < active.length; start += batchSize) {
    const batch = await Promise.all(
      active.slice(start, start + batchSize).map(async (course) => {
        try {
          const materials = await classes.materials(course.id);
          if (materials.length >= 100) truncated = true;
          return materials.map((item) => ({
            id: item.id,
            workspaceId: item.workspaceId,
            courseTitle: course.title,
            title: item.title,
            body: item.body,
            unitTitle: item.unitTitle,
            createdAt: item.createdAt,
          }));
        } catch (error) {
          if (error instanceof NuniError && [403, 404].includes(error.status)) {
            skipped += 1;
            return [];
          }
          throw error;
        }
      }),
    );
    catalog.push(...batch.flat());
  }
  return { items: catalog, skipped, truncated };
}
