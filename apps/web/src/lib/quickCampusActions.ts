import { suggestCampusDestinations } from '@campus/shared/src/campusIntent';
import { CAMPUS_SERVICES } from './campusServices';

export type QuickCampusAction = Pick<
  (typeof CAMPUS_SERVICES)[number],
  'name' | 'text' | 'href' | 'access'
>;

/** Show shortcuts for known services only; no submission, payment or update is executed. */
export function getQuickCampusActions(input: string): QuickCampusAction[] {
  return suggestCampusDestinations(input).flatMap((href) => {
    // The shared intent keeps the mobile grade destination; Web uses an explicit semester tab.
    const webHref = href === '/grades' ? '/grades?tab=semester' : href;
    const service = CAMPUS_SERVICES.find((item) => item.href === webHref);
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
