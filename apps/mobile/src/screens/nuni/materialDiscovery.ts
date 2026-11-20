/** Loaded-page material search and bounded materialsPage append helpers. */

export const MATERIAL_CURSOR_CYCLE_MESSAGE =
  '較早教材未能繼續載入，清單可能不完整。請更新教材後再試。';

/** Auto older-page fetches for an explicit materialId target (first page already loaded). */
export const MATERIAL_TARGET_AUTO_PAGE_BUDGET = 4;

export type MaterialPageProgress<T extends { id: string }> = {
  items: T[];
  nextCursor: string | null;
  seenCursors: string[];
  cycleDetected: boolean;
};

export function emptyMaterialPageProgress<T extends { id: string }>(): MaterialPageProgress<T> {
  return {
    items: [],
    nextCursor: null,
    seenCursors: [],
    cycleDetected: false,
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
 * Merge one materialsPage reply. Stops on self-repeat or A→B→A cursor cycles
 * without marking the list complete.
 */
export function appendMaterialPage<T extends { id: string }>(
  previous: MaterialPageProgress<T>,
  page: { materials: T[]; nextCursor: string | null },
  requestedCursor: string | undefined,
): MaterialPageProgress<T> {
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
      seenCursors,
      cycleDetected: false,
    };
  }
  if (nextCursor === requestedCursor || seenCursors.includes(nextCursor)) {
    return {
      items,
      nextCursor: null,
      seenCursors,
      cycleDetected: true,
    };
  }
  return {
    items,
    nextCursor,
    seenCursors,
    cycleDetected: false,
  };
}

/** Plain-text normalize only — never treat the query as a RegExp. */
export function normalizeMaterialSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-TW')
    .replace(/\s+/g, '');
}

export function materialMatchesQuery(
  material: { title: string; body: string; unitTitle?: string | null },
  query: string,
): boolean {
  const needle = normalizeMaterialSearchText(query);
  if (!needle) return true;
  const haystack = normalizeMaterialSearchText(
    [material.title, material.unitTitle ?? '', material.body].join('\n'),
  );
  return haystack.includes(needle);
}

export function filterLoadedMaterials<T extends { title: string; body: string; unitTitle?: string | null }>(
  materials: T[],
  query: string,
): T[] {
  if (!query.trim()) return materials;
  return materials.filter((item) => materialMatchesQuery(item, query));
}

/**
 * Keep an explicit deep-link target visible even if an old search would hide it.
 */
export function visibleLoadedMaterials<T extends { id: string; title: string; body: string; unitTitle?: string | null }>(
  materials: T[],
  query: string,
  focusMaterialId?: string | null,
): T[] {
  const matched = filterLoadedMaterials(materials, query);
  if (!focusMaterialId) return matched;
  if (matched.some((item) => item.id === focusMaterialId)) return matched;
  const focused = materials.find((item) => item.id === focusMaterialId);
  return focused ? [focused, ...matched] : matched;
}

export function materialSearchStatusCopy(input: {
  query: string;
  loadedCount: number;
  matchCount: number;
  hasOlder: boolean;
  /** Cursor cycle / restart-needed — not a complete catalogue. */
  interrupted?: boolean;
}): string | null {
  const trimmed = input.query.trim();
  if (input.interrupted) {
    if (input.loadedCount <= 0) return null;
    if (!trimmed) {
      return `已載入 ${input.loadedCount} 筆教材，清單尚未完整。`;
    }
    if (input.matchCount > 0) {
      return `已載入 ${input.loadedCount} 筆，符合 ${input.matchCount} 筆；清單尚未完整。`;
    }
    return `目前已載入的教材中沒有符合「${trimmed}」的結果；清單尚未完整。`;
  }
  if (!trimmed) {
    if (input.loadedCount <= 0) return null;
    return input.hasOlder
      ? `已載入 ${input.loadedCount} 筆教材，還有較早內容。`
      : `共 ${input.loadedCount} 筆教材。`;
  }
  if (input.matchCount > 0) {
    return input.hasOlder
      ? `已載入 ${input.loadedCount} 筆，符合 ${input.matchCount} 筆，還有較早內容。`
      : `已載入 ${input.loadedCount} 筆，符合 ${input.matchCount} 筆。`;
  }
  if (input.hasOlder) {
    return '已載入教材中沒有相符結果，還有較早內容';
  }
  return `目前已載入的教材中沒有符合「${trimmed}」的結果。`;
}
