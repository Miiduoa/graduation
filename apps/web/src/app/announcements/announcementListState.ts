import {
  listPageNumber,
  listQueryValue,
  listSearchText,
  serviceListSchoolQuery,
  type ServiceListQuery,
} from '@/lib/serviceListNavigation';

export type AnnouncementListState = {
  search: string;
  category: 'all' | 'academic' | 'event' | 'general';
  view: 'student' | 'all';
  pinned: boolean;
  page: number;
};

export const ANNOUNCEMENT_PAGE_SIZE = 30;
export const ANNOUNCEMENT_LIST_QUERY_KEYS = ['q', 'category', 'view', 'pinned', 'page'] as const;

export function readAnnouncementListState(query?: ServiceListQuery): AnnouncementListState {
  const category = listQueryValue(query, 'category');
  return {
    search: listSearchText(listQueryValue(query, 'q')),
    category:
      category === 'academic' || category === 'event' || category === 'general' ? category : 'all',
    view: listQueryValue(query, 'view') === 'all' ? 'all' : 'student',
    pinned: listQueryValue(query, 'pinned') === '1',
    page: listPageNumber(listQueryValue(query, 'page')),
  };
}

export function announcementListQuery(
  schoolId: string,
  state: AnnouncementListState,
  scope?: ServiceListQuery,
): URLSearchParams {
  const query = serviceListSchoolQuery(schoolId, scope);
  if (state.search.trim()) query.set('q', listSearchText(state.search));
  if (state.category !== 'all') query.set('category', state.category);
  if (state.view !== 'student') query.set('view', state.view);
  if (state.pinned) query.set('pinned', '1');
  if (state.page > 1) query.set('page', String(state.page));
  return query;
}

export function announcementListHref(
  schoolId: string,
  state: AnnouncementListState,
  scope?: ServiceListQuery,
): string {
  return `/announcements?${announcementListQuery(schoolId, state, scope)}`;
}
