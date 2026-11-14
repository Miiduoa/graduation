import type { CampusIconName } from '@/components/CampusIcon';
import { searchCampusServices, type CampusService } from './campusServices';

export type ServiceJourney = 'life' | 'connect';

/** Only grouping lives here; names, access requirements and feature flags use the service catalog. */
export const SERVICE_JOURNEY_GROUPS = {
  life: [
    { id: 'travel', label: '出門與交通', description: '先找到地方，再安排怎麼過去。' },
    { id: 'daily', label: '吃飯與住宿', description: '餐點、取餐與宿舍日常。' },
    { id: 'resources', label: '校園資源', description: '查館藏、找活動與職涯資訊。' },
  ],
  connect: [
    { id: 'topics', label: '看話題', description: '校內動態與跨校公開交流。' },
    { id: 'people', label: '找人與聊天', description: '找到同學，接著聊。' },
    { id: 'updates', label: '公告與通知', description: '公開消息與寄給你的服務提醒。' },
  ],
} as const;

export type JourneyFilters = { query: string; group: string };

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
  return searchCampusServices(
    filters.query,
    journey === 'life' ? 'campus' : 'connect',
    schoolLmsEnabled,
  ).filter(
    (service) => filters.group === 'all' || serviceJourneyGroup(journey, service) === filters.group,
  );
}

export function readJourneyFilters(
  params: URLSearchParams,
  journey: ServiceJourney,
): JourneyFilters {
  const group = params.get('group');
  return {
    // eslint-disable-next-line no-control-regex -- Remove ASCII control characters from URL search terms.
    query: (params.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100),
    group: SERVICE_JOURNEY_GROUPS[journey].some((item) => item.id === group) ? group! : 'all',
  };
}

export function writeJourneyFilters(params: URLSearchParams, filters: JourneyFilters) {
  if (filters.query) params.set('q', filters.query);
  else params.delete('q');
  if (filters.group === 'all') params.delete('group');
  else params.set('group', filters.group);
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
