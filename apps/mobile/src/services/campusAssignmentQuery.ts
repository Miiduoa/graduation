import type { CampusSenseSnapshot } from './campusSenseSnapshot';

export type CampusAssignmentFilter = 'all' | 'today' | 'seven-days' | 'overdue' | 'undated';
export type CampusAssignmentSort = 'deadline' | 'course';
export type CampusAssignmentRow = CampusSenseSnapshot['assignments']['items'][number];
export const ASSIGNMENT_WORKBENCH_PAGE_SIZE = 12;
const DAY_MS = 86_400_000;

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, ' ').trim();
}

/** Taiwan dates, not the device's timezone. No period-to-clock conversion. */
function taiwanDay(time: number): number {
  return Math.floor((time + 8 * 60 * 60 * 1000) / DAY_MS);
}

export function assignmentDueTime(value: string | null): number | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

export function assignmentDeadlineLabel(row: CampusAssignmentRow, now: number): string {
  const due = assignmentDueTime(row.dueAt);
  if (due === null) return '截止日期未提供，請核對原始作業頁';
  const text = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(due));
  return (due < now ? '期限已過 · ' : '截止 ') + text;
}

export interface CampusAssignmentQueryResult {
  matched: number;
  loaded: number;
  page: number;
  pageCount: number;
  start: number;
  end: number;
  rows: Array<{ key: string; assignment: CampusAssignmentRow; overdue: boolean }>;
}

/**
 * Read-only search of an already validated in-memory source. The caller owns
 * account/expiry checks. A text query is literal data, never a regex or a tool.
 * Pagination bounds rendered rows, not the records considered by this query.
 */
export function queryCampusAssignments(input: {
  items: readonly CampusAssignmentRow[];
  query: string;
  filter: CampusAssignmentFilter;
  sort: CampusAssignmentSort;
  page: number;
  now: number;
}): CampusAssignmentQueryResult {
  if (!Number.isFinite(input.now)) throw new Error('invalid-assignment-query-time');
  const terms = normalized(input.query.slice(0, 160)).split(' ').filter(Boolean);
  const today = taiwanDay(input.now);
  const matches = input.items.map((assignment, index) => ({
    assignment, index, due: assignmentDueTime(assignment.dueAt),
    course: normalized(assignment.groupName),
    text: normalized(assignment.title + ' ' + assignment.groupName),
  })).filter((row) => {
    if (!terms.every((term) => row.text.includes(term))) return false;
    switch (input.filter) {
      case 'all': return true;
      // Today's overdue tasks still belong to today; the status label is explicit.
      case 'today': return row.due !== null && taiwanDay(row.due) === today;
      // Upcoming only, including the rest of today and the next six Taiwan dates.
      case 'seven-days': return row.due !== null && row.due >= input.now &&
        taiwanDay(row.due) >= today && taiwanDay(row.due) < today + 7;
      case 'overdue': return row.due !== null && row.due < input.now;
      case 'undated': return row.due === null;
      default: return false;
    }
  });
  matches.sort((left, right) => {
    if (input.sort === 'course' && left.course !== right.course) {
      return left.course < right.course ? -1 : 1;
    }
    const a = left.due ?? Infinity;
    const b = right.due ?? Infinity;
    return a === b ? left.index - right.index : a < b ? -1 : 1;
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / ASSIGNMENT_WORKBENCH_PAGE_SIZE));
  const requested = Number.isSafeInteger(input.page) ? input.page : 0;
  const page = Math.max(0, Math.min(requested, pageCount - 1));
  const offset = page * ASSIGNMENT_WORKBENCH_PAGE_SIZE;
  return {
    matched: matches.length, loaded: input.items.length, page, pageCount,
    start: matches.length ? offset + 1 : 0,
    end: Math.min(offset + ASSIGNMENT_WORKBENCH_PAGE_SIZE, matches.length),
    rows: matches.slice(offset, offset + ASSIGNMENT_WORKBENCH_PAGE_SIZE).map((row) => ({
      // Keep equal display names as distinct rows; never deduplicate by title.
      key: JSON.stringify([row.assignment.source?.groupId, row.assignment.source?.assignmentId, row.index]),
      assignment: row.assignment,
      overdue: row.due !== null && row.due < input.now,
    })),
  };
}
