import type { CampusEvent, CampusEventSource } from '@/lib/campusEvents';
import { eventRegistrationLabel, type EventRegistrationState } from '@/lib/campusEventRegistration';
import { schoolLoginHref } from '@/lib/navigation';
import { listPageNumber, listQueryValue, listSearchText, type ServiceListQuery } from '@/lib/serviceListNavigation';
import { campusEventPhase, type CampusEventTime } from '@campus/shared/src/campusEventTime';

export type CampusEventView = 'all' | 'upcoming' | 'ongoing' | 'past' | 'unscheduled';
export type CampusEventFilters = { q: string; view: CampusEventView; page?: number };
export const EVENT_RESTORE_BATCH_SIZE = 10;

export const CAMPUS_EVENT_VIEWS: ReadonlyArray<{ value: CampusEventView; label: string }> = [
  { value: 'all', label: '全部活動' },
  { value: 'ongoing', label: '進行中' },
  { value: 'upcoming', label: '即將開始' },
  { value: 'past', label: '已開始／過往' },
  { value: 'unscheduled', label: '時間待公告' },
];

export function readCampusEventFilters(query?: ServiceListQuery): CampusEventFilters {
  const view = listQueryValue(query, 'view');
  const page = listPageNumber(listQueryValue(query, 'page'));
  return {
    q: listSearchText(listQueryValue(query, 'q')),
    view: CAMPUS_EVENT_VIEWS.some((item) => item.value === view) ? view as CampusEventView : 'all',
    ...(page > 1 ? { page } : {}),
  };
}

export function campusEventFilterQuery(filters: CampusEventFilters): URLSearchParams {
  const params = new URLSearchParams();
  const q = listSearchText(filters.q);
  if (q) params.set('q', q);
  if (filters.view !== 'all' && CAMPUS_EVENT_VIEWS.some((item) => item.value === filters.view)) {
    params.set('view', filters.view);
  }
  if (filters.page && filters.page > 1) params.set('page', String(Math.min(100, filters.page)));
  return params;
}

export function campusEventMatchesView(event: CampusEventTime, view: CampusEventView, now: number): boolean {
  if (view === 'all') return true;
  const phase = campusEventPhase(event, now);
  return view === 'past' ? phase === 'ended' || phase === 'started' : phase === view;
}

const EVENT_SOURCES: CampusEventSource[] = [
  'school-club-events',
  'school-events',
  'legacy-events',
];

export function isCampusEventSource(value: unknown): value is CampusEventSource {
  return typeof value === 'string' && EVENT_SOURCES.includes(value as CampusEventSource);
}

export function campusEventSourceLabel(source: CampusEventSource): string {
  if (source === 'school-club-events') return '社團活動資料';
  if (source === 'school-events') return '校園活動資料';
  return '其他活動資料';
}

export function campusEventKey(event: Pick<CampusEvent, 'source' | 'id'>): string {
  return `${event.source}:${event.id}`;
}

export function formatCampusEventDateTime(value: string | null | undefined): string {
  if (!value) return '時間未提供';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間未提供';
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCampusEventDate(value: string | null | undefined): string {
  if (!value) return '時間未提供';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間未提供';
  return date.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

export function campusEventMatchesSearch(event: CampusEvent, query: string): boolean {
  const terms = query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-TW')
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;
  const content = [
    event.title,
    event.description,
    event.location,
    event.organizer,
    campusEventSourceLabel(event.source),
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-TW');
  return terms.every((term) => content.includes(term));
}

function eventNavigationQuery(schoolSearch: string, filters?: CampusEventFilters): URLSearchParams {
  const params = new URLSearchParams(schoolSearch.startsWith('?') ? schoolSearch.slice(1) : schoolSearch);
  for (const key of [...params.keys()]) {
    if (!['school', 'schoolId', 'campus'].includes(key)) params.delete(key);
  }
  if (filters) campusEventFilterQuery(filters).forEach((value, key) => params.set(key, value));
  return params;
}

export function buildCampusEventListHref(schoolSearch: string, filters?: CampusEventFilters): string {
  const params = eventNavigationQuery(schoolSearch, filters);
  const query = params.toString();
  return query ? `/events?${query}` : '/events';
}

export function buildCampusEventDetailHref(
  eventId: string,
  source: CampusEventSource,
  schoolSearch: string,
  filters?: CampusEventFilters,
): string {
  const params = eventNavigationQuery(schoolSearch, filters);
  params.set('source', source);
  return `/events/${encodeURIComponent(eventId)}?${params.toString()}`;
}

export function buildCampusEventLoginHref(returnPath: string): string {
  return schoolLoginHref(returnPath);
}

export function campusEventRegistrationCountLabel(state: EventRegistrationState): string | null {
  if (state.count === null) return null;
  if (state.capacity != null) {
    return `本系統報名 ${state.count} / ${state.capacity} 人`;
  }
  return `本系統報名 ${state.count} 人`;
}

export function campusEventAvailabilityCopy(state: EventRegistrationState): string {
  return eventRegistrationLabel(state);
}

export function userFacingCampusEventError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  // Keep product Chinese copy; hide raw English / internal tokens.
  if (/[A-Za-z]{4,}/.test(message) && !/[\u4e00-\u9fff]/.test(message)) return fallback;
  return message;
}
