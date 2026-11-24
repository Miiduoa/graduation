export type SavedCampusEvent = {
  schoolId: string;
  id: string;
  source: 'school-club-events' | 'school-events' | 'legacy-events';
  title: string;
};

export type CampusEventShortlistSnapshot = {
  items: SavedCampusEvent[];
  ready: boolean;
  error: string | null;
};

export const EMPTY_CAMPUS_EVENT_SHORTLIST: CampusEventShortlistSnapshot = {
  items: [], ready: false, error: null,
};
export const CAMPUS_EVENT_SHORTLIST_LIMIT = 100;
const PREFIX = 'nuni-campus-event-shortlist:v1:';
const READ_ERROR = '無法讀取此裝置的活動收藏，請重試。';
const WRITE_ERROR = '無法儲存變更，請確認裝置儲存空間後再試一次。';

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 1500 &&
    !value.includes('/') && value !== '.' && value !== '..';
}

export function campusEventShortlistOwner(schoolUid?: string | null, platformAccountId?: string | null): string | null {
  if (!schoolUid && !platformAccountId) return null;
  return JSON.stringify([schoolUid || null, platformAccountId || null]);
}

export function campusEventShortlistKey(schoolId: string, uid: string | null): string {
  return PREFIX + JSON.stringify([schoolId, uid]);
}

function schoolFromKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  try {
    const scope: unknown = JSON.parse(key.slice(PREFIX.length));
    if (Array.isArray(scope) && scope.length === 2) {
      const [schoolId, uid] = scope;
      if (validDocumentId(schoolId) && (uid === null || (typeof uid === 'string' && uid.trim())) &&
        campusEventShortlistKey(schoolId, uid) === key) return schoolId;
    }
  } catch { /* Malformed storage scope. */ }
  return null;
}

function publicEvent(value: unknown, schoolId: string): SavedCampusEvent | null {
  if (!value || typeof value !== 'object') return null;
  const { schoolId: eventSchool, id, source, title } = value as Partial<SavedCampusEvent>;
  if (eventSchool !== schoolId || !validDocumentId(id) || typeof title !== 'string' || !title.trim() ||
    (source !== 'school-club-events' && source !== 'school-events' && source !== 'legacy-events')) return null;
  // Only retain a display label and the identity needed to reopen the current source record.
  const label = title.trim().slice(0, 400).replace(/[\uD800-\uDBFF]$/, '');
  if (!label) return null;
  return { schoolId, id, source, title: label };
}

function readEvents(raw: string | null, schoolId: string): SavedCampusEvent[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 ||
    !('items' in data) || !Array.isArray(data.items) || data.items.length > CAMPUS_EVENT_SHORTLIST_LIMIT) {
    throw new Error(READ_ERROR);
  }
  const unique = new Map<string, SavedCampusEvent>();
  for (const row of data.items) {
    const event = publicEvent(row, schoolId);
    if (!event) throw new Error(READ_ERROR);
    unique.set(`${event.source}:${event.id}`, event);
  }
  return [...unique.values()];
}

type ShortlistStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  withLock?<T>(key: string, operation: () => Promise<T>): Promise<T>;
};

export function createCampusEventShortlistStore(storage: ShortlistStorage) {
  const snapshots = new Map<string, CampusEventShortlistSnapshot>();
  const listeners = new Map<string, Set<() => void>>();
  const queues = new Map<string, Promise<void>>();
  const getSnapshot = (key: string) => snapshots.get(key) ?? EMPTY_CAMPUS_EVENT_SHORTLIST;

  function publish(key: string, snapshot: CampusEventShortlistSnapshot) {
    snapshots.set(key, snapshot);
    listeners.get(key)?.forEach((listener) => listener());
  }

  function enqueue<T>(key: string, operation: () => Promise<T>) {
    const current = (queues.get(key) ?? Promise.resolve()).then(operation);
    const release = () => { if (queues.get(key) === tail) queues.delete(key); };
    const tail = current.then(release, release);
    queues.set(key, tail);
    return current;
  }

  async function read(key: string, schoolId: string): Promise<SavedCampusEvent[] | null> {
    try {
      return readEvents(await storage.getItem(key), schoolId);
    } catch {
      publish(key, { items: [], ready: false, error: READ_ERROR });
      return null;
    }
  }

  async function load(key: string): Promise<void> {
    const schoolId = schoolFromKey(key);
    if (!schoolId) return;
    await enqueue(key, async () => {
      const items = await read(key, schoolId);
      if (items) publish(key, { items, ready: true, error: null });
    });
  }

  async function setSaved(key: string, event: SavedCampusEvent, saved: boolean): Promise<boolean> {
    const schoolId = schoolFromKey(key);
    if (!schoolId) return false;
    const item = publicEvent(event, schoolId);
    if (!item) {
      publish(key, { ...getSnapshot(key), error: '活動資料無法確認，請重新開啟活動。' });
      return false;
    }
    return enqueue(key, async () => {
      const update = async () => {
        // Re-read under the device lock so another tab's newly saved events survive this write.
        const previous = await read(key, schoolId);
        if (!previous) return false;
        const matches = (row: SavedCampusEvent) => row.source === item.source && row.id === item.id;
        if (previous.some(matches) === saved) {
          publish(key, { items: previous, ready: true, error: null });
          return true;
        }
        if (saved && previous.length >= CAMPUS_EVENT_SHORTLIST_LIMIT) {
          publish(key, { items: previous, ready: true, error: `已收藏 ${CAMPUS_EVENT_SHORTLIST_LIMIT} 場活動，請先移除一場。` });
          return false;
        }
        const items = saved ? [item, ...previous] : previous.filter((row) => !matches(row));
        try {
          await storage.setItem(key, JSON.stringify({ version: 1, items }));
        } catch {
          publish(key, { items: previous, ready: true, error: WRITE_ERROR });
          return false;
        }
        publish(key, { items, ready: true, error: null });
        return true;
      };
      try {
        return await (storage.withLock ? storage.withLock(key, update) : update());
      } catch {
        publish(key, { ...getSnapshot(key), error: WRITE_ERROR });
        return false;
      }
    });
  }

  function subscribe(key: string, listener: () => void) {
    const group = listeners.get(key) ?? new Set();
    group.add(listener);
    listeners.set(key, group);
    return () => {
      group.delete(listener);
      if (!group.size) listeners.delete(key);
    };
  }

  return { getSnapshot, subscribe, load, setSaved };
}
