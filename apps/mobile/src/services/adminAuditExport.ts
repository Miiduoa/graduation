import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

/** Soft cap so "full history" export stays bounded and cancelable. */
export const ADMIN_LOG_EXPORT_MAX_ROWS = 2000;
export const ADMIN_LOG_EXPORT_PAGE_SIZE = 50;

export type AdminLogExportRow = {
  id: string;
  action: string;
  actorUid?: string;
  actorEmail?: string;
  details?: string;
  createdAt?: unknown;
};

export type AdminLogExportScope =
  | { kind: 'loaded_filtered'; count: number }
  | { kind: 'school_paged'; fetched: number; complete: boolean; capped: boolean };

export type FetchAdminLogsPagedResult = {
  rows: AdminLogExportRow[];
  complete: boolean;
  capped: boolean;
  pages: number;
};

export function mapAdminLogDoc(docSnap: QueryDocumentSnapshot): AdminLogExportRow {
  const data = docSnap.data() as Record<string, unknown>;
  return {
    id: docSnap.id,
    action: typeof data.action === 'string' ? data.action : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : undefined,
    actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : undefined,
    details: typeof data.details === 'string' ? data.details : undefined,
    createdAt: data.createdAt,
  };
}

/**
 * Neutralize spreadsheet formula injection while preserving quotes/commas.
 * Matches Campus CSV export conventions (prefix `'` for formula-like cells).
 */
export function escapeAdminCsvValue(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\u200B-\u200D\uFEFF]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAdminCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(escapeAdminCsvValue).join(','),
    ...rows.map((row) => row.map(escapeAdminCsvValue).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function describeAdminLogExportScope(scope: AdminLogExportScope): string {
  if (scope.kind === 'loaded_filtered') {
    return `匯出範圍：目前畫面上已載入且符合篩選的 ${scope.count} 筆操作紀錄（不是全校完整歷史）。`;
  }
  if (scope.complete) {
    return `匯出範圍：此學校可讀取的操作紀錄全部分頁結果，共 ${scope.fetched} 筆。`;
  }
  if (scope.capped) {
    return `匯出範圍：已依安全上限擷取前 ${scope.fetched} 筆操作紀錄；仍可能有更早的紀錄未匯出。`;
  }
  return `匯出範圍：已擷取 ${scope.fetched} 筆操作紀錄；匯出未完成（已取消或中斷）。`;
}

export async function fetchAdminLogsPaged(options: {
  db: Firestore;
  schoolId: string;
  pageSize?: number;
  maxRows?: number;
  signal?: AbortSignal;
  onPage?: (info: { pages: number; fetched: number }) => void;
}): Promise<FetchAdminLogsPagedResult> {
  const pageSize = options.pageSize ?? ADMIN_LOG_EXPORT_PAGE_SIZE;
  const maxRows = options.maxRows ?? ADMIN_LOG_EXPORT_MAX_ROWS;
  const rows = new Map<string, AdminLogExportRow>();
  let cursor: QueryDocumentSnapshot | null = null;
  let pages = 0;
  let complete = false;
  let capped = false;

  while (rows.size < maxRows) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const remaining = maxRows - rows.size;
    const take = Math.min(pageSize, remaining);
    const page = await getDocs(
      query(
        collection(options.db, 'schools', options.schoolId, 'adminLogs'),
        // Match timestamp DESC with __name__ DESC so tie-break cursors stay on one index
        // direction (see Firestore default ordering / name field docs).
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(take),
      ),
    );

    pages += 1;
    const pageDocs = page.docs.slice(0, take);
    for (const docSnap of pageDocs) {
      const mapped = mapAdminLogDoc(docSnap);
      rows.set(mapped.id, mapped);
    }

    options.onPage?.({ pages, fetched: rows.size });

    if (pageDocs.length < take) {
      complete = true;
      break;
    }

    cursor = pageDocs[pageDocs.length - 1] ?? null;
    if (!cursor) {
      complete = true;
      break;
    }

    if (rows.size >= maxRows) {
      capped = true;
      break;
    }
  }

  return {
    rows: Array.from(rows.values()),
    complete,
    capped,
    pages,
  };
}
