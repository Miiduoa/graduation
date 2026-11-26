import { readLifeFilters } from '@/app/life/lifeFilters';
import type { CampusIconName } from '@/components/CampusIcon';
import {
  presentCampusService,
  searchCampusServices,
  visibleCampusServices,
  type CampusService,
} from './campusServices';

export type ServiceJourney = 'life' | 'connect';

/** Only grouping lives here; names, access requirements and feature flags use the service catalog. */
export const SERVICE_JOURNEY_GROUPS = {
  life: [
    { id: 'travel', label: '出門與交通' },
    { id: 'daily', label: '吃飯與住宿' },
    { id: 'resources', label: '校園資源' },
  ],
  connect: [
    { id: 'topics', label: '看話題' },
    { id: 'people', label: '找人與聊天' },
    { id: 'updates', label: '公告與通知' },
  ],
} as const;

export type JourneyFilters = { query: string; group: string; publicOnly?: boolean };

export function isDirectlyAvailable(service: CampusService) {
  return service.access === 'public' || service.access === 'device';
}

export function serviceJourneyGroup(journey: ServiceJourney, service: CampusService): string {
  const href = service.parentHref || service.href;
  if (journey === 'life') {
    if (href === '/map' || href === '/bus') return 'travel';
    if (href === '/food' || href === '/dormitory') return 'daily';
    return 'resources';
  }
  if (href === '/social' || href === '/community') return 'topics';
  if (href === '/dms' || href === '/friends') return 'people';
  return 'updates';
}

export function journeyServices(
  journey: ServiceJourney,
  filters: JourneyFilters,
  schoolLmsEnabled = false,
) {
  const category = journey === 'life' ? 'campus' : 'connect';
  const candidates =
    filters.publicOnly && !filters.query.trim()
      ? visibleCampusServices(schoolLmsEnabled)
          .filter((service) => service.category === category)
          .map(presentCampusService)
      : searchCampusServices(filters.query, category, schoolLmsEnabled);
  const accessible = filters.publicOnly ? candidates.filter(isDirectlyAvailable) : candidates;
  // A public child such as the cafeteria remains reachable even when its
  // signed-in parent (ordering) is excluded by the visitor's filter.
  const availableParents = new Set(accessible.map((service) => service.href));
  return accessible
    .filter(
      (service) =>
        !filters.publicOnly ||
        filters.query.trim() ||
        !service.parentHref ||
        !availableParents.has(service.parentHref),
    )
    .filter(
      (service) =>
        filters.group === 'all' || serviceJourneyGroup(journey, service) === filters.group,
    );
}

export function readJourneyFilters(
  params: URLSearchParams,
  journey: ServiceJourney,
): JourneyFilters {
  const group = params.get('group');
  return {
    // Remove ASCII control characters from URL search terms.
    query:
      journey === 'life'
        ? readLifeFilters(params).query
        : (params.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100),
    group: SERVICE_JOURNEY_GROUPS[journey].some((item) => item.id === group) ? group! : 'all',
    ...((params.get('access') === 'public' ||
    (journey === 'life' && readLifeFilters(params).category === 'public'))
      ? { publicOnly: true }
      : {}),
  };
}

export function writeJourneyFilters(params: URLSearchParams, filters: JourneyFilters) {
  // Old life links keep working; subsequent edits use the shared directory schema.
  params.delete('category');
  if (filters.query) params.set('q', filters.query);
  else params.delete('q');
  if (filters.group === 'all') params.delete('group');
  else params.set('group', filters.group);
  if (filters.publicOnly) params.set('access', 'public');
  else params.delete('access');
}

const SERVICE_ICONS: Partial<Record<string, CampusIconName>> = {
  '/map': 'map',
  '/bus': 'bus',
  '/food': 'cafeteria',
  '/cafeteria': 'cafeteria',
  '/orders': 'orders',
  '/dormitory': 'repair',
  '/library': 'library',
  '/school-info': 'services',
  '/career': 'calendar',
  '/lost-found': 'lost-found',
  '/events': 'calendar',
  '/clubs': 'people',
  '/social': 'social',
  '/community': 'community',
  '/dms': 'community',
  '/friends': 'friends',
  '/announcements': 'announcements',
  '/messages': 'announcements',
};

export function serviceJourneyIcon(href: string): CampusIconName {
  return SERVICE_ICONS[href] || 'services';
}
