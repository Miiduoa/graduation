/** 主導覽固定插入「訊息」Tab（在「我的」之前），不刪既有入口。 */
export const MESSAGE_TAB = {
  key: '訊息',
  label: '訊息',
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
