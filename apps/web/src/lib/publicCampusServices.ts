export const publicCampusServices = [
  { href: '/map', title: '校園地圖', detail: '找教室與校園設施' },
  { href: '/bus', title: '公車資訊', detail: '路線與到站時間' },
  { href: '/announcements', title: '公開公告', detail: '學校發布的公開消息' },
  { href: '/cafeteria', title: '餐廳', detail: '菜單與營業資訊' },
  { href: '/library', title: '圖書館', detail: '館藏查詢與官方服務入口' },
] as const;

/** Browsing a school does not establish school identity or grant academic access. */
export function isPublicCampusPath(path: string): boolean {
  return (
    publicCampusServices.some((service) => service.href === path) ||
    /^\/announcements\/[^/]+$/.test(path)
  );
}
