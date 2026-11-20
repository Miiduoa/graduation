import { getOfficialCampusMapUrl, PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL } from './sharedMapLookup';
import { createHash } from 'node:crypto';
export const catalog = [
  { id: 'map', label: '校園地圖', href: '/map', summary: '從校園地圖搜尋公開地點並查看位置。' },
  { id: 'bus', label: '公車資訊', href: '/bus', summary: '從公車頁查看站點與到站資訊。' },
  {
    id: 'pu-library',
    label: '蓋夏圖書館',
    href: '/map',
    summary: '蓋夏圖書館的樓層與服務資訊請參考靜宜大學圖書館官方導覽。',
  },
  { id: 'cafeteria', label: '餐廳資訊', href: '/cafeteria', summary: '從餐廳頁查看公開餐廳資訊。' },
] as const;
export type Intent = (typeof catalog)[number]['id'];
export const fingerprint = createHash('sha256')
  .update(JSON.stringify({ catalog, libraryGuide: PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL }))
  .digest('hex');
export function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new AssistantError('INVALID_INPUT', 422);
  return value as Record<string, unknown>;
}
export class AssistantError extends Error {
  constructor(
    public code: string,
    public statusCode = 503,
  ) {
    super(code);
  }
}
export function intent(value: unknown): Intent {
  if (!catalog.some((item) => item.id === value))
    throw new AssistantError('PUBLIC_SELECTION_REQUIRED', 422);
  return value as Intent;
}
export function school(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ||
    value === 'personal' ||
    !getOfficialCampusMapUrl(value)
  )
    throw new AssistantError('INVALID_INPUT', 422);
  return value;
}
export function ensureScope(id: Intent, schoolId: string) {
  if (id === 'pu-library' && schoolId !== 'pu')
    throw new AssistantError('PUBLIC_SELECTION_REQUIRED', 422);
}
export function parseQuestion(value: unknown): Intent {
  if (typeof value !== 'string' || value.length > 1000)
    throw new AssistantError('INVALID_INPUT', 422);
  if (/蓋夏/.test(value)) return 'pu-library';
  if (/圖書館|地圖|怎麼走/.test(value)) return 'map';
  if (/公車|到站/.test(value)) return 'bus';
  if (/餐廳|學餐/.test(value)) return 'cafeteria';
  throw new AssistantError('PUBLIC_SELECTION_REQUIRED', 422);
}
export function entry(id: Intent, schoolId: string) {
  const item = catalog.find((item) => item.id === id)!;
  ensureScope(id, schoolId);
  return {
    ...item,
    source:
      id === 'pu-library'
        ? PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL
        : id === 'map'
          ? getOfficialCampusMapUrl(schoolId)
          : null,
    href: item.href + '?schoolId=' + encodeURIComponent(schoolId),
  };
}
