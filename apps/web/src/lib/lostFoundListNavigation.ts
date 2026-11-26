import { type LostFoundListFilters } from './lostFoundFilters';
import { NUNI_LOST_FOUND_CATEGORIES } from '@campus/shared/src/nuniLostFound';
import {
  listPageNumber,
  listQueryValue,
  listSearchText,
  serviceListSchoolQuery,
  type ServiceListQuery,
} from './serviceListNavigation';

export type LostFoundListState = LostFoundListFilters & { page: number };
export const LOST_FOUND_LIST_QUERY_KEYS = ['q', 'type', 'category', 'status', 'mine', 'page'] as const;

export function lostFoundListCategory(value: string) {
  return NUNI_LOST_FOUND_CATEGORIES.find((category) => category === value);
}

export function readLostFoundListState(query?: ServiceListQuery): LostFoundListState {
  const type = listQueryValue(query, 'type');
  const status = listQueryValue(query, 'status');
  const category = lostFoundListCategory(listQueryValue(query, 'category'));
  return {
    query: listSearchText(listQueryValue(query, 'q')),
    type: type === 'lost' || type === 'found' ? type : 'all',
    category,
    status: status === 'open' || status === 'resolved' ? status : 'all',
    mine: listQueryValue(query, 'mine') === '1',
    page: listPageNumber(listQueryValue(query, 'page')),
  };
}

export function lostFoundListQuery(
  schoolId: string,
  state: LostFoundListState,
  scope?: ServiceListQuery,
): URLSearchParams {
  const query = serviceListSchoolQuery(schoolId, scope);
  const schoolSource =
    scope instanceof URLSearchParams
      ? scope.getAll('source').includes('school')
      : Array.isArray(scope?.source)
        ? scope.source.includes('school')
        : scope?.source === 'school';
  if (schoolSource) query.set('source', 'school');
  if (state.query.trim()) query.set('q', listSearchText(state.query));
  if (state.type !== 'all') query.set('type', state.type);
  if (state.category) query.set('category', state.category);
  if (state.status !== 'all') query.set('status', state.status);
  if (state.mine) query.set('mine', '1');
  if (state.page > 1) query.set('page', String(state.page));
  return query;
}

export function lostFoundListHref(schoolId: string, source?: ServiceListQuery): string {
  return `/lost-found?${lostFoundListQuery(schoolId, readLostFoundListState(source), source)}`;
}
