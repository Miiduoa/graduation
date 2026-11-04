/** A tab-local receipt pointer, never an offline mutation queue. */
export type CorrectionBookmarkScope = { actorUid: string; courseId: string; sessionId: string };
export type CorrectionBookmark = CorrectionBookmarkScope & {
  version: 1;
  requestId: string;
  createdAt: number;
};
export type BookmarkRead =
  | { kind: 'empty' }
  | { kind: 'unavailable' }
  | { kind: 'invalid' }
  | { kind: 'pending'; bookmark: CorrectionBookmark };
export type BookmarkStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'campus-one:attendance-receipt:v1:';
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validScope = (scope: CorrectionBookmarkScope) =>
  [scope.actorUid, scope.courseId, scope.sessionId].every(validId);
const keyFor = (scope: CorrectionBookmarkScope) =>
  PREFIX + JSON.stringify([scope.actorUid, scope.courseId, scope.sessionId]);

function browserStorage(): BookmarkStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
}

export function readCorrectionBookmark(
  scope: CorrectionBookmarkScope,
  storage: BookmarkStorage | null = browserStorage(),
): BookmarkRead {
  if (!validScope(scope)) return { kind: 'invalid' };
  if (!storage) return { kind: 'unavailable' };
  let raw: string | null;
  try { raw = storage.getItem(keyFor(scope)); }
  catch { return { kind: 'unavailable' }; }
  try {
    if (raw === null) return { kind: 'empty' };
    if (raw.length > 1400) return { kind: 'invalid' };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'actorUid,courseId,createdAt,requestId,sessionId,version' ||
        record.version !== 1 || record.actorUid !== scope.actorUid || record.courseId !== scope.courseId ||
        record.sessionId !== scope.sessionId || !validId(record.requestId) ||
        typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) {
      return { kind: 'invalid' };
    }
    return { kind: 'pending', bookmark: {
      version: 1, actorUid: scope.actorUid, courseId: scope.courseId, sessionId: scope.sessionId,
      requestId: record.requestId, createdAt: record.createdAt,
    } };
  } catch { return { kind: 'invalid' }; }
}

/** Persist before dispatch. Do not overwrite another unresolved operation. */
export function rememberCorrectionBookmark(
  scope: CorrectionBookmarkScope,
  requestId: string,
  storage: BookmarkStorage | null = browserStorage(),
  now = Date.now(),
): 'saved' | 'unavailable' | 'conflict' {
  if (!validScope(scope) || !validId(requestId) || !Number.isSafeInteger(now) || now < 0) return 'conflict';
  if (!storage) return 'unavailable';
  const previous = readCorrectionBookmark(scope, storage);
  if (previous.kind === 'invalid') return 'conflict';
  if (previous.kind === 'unavailable') return 'unavailable';
  if (previous.kind === 'pending') return previous.bookmark.requestId === requestId ? 'saved' : 'conflict';
  try {
    const record: CorrectionBookmark = { version: 1, actorUid: scope.actorUid, courseId: scope.courseId,
      sessionId: scope.sessionId, requestId, createdAt: now };
    storage.setItem(keyFor(scope), JSON.stringify(record));
    const verified = readCorrectionBookmark(scope, storage);
    return verified.kind === 'pending' && verified.bookmark.requestId === requestId ? 'saved' : 'unavailable';
  } catch { return 'unavailable'; }
}

/** A late completion must not clear a newer operation's reminder. */
export function clearCorrectionBookmark(
  scope: CorrectionBookmarkScope,
  requestId: string,
  storage: BookmarkStorage | null = browserStorage(),
): boolean {
  if (!validScope(scope) || !validId(requestId) || !storage) return false;
  const previous = readCorrectionBookmark(scope, storage);
  if (previous.kind === 'empty') return true;
  if (previous.kind !== 'pending' || previous.bookmark.requestId !== requestId) return false;
  try { storage.removeItem(keyFor(scope)); return storage.getItem(keyFor(scope)) === null; }
  catch { return false; }
}

/** Used only after explicit acknowledgement; malformed values are never replayed. */
export function clearInvalidCorrectionBookmark(
  scope: CorrectionBookmarkScope,
  storage: BookmarkStorage | null = browserStorage(),
): boolean {
  if (!validScope(scope) || !storage || readCorrectionBookmark(scope, storage).kind !== 'invalid') return false;
  try { storage.removeItem(keyFor(scope)); return storage.getItem(keyFor(scope)) === null; }
  catch { return false; }
}
