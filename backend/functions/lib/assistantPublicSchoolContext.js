'use strict';

/**
 * Server-owned public school identity for assistant web/route/weather fallbacks.
 * Labels come from the announcements catalog; weather coordinates are only the
 * localities already verified in assistantAgent (no newly invented campus coords).
 * Short aliases mirror packages/shared/src/schools.ts for the same schoolIds.
 */

const { SCHOOLS, schoolConfig } = require('../campusAnnouncements/catalog');

const SCHOOL_ID_ALIASES = Object.freeze({
  'tw-pu': 'pu',
});

/**
 * shortName + aliases from packages/shared/src/schools.ts for catalog schoolIds.
 * Used only to detect explicit school mentions in user text — not as authority claims.
 */
const SHARED_SCHOOL_SHORT_ALIASES = Object.freeze({
  'tw-nchu': Object.freeze(['中興', '中興大學']),
  ntu: Object.freeze(['台大', '臺大', '台灣大學', '臺灣大學']),
  nthu: Object.freeze(['清大']),
  ncku: Object.freeze(['成大']),
  nycu: Object.freeze(['陽交大', '交大', '陽明交通']),
  ncu: Object.freeze(['中央']),
  nsysu: Object.freeze(['中山']),
  ntnu: Object.freeze(['台師大', '臺師大']),
  ntust: Object.freeze(['台科大', '臺科大']),
  nccu: Object.freeze(['政大']),
  ncyu: Object.freeze(['嘉大']),
  ncue: Object.freeze(['彰師大']),
  ntpu: Object.freeze(['北大']),
  tmu: Object.freeze(['北醫']),
  fju: Object.freeze(['輔大']),
  thu: Object.freeze(['東海']),
  cgu: Object.freeze(['長庚']),
  cycu: Object.freeze(['中原']),
  pu: Object.freeze(['靜宜', '静宜']),
  scu: Object.freeze(['東吳']),
  ntub: Object.freeze(['北商']),
});

/** Existing verified weather localities (coordinates already used by assistantAgent). */
const VERIFIED_WEATHER_LOCALITIES = Object.freeze([
  Object.freeze({
    id: 'pu-shalu',
    match: /靜宜|静宜|沙鹿|providence/i,
    name: '台中市沙鹿區靜宜大學',
    latitude: 24.226,
    longitude: 120.563,
    schoolIds: Object.freeze(['pu']),
  }),
  Object.freeze({
    id: 'taichung-city',
    match: /台中|臺中/,
    name: '台中市',
    latitude: 24.1477,
    longitude: 120.6736,
    schoolIds: Object.freeze([]),
  }),
]);

const SCHOOL_DEFAULT_WEATHER = Object.freeze({
  pu: VERIFIED_WEATHER_LOCALITIES[0],
});

/**
 * Conversational weather fillers (longer phrases first). After removal, any leftover
 * content is treated as location-bearing and must not fall through to a school default.
 */
const WEATHER_CONVERSATIONAL_FILLERS = Object.freeze([
  '會不會',
  '要不要',
  '該不該',
  '是不是',
  '有沒有',
  '怎麼樣',
  '怎樣樣',
  '查一下',
  '告訴我',
  '我想知道',
  '想知道',
  '可以嗎',
  '好不好',
  '還好嗎',
  '今天',
  '明天',
  '後天',
  '昨天',
  '現在',
  '目前',
  '今晚',
  '早上',
  '中午',
  '下午',
  '晚上',
  '近期',
  '請問',
  '幫我',
  '麻煩',
  '搜尋',
  '查詢',
  '查查',
  '一下',
  '需要',
  '應該',
  '大概',
  '可能',
  '好像',
  '如何',
  '怎樣',
  '怎麼',
  '即時',
  '天氣',
  '氣溫',
  '天候',
  '下雨',
  '帶傘',
  '雨具',
  'weather',
  'temperature',
  'rain',
  'umbrella',
  'today',
  'tomorrow',
  '嗎',
  '呢',
  '啊',
  '喔',
  '呀',
  '唄',
  '啦',
  '吧',
  '嘛',
  '了',
  '的',
  '在',
  '裡',
  '内',
  '內',
  '查',
  '雨',
  '傘',
  '會',
  '要',
]);

const WEATHER_CONVERSATIONAL_FILLER_RE = new RegExp(
  WEATHER_CONVERSATIONAL_FILLERS.map((item) =>
    item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|'),
  'gi',
);

const SCHOOL_TOPIC_RE =
  /校園|學校|校內|選課|校規|宿舍|圖書館|公告|請假|學務|教務|註冊|畢業|系所|校車|校門|食堂|餐廳|社團|活動|課程|學分|成績|行事曆|公車|導航|怎麼去|天氣/;

function canonicalizeSchoolId(schoolId) {
  const raw = String(schoolId ?? '').trim();
  if (!raw) return null;
  return SCHOOL_ID_ALIASES[raw] || raw;
}

function resolvePublicSchoolRecord(schoolId) {
  const canonical = canonicalizeSchoolId(schoolId);
  if (!canonical) return null;
  const entry = schoolConfig(canonical);
  if (!entry || !entry.name) return null;
  return {
    schoolId: entry.schoolId,
    name: entry.name,
    weatherLocation: SCHOOL_DEFAULT_WEATHER[entry.schoolId] || null,
  };
}

function addScriptVariants(token, into) {
  const value = String(token || '').trim();
  if (!value || value.length < 2) return;
  into.add(value);
  into.add(value.replace(/臺/g, '台'));
  into.add(value.replace(/台/g, '臺'));
}

function mentionTokensForSchool(entry) {
  const tokens = new Set();
  const rawName = String(entry.name || '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  addScriptVariants(rawName, tokens);
  addScriptVariants(rawName.replace(/^國立/, ''), tokens);
  for (const alias of SHARED_SCHOOL_SHORT_ALIASES[entry.schoolId] || []) {
    addScriptVariants(alias, tokens);
  }
  return [...tokens].filter(Boolean).sort((a, b) => b.length - a.length);
}

let cachedSchoolMentionIndex = null;

function getSchoolMentionIndex() {
  if (cachedSchoolMentionIndex) return cachedSchoolMentionIndex;
  cachedSchoolMentionIndex = (SCHOOLS || [])
    .filter((entry) => entry?.schoolId && entry?.name && entry.demo !== true)
    .map((entry) => ({
      schoolId: entry.schoolId,
      name: entry.name,
      tokens: mentionTokensForSchool(entry),
    }));
  return cachedSchoolMentionIndex;
}

function findExplicitSchoolMentions(query) {
  const text = String(query ?? '');
  if (!text) return [];
  const hits = [];
  for (const school of getSchoolMentionIndex()) {
    const matched = school.tokens.find((token) => token.length >= 2 && text.includes(token));
    if (matched) hits.push({ schoolId: school.schoolId, name: school.name, matched });
  }
  return hits;
}

function findVerifiedWeatherLocality(query) {
  const text = String(query ?? '');
  for (const locality of VERIFIED_WEATHER_LOCALITIES) {
    if (locality.match.test(text)) return locality;
  }
  return null;
}

/**
 * Strip weather/conversation fillers. Any remaining letters/numbers are treated as
 * location-bearing text (unknown city, district, etc.) — never as school default.
 */
function extractWeatherLocationResidue(query) {
  const cleaned = String(query ?? '')
    .replace(WEATHER_CONVERSATIONAL_FILLER_RE, ' ')
    .replace(/[？?。！!，,、．.：:；;（）()【】[\]「」『』\s]+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned.replace(/\s+/g, ' ');
}

function weatherUnavailableMessage({ reason, placeLabel, school } = {}) {
  if (reason === 'unknown_locality') {
    const place = placeLabel ? `「${placeLabel}」` : '這個地點';
    return [
      `目前無法查${place}的即時天氣。`,
      '請改成具體地點再問（例如「台中天氣」），或直接查看中央氣象署／氣象 APP。',
    ].join('');
  }

  const selected = school?.name ? `你目前選擇的是${school.name}，` : '';
  return [
    `${selected}目前還不能依所選學校自動查天氣。`,
    '請告訴我要查哪個地點（例如「台中天氣」），或直接查看中央氣象署／氣象 APP。',
  ].join('');
}

/**
 * Selected-school weather default only for clearly location-free conversational queries.
 * Any unparsed location-bearing residue returns unavailable — never PU/ShaLu by accident.
 * @returns {{ location: object } | { unavailable: true, reason: string, message: string }}
 */
function resolveWeatherLocation({ query, schoolId } = {}) {
  const text = String(query ?? '');
  const school = resolvePublicSchoolRecord(schoolId);

  const verified = findVerifiedWeatherLocality(text);
  if (verified) {
    return {
      location: {
        name: verified.name,
        latitude: verified.latitude,
        longitude: verified.longitude,
      },
    };
  }

  const schoolHits = findExplicitSchoolMentions(text);
  const selectedSchoolHit = schoolHits.find((hit) => hit.schoolId === school?.schoolId);
  if (selectedSchoolHit && school?.weatherLocation) {
    const loc = school.weatherLocation;
    return { location: { name: loc.name, latitude: loc.latitude, longitude: loc.longitude } };
  }
  if (schoolHits.length > 0) {
    const label = schoolHits[0].matched || schoolHits[0].name;
    return {
      unavailable: true,
      reason: 'unknown_locality',
      message: weatherUnavailableMessage({ reason: 'unknown_locality', placeLabel: label, school }),
    };
  }

  const residue = extractWeatherLocationResidue(text);
  if (residue) {
    return {
      unavailable: true,
      reason: 'unknown_locality',
      message: weatherUnavailableMessage({
        reason: 'unknown_locality',
        placeLabel: residue,
        school,
      }),
    };
  }

  if (school?.weatherLocation) {
    const loc = school.weatherLocation;
    return { location: { name: loc.name, latitude: loc.latitude, longitude: loc.longitude } };
  }

  return {
    unavailable: true,
    reason: 'missing_location',
    message: weatherUnavailableMessage({ reason: 'missing_location', school }),
  };
}

/**
 * @returns {{ origin: string, source: 'explicit'|'school' } | { needsOrigin: true, schoolLabel: string|null }}
 */
function resolveRouteOrigin({ explicitOrigin, schoolId } = {}) {
  const explicit = String(explicitOrigin ?? '').trim();
  if (explicit) return { origin: explicit, source: 'explicit' };

  const school = resolvePublicSchoolRecord(schoolId);
  if (school?.name) return { origin: school.name, source: 'school' };

  return { needsOrigin: true, schoolLabel: null };
}

function isProvidenceOriginLabel(origin) {
  return /靜宜|静宜|providence/i.test(String(origin ?? ''));
}

function looksLikeSchoolTopicQuery(query) {
  return SCHOOL_TOPIC_RE.test(String(query ?? ''));
}

/**
 * Ground school-topic web searches with the verified selected-school label only when
 * the question does not already name another known school. Unrelated questions stay plain.
 */
function buildGroundedWebQuery(query, schoolId) {
  const q = String(query ?? '').trim();
  if (!q) return q;
  if (!looksLikeSchoolTopicQuery(q)) return q;

  // Any explicit known-school mention (this school or another) keeps the user's wording.
  if (findExplicitSchoolMentions(q).length > 0) return q;

  const selected = resolvePublicSchoolRecord(schoolId);
  if (!selected?.name) return q;
  return `${selected.name} ${q}`;
}

module.exports = {
  SCHOOL_ID_ALIASES,
  VERIFIED_WEATHER_LOCALITIES,
  canonicalizeSchoolId,
  resolvePublicSchoolRecord,
  resolveWeatherLocation,
  resolveRouteOrigin,
  isProvidenceOriginLabel,
  looksLikeSchoolTopicQuery,
  buildGroundedWebQuery,
  findVerifiedWeatherLocality,
  findExplicitSchoolMentions,
  extractWeatherLocationResidue,
};
