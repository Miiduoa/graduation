import { suggestCampusDestinations, type CampusQuickDestination } from '@campus/shared/src/campusIntent';
import { type CampusService, presentCampusService, visibleCampusServices } from './campusServices';

type QuickCampusAction = Pick<CampusService, 'name' | 'text' | 'href' | 'access'> & {
  destination: CampusQuickDestination;
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

export function getQuickCampusActions(input: string, schoolLmsEnabled = false) {
  return resolveCampusActions(suggestCampusDestinations(input), schoolLmsEnabled);
}

export const QUICK_CAMPUS_EXAMPLES = [
  '今天要上什麼課？',
  '我要交作業',
  '公車什麼時候來？',
  '圖書館怎麼走？',
] as const;
