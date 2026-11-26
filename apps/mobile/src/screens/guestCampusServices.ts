/** Guest destinations that can resume as soon as a browsing school is selected. */
export const guestCampusServices = [
  { route: 'Map', title: '校園地圖', icon: 'map' },
  { route: 'Library', title: '圖書館', icon: 'library' },
  { route: 'BusSchedule', title: '公車查詢', icon: 'bus' },
] as const;

export type GuestCampusService = (typeof guestCampusServices)[number]['route'];
