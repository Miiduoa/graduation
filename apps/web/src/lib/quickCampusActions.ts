import { suggestCampusDestinations } from '@campus/shared/src/campusIntent';
import { CAMPUS_SERVICES, visibleCampusServices } from './campusServices';

export type QuickCampusAction = Pick<
  (typeof CAMPUS_SERVICES)[number],
  'name' | 'text' | 'href' | 'access'
>;

/** Show shortcuts for known services only; no submission, payment or update is executed. */
export function getQuickCampusActions(input: string, schoolLmsEnabled = false): QuickCampusAction[] {
  return suggestCampusDestinations(input).flatMap((href) => {
    const service = visibleCampusServices(schoolLmsEnabled).find((item) => item.href === href);
    return service
      ? [{ name: service.name, text: service.text, href: service.href, access: service.access }]
      : [];
  });
}

export const QUICK_CAMPUS_EXAMPLES = [
  '今天要上什麼課？',
  '我要交作業',
  '公車什麼時候來？',
  '圖書館怎麼走？',
] as const;
