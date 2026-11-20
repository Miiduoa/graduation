import { PRIMARY_DESTINATIONS } from '@campus/shared/src/primaryDestinations';

const connect = PRIMARY_DESTINATIONS.find((destination) => destination.id === 'connect')!;

/** 「交流」沿用訊息 route key，讓既有深層連結與通知仍可開啟。 */
export const MESSAGE_TAB = {
  key: connect.mobileTab,
  label: connect.label,
  icon: 'ic_tab_messages' as const,
};

export function tabsWithMessages<T extends { key: string }>(
  tabs: T[],
): Array<T | typeof MESSAGE_TAB> {
  if (tabs.some((tab) => tab.key === MESSAGE_TAB.key)) return tabs;
  const meIndex = tabs.findIndex((tab) => tab.key === '我的');
  if (meIndex < 0) return [...tabs, MESSAGE_TAB];
  return [...tabs.slice(0, meIndex), MESSAGE_TAB, ...tabs.slice(meIndex)];
}
