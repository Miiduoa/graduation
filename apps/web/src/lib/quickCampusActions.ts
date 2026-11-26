import { suggestCampusDestinations, type CampusQuickDestination } from '@campus/shared/src/campusIntent';
import { assistantServiceHref, resolveAssistantServiceIntent, type AssistantServiceAudience, type AssistantServiceId } from '@campus/shared/src/assistantServices';
import { CAMPUS_SERVICES, type CampusService, presentCampusService, visibleCampusServices } from './campusServices';

type QuickCampusAction = Pick<CampusService, 'name' | 'text' | 'href' | 'access'> & {
  destination: string;
  serviceId?: AssistantServiceId;
};

export function resolveCampusActions(
  destinations: readonly CampusQuickDestination[],
  schoolLmsEnabled = false,
): QuickCampusAction[] {
  const services = visibleCampusServices(schoolLmsEnabled);
  return destinations.flatMap((destination) => {
    const href = destination === '/grades' ? '/grades?tab=semester' : destination;
    const service = services.find((item) => item.href === href);
    return service ? [{ ...presentCampusService(service), destination }] : [];
  });
}

/** Show shortcuts for known services only; no submission, payment or update is executed. */
export function getQuickCampusActions(
  input: string,
  schoolLmsEnabled = false,
  audience: AssistantServiceAudience = 'school',
): QuickCampusAction[] {
  const intent = resolveAssistantServiceIntent(input);
  if (intent?.kind === 'open') {
    const href = assistantServiceHref(intent.service.id, undefined, audience);
    if (!href) return [];
    const directoryService = CAMPUS_SERVICES.find((item) => item.href === href);
    if (directoryService && !visibleCampusServices(schoolLmsEnabled).some((item) => item.href === href)) return [];
    // The directory's /orders row is school-only; generic orders keep their account-aware identity.
    const existing = intent.service.id === 'orders'
      ? undefined
      : directoryService;
    return [{
      ...presentCampusService({
        name: existing?.name ?? intent.service.label,
        text: intent.service.summary,
        href,
        access: existing?.access ?? 'account',
      }),
      destination: href,
      serviceId: intent.service.id,
    }];
  }
  return resolveCampusActions(suggestCampusDestinations(input), schoolLmsEnabled);
}

export const QUICK_CAMPUS_EXAMPLES = [
  '今天要上什麼課？',
  '我要交作業',
  '公車什麼時候來？',
  '圖書館怎麼走？',
] as const;
