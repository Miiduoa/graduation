import {
  assistantServiceHref,
  getAssistantService,
  type AssistantServiceId,
} from '@campus/shared/src/assistantServices';
import { isRouteRegistered, resolveTabForRoute, safeNavigate } from '../utils/safeNavigate';

export type AssistantServiceSelection = {
  kind: 'catalog' | 'open';
  serviceIds: AssistantServiceId[];
  importKind?: 'grades';
};
export type MobileAssistantAudience = 'campus' | 'platform' | 'guest';
type Navigation = Parameters<typeof safeNavigate>[0];
type NativeDestination = { kind: 'native'; route: string; params?: Record<string, unknown> };
type WebDestination = { kind: 'web'; url: string };
export type MobileAssistantDestination = NativeDestination | WebDestination;

const campusRouteOverrides: Partial<Record<AssistantServiceId, string>> = {
  attendance: 'CoursesHome',
};
const platformTabs: Partial<Record<AssistantServiceId, 'courses' | 'food' | 'merchant' | 'account'>> = {
  classroom: 'courses',
  attendance: 'courses',
  cafeteria: 'food',
  food: 'food',
  orders: 'food',
  merchant: 'merchant',
  account: 'account',
};
const platformPersonalRoutes: Partial<Record<AssistantServiceId, string>> = {
  timetable: 'PersonalTimetable', calendar: 'PersonalCalendar', import: 'PersonalImport',
};
const publicRoutes: Partial<Record<AssistantServiceId, readonly string[]>> = {
  map: ['MapV2', 'Map'],
  bus: ['BusV2', 'BusSchedule'],
};

function canNavigate(navigation: Navigation, route: string): boolean {
  if (!navigation?.navigate) return false;
  if (isRouteRegistered(navigation, route)) return true;
  const tab = resolveTabForRoute(route);
  // A globally known tab name is not evidence that this container has that tab.
  // In particular, public/platform navigation must never dispatch a school tab.
  return !!tab && isRouteRegistered(navigation, tab);
}

/** Re-resolve at click time; catalog metadata never grants a role or school access. */
export function mobileAssistantServiceDestination(
  serviceId: unknown,
  audience: MobileAssistantAudience,
  navigation: Navigation,
  importKind?: 'grades',
): MobileAssistantDestination | null {
  const service = getAssistantService(serviceId);
  if (!service) return null;
  const native = (route?: string, params?: Record<string, unknown>): NativeDestination | null =>
    route && canNavigate(navigation, route) ? { kind: 'native', route, ...(params && { params }) } : null;
  let target: NativeDestination | null = null;
  if (audience === 'campus') {
    target = native(campusRouteOverrides[service.id] ?? service.mobileRoute);
  } else if (audience === 'platform') {
    const tab = platformTabs[service.id];
    target = tab ? native('NuniWorkspace', { tab }) : native(platformPersonalRoutes[service.id]);
  } else if (service.id === 'account') {
    target = native('NuniWorkspace', { tab: 'account' });
  }
  if (!target && service.access === 'public') {
    for (const route of publicRoutes[service.id] ?? (service.mobileRoute ? [service.mobileRoute] : [])) {
      target = native(route);
      if (target) break;
    }
  }
  // Only fixed catalog links are used. No prompt text, session or identity is
  // placed in the URL; the website establishes its own account/school scope.
  if (target?.route === 'PersonalImport' && service.id === 'import' && importKind === 'grades')
    return { ...target, params: { kind: 'grades' } };
  if (target) return target;
  const href = assistantServiceHref(service.id, undefined, audience === 'platform' ? 'platform' : 'school');
  return href ? { kind: 'web', url: `https://nuni.tw${href}` } : null;
}

export function navigateMobileAssistantService(
  serviceId: unknown,
  audience: MobileAssistantAudience,
  navigation: Navigation,
  importKind?: 'grades',
): boolean {
  const destination = mobileAssistantServiceDestination(serviceId, audience, navigation, importKind);
  return destination?.kind === 'native'
    ? safeNavigate(navigation, destination.route, destination.params, { fallbackMessage: null })
    : false;
}
