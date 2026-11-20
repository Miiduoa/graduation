import { ASSISTANT_SERVICES } from '@campus/shared/src/assistantServices';
import {
  mobileAssistantServiceDestination,
  type MobileAssistantAudience,
  type MobileAssistantDestination,
} from './assistantServiceNavigation';

type Navigation = Parameters<typeof mobileAssistantServiceDestination>[2];

/** Only fixed service-catalog paths can become native or website destinations. */
export function campusRecommendationDestination(
  href: string,
  audience: MobileAssistantAudience,
  navigation: Navigation,
): MobileAssistantDestination | null {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return null;
  let parsed: URL;
  try {
    parsed = new URL(href, 'https://nuni.tw');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://nuni.tw' || parsed.hash) return null;
  if (
    Array.from(parsed.searchParams.keys()).some(
      (key) => !['campus', 'schoolId', 'kind'].includes(key),
    )
  )
    return null;
  const service = ASSISTANT_SERVICES.find((item) => item.href.split('?')[0] === parsed.pathname);
  if (!service) return null;
  const kind = parsed.searchParams.get('kind');
  if (kind && (service.id !== 'import' || !['timetable', 'grades', 'events'].includes(kind)))
    return null;
  const destination = mobileAssistantServiceDestination(
    service.id,
    audience,
    navigation,
    kind === 'grades' ? 'grades' : undefined,
  );
  if (!destination) return null;
  if (destination.kind === 'native') {
    return service.id === 'import' && kind && destination.route === 'PersonalImport'
      ? { ...destination, params: { ...destination.params, kind } }
      : destination;
  }
  const campus = parsed.searchParams.get('campus');
  const schoolId = parsed.searchParams.get('schoolId');
  const url = new URL(destination.url);
  if (campus) url.searchParams.set('campus', campus);
  if (schoolId) url.searchParams.set('schoolId', schoolId);
  if (service.id === 'import' && kind) url.searchParams.set('kind', kind);
  return { kind: 'web', url: url.toString() };
}
