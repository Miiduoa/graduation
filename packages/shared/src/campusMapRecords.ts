export type CampusMapRecord = {
  id: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
  building?: string;
  floor?: string;
  facilities: string[];
};

const CATEGORY_LABELS: Record<string, string> = {
  academic: '教學',
  building: '大樓',
  research: '研究',
  lab: '實驗室',
  library: '圖書館',
  admin: '行政',
  office: '行政',
  cafeteria: '餐飲',
  food: '餐飲',
  dormitory: '住宿',
  sports: '運動',
  parking: '停車',
  convenience: '生活',
  medical: '健康',
  religious: '宗教',
  gate: '交通',
  other: '其他',
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const LEGACY_SEED_LOCATIONS = [
  { number: 1, name: '工程館', lat: 24.1234, lng: 120.789 },
  { number: 2, name: '圖書館', lat: 24.124, lng: 120.7885 },
  { number: 3, name: '學生餐廳', lat: 24.122, lng: 120.79 },
] as const;

/** Historical demo seed documents had no flag; match the exact known fixture. */
function isLegacySeedPlace(
  schoolId: string,
  id: string,
  name: string,
  coordinate: { lat: number; lng: number },
): boolean {
  if (schoolId !== 'tw-nchu' && schoolId !== 'tw-demo-uni') return false;
  return LEGACY_SEED_LOCATIONS.some(
    (fixture) =>
      id === `${schoolId}-poi-${fixture.number}` &&
      fixture.name === name &&
      fixture.lat === coordinate.lat &&
      fixture.lng === coordinate.lng,
  );
}

function getPosition(value: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = value.lat ?? value.latitude;
  const lng = value.lng ?? value.longitude;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  ) return null;
  return { lat, lng };
}

/** Parse locations published for one school without supplementing missing details. */
export function parseCampusMapRecord(
  id: string,
  raw: unknown,
  schoolId: string,
): CampusMapRecord | null {
  const data = asObject(raw);
  if (!data || !id || id.includes('/') || !schoolId || schoolId.includes('/')) return null;
  if (data.schoolId != null && data.schoolId !== schoolId)
    throw new Error('Invalid map school');

  const name = trimmedText(data.name);
  if (!name) return null;

  const hasTopLevelCoordinates = ['lat', 'lng', 'latitude', 'longitude'].some(
    (key) => Object.prototype.hasOwnProperty.call(data, key),
  );
  const source = hasTopLevelCoordinates
    ? data
    : asObject(data.location) ?? asObject(data.coordinates);
  const position = source ? getPosition(source) : null;
  if (!position) return null;
  if (data.isDemo === true || isLegacySeedPlace(schoolId, id, name, position)) return null;

  const category = trimmedText(data.category);
  const building = trimmedText(data.building) || undefined;
  const floor =
    typeof data.floor === 'number' && Number.isFinite(data.floor)
      ? String(data.floor)
      : trimmedText(data.floor) || undefined;
  const facilities = Array.isArray(data.facilities)
    ? [...new Set(data.facilities.map(trimmedText).filter(Boolean))]
    : [];

  return {
    id,
    name,
    category: CATEGORY_LABELS[category] ?? (category || '其他'),
    description: trimmedText(data.description),
    ...position,
    building,
    floor,
    facilities,
  };
}
