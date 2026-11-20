import {
  getOfficialCampusMapUrl,
  PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL,
} from '@campus/shared/src/campusMapLookup';
import { NuniError } from '@campus/shared/src/nuni';
export const assistantIds = ['map', 'bus', 'cafeteria', 'pu-library'] as const;
export type AssistantIntent = (typeof assistantIds)[number];
export function assistantInput(action: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NuniError(422, 'INVALID_INPUT');
  const input = value as Record<string, unknown>;
  const keys =
    action === 'preview'
      ? ['schoolId', 'intent', 'question']
      : ['schoolId', 'intent', 'confirmation', 'consent'];
  if (
    Object.keys(input).some((k) => !keys.includes(k)) ||
    typeof input.schoolId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.schoolId) ||
    input.schoolId === 'personal' ||
    !getOfficialCampusMapUrl(input.schoolId)
  )
    throw new NuniError(422, 'INVALID_INPUT');
  if (action === 'preview' && input.question !== undefined) {
    if (
      typeof input.question !== 'string' ||
      input.question.length > 1000 ||
      input.intent !== undefined
    )
      throw new NuniError(422, 'INVALID_INPUT');
    const text = input.question;
    const intent = /蓋夏/.test(text)
      ? 'pu-library'
      : /圖書館|地圖|怎麼走/.test(text)
        ? 'map'
        : /公車|到站/.test(text)
          ? 'bus'
          : /餐廳|學餐/.test(text)
            ? 'cafeteria'
            : null;
    if (!intent || (intent === 'pu-library' && input.schoolId !== 'pu'))
      throw new NuniError(422, 'PUBLIC_SELECTION_REQUIRED');
    return { schoolId: input.schoolId, intent };
  }
  if (!assistantIds.includes(input.intent as AssistantIntent))
    throw new NuniError(422, 'PUBLIC_SELECTION_REQUIRED');
  if (input.intent === 'pu-library' && input.schoolId !== 'pu')
    throw new NuniError(422, 'PUBLIC_SELECTION_REQUIRED');
  if (
    action !== 'preview' &&
    (input.consent !== true ||
      typeof input.confirmation !== 'string' ||
      input.confirmation.length > 4096)
  )
    throw new NuniError(422, 'CONSENT_REQUIRED');
  return input;
}
export function projectAssistant(action: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NuniError(502, 'INVALID_RESPONSE');
  const v = value as Record<string, unknown>;
  if (action === 'capability') {
    if (v.enabled !== true || typeof v.ready !== 'boolean' || typeof v.simulation !== 'boolean')
      throw new NuniError(502, 'INVALID_RESPONSE');
    return { enabled: true, ready: v.ready, simulation: v.simulation };
  }
  if (
    !assistantIds.includes(v.intent as AssistantIntent) ||
    typeof v.schoolId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(v.schoolId)
  )
    throw new NuniError(502, 'INVALID_RESPONSE');
  const id = v.intent as AssistantIntent;
  const summaries = {
    'pu-library': '蓋夏圖書館的樓層與服務資訊請參考靜宜大學圖書館官方導覽。',
    map: '從校園地圖搜尋公開地點並查看位置。',
    bus: '從公車頁查看站點與到站資訊。',
    cafeteria: '從餐廳頁查看公開餐廳資訊。',
  };
  if (!getOfficialCampusMapUrl(v.schoolId) || (id === 'pu-library' && v.schoolId !== 'pu'))
    throw new NuniError(502, 'INVALID_RESPONSE');
  const base = { schoolId: v.schoolId, intent: id };
  if (action === 'route')
    return {
      ...base,
      href: `/${id === 'pu-library' ? 'map' : id}?schoolId=${encodeURIComponent(v.schoolId)}`,
      source:
        id === 'pu-library'
          ? PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL
          : id === 'map'
            ? getOfficialCampusMapUrl(v.schoolId)
            : null,
    };
  if (
    typeof v.confirmation !== 'string' ||
    v.confirmation.length > 4096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(v.confirmation) ||
    typeof v.simulation !== 'boolean'
  )
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    ...base,
    confirmation: v.confirmation,
    simulation: v.simulation,
    ...(action === 'preview' ? { summary: summaries[id] } : { answer: summaries[id] }),
  };
}
