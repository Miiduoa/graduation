import type { CampusQuickDestination } from './campusIntent';

/** Public, read-only entry points. Web and native retain their own scoped routing. */
export const TODAY_SERVICE_SHORTCUTS = [
  { destination: '/map', label: '找教室', detail: '校園地圖' },
  { destination: '/bus', label: '查公車', detail: '路線與到站時間' },
  { destination: '/cafeteria', label: '找餐廳', detail: '菜單與營業資訊' },
  { destination: '/library', label: '查館藏', detail: '借閱與續借入口' },
] as const satisfies readonly {
  destination: CampusQuickDestination;
  label: string;
  detail: string;
}[];

export const TODAY_TIMETABLE_SETUP_DETAIL =
  '匯入課表截圖或檔案，下次打開就能查看上課時間與教室。';
