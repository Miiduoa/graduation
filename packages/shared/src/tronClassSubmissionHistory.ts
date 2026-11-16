/** Read-only school history. These records never confirm a new nuni submission. */
export type TronClassSubmissionHistoryEntry = {
  id: string;
  state: 'submitted' | 'draft' | 'returned' | 'teacher-marked' | 'unknown';
  isLatest: boolean;
  /** The school's created_at, not a verified final-submission timestamp. */
  createdAt: string | null;
  content: string;
  contentTruncated: boolean;
  attachments: { name: string; size: number | null }[];
  hasOtherResources: boolean;
};

export type TronClassSubmissionHistory = {
  source: 'tronclass';
  courseId: number;
  homeworkId: number;
  fetchedAt: string;
  state: 'available' | 'unavailable' | 'group-unsupported';
  /** Only is_latest_version:true establishes this value. */
  latestId: string | null;
  entries: TronClassSubmissionHistoryEntry[];
};

export const TRONCLASS_HISTORY_MAX_ENTRIES = 100;
export const TRONCLASS_HISTORY_MAX_ATTACHMENTS = 100;
export const TRONCLASS_HISTORY_MAX_CONTENT = 20_000;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const time = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));

/** Shared by the response boundary and client; never accepts raw school rows. */
export function isTronClassSubmissionHistory(
  value: unknown,
  scope: { courseId: number; homeworkId: number },
): value is TronClassSubmissionHistory {
  if (!object(value) || !only(value, ['source', 'courseId', 'homeworkId', 'fetchedAt', 'state', 'latestId', 'entries']) ||
    value.source !== 'tronclass' || !id(value.courseId) || !id(value.homeworkId) ||
    value.courseId !== scope.courseId || value.homeworkId !== scope.homeworkId || !time(value.fetchedAt) ||
    typeof value.state !== 'string' || !['available', 'unavailable', 'group-unsupported'].includes(value.state) ||
    !Array.isArray(value.entries) || value.entries.length > TRONCLASS_HISTORY_MAX_ENTRIES ||
    !(value.latestId === null || (typeof value.latestId === 'string' && /^[1-9]\d{0,15}$/.test(value.latestId) &&
      Number.isSafeInteger(Number(value.latestId))))) return false;
  if (value.state !== 'available') return value.entries.length === 0 && value.latestId === null;
  const ids = new Set<string>();
  const latest: string[] = [];
  for (const entry of value.entries) {
    if (!object(entry) || !only(entry, ['id', 'state', 'isLatest', 'createdAt', 'content', 'contentTruncated', 'attachments', 'hasOtherResources']) ||
      typeof entry.id !== 'string' || !/^[1-9]\d{0,15}$/.test(entry.id) || !Number.isSafeInteger(Number(entry.id)) || ids.has(entry.id) ||
      typeof entry.state !== 'string' || !['submitted', 'draft', 'returned', 'teacher-marked', 'unknown'].includes(entry.state) ||
      typeof entry.isLatest !== 'boolean' || !(entry.createdAt === null || time(entry.createdAt)) ||
      typeof entry.content !== 'string' || entry.content.length > TRONCLASS_HISTORY_MAX_CONTENT ||
      typeof entry.contentTruncated !== 'boolean' || typeof entry.hasOtherResources !== 'boolean' ||
      !Array.isArray(entry.attachments) || entry.attachments.length > TRONCLASS_HISTORY_MAX_ATTACHMENTS) return false;
    for (const file of entry.attachments) {
      if (!object(file) || !only(file, ['name', 'size']) ||
        typeof file.name !== 'string' || !file.name.trim() || file.name.length > 200 ||
        Array.from(file.name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
        !(file.size === null || (typeof file.size === 'number' && Number.isSafeInteger(file.size) && file.size >= 0))) return false;
    }
    if (entry.state === 'teacher-marked' && (entry.content || entry.attachments.length || entry.hasOtherResources)) return false;
    ids.add(entry.id);
    if (entry.isLatest) latest.push(entry.id);
  }
  return latest.length <= 1 && (latest[0] ?? null) === value.latestId;
}
