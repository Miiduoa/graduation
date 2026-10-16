import type { CafeteriaCatalogRecord } from './cafeteriaCatalog';

const PENDING = '待補';

type PublicDiningVenue = {
  slug: string;
  schoolId: 'ncku' | 'ntpu';
  name: string;
  location: string;
  openingHours: string;
  intro: string;
  websiteUrl: string;
  sourceLabel: string;
};

const NCKU_HOUSING_SOURCE = {
  label: '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
  url: 'https://housing-osa.ncku.edu.tw/p/412-1052-4084.php',
};

const NCKU_HOURS_SOURCE = {
  label: '國立成功大學學生宿舍餐廳顧客資訊網',
  url: 'https://sites.google.com/view/ncku-cafeteria',
};

const NTPU_GOURMET_HOME = {
  label: '國立臺北大學總務處事務組｜饗樂北大',
  url: 'https://life.ntpu.edu.tw/',
};

const VENUES: readonly PublicDiningVenue[] = [
  {
    slug: 'kuangfu',
    schoolId: 'ncku',
    name: '光復餐廳',
    location: '光復校區光二舍地下一樓',
    openingHours: PENDING,
    intro: '學生宿舍餐廳。得標廠商為周氏蝦捲有限公司。營業時間見住宿服務組公告的顧客資訊網。',
    websiteUrl: NCKU_HOURS_SOURCE.url,
    sourceLabel: `${NCKU_HOUSING_SOURCE.label}；營業時間見 ${NCKU_HOURS_SOURCE.label}`,
  },
  {
    slug: 'chingyeh',
    schoolId: 'ncku',
    name: '敬業餐廳',
    location: '敬業校區敬一舍地下一樓',
    openingHours: PENDING,
    intro: '學生宿舍餐廳。得標廠商為晨露朝食坊。營業時間見住宿服務組公告的顧客資訊網。',
    websiteUrl: NCKU_HOURS_SOURCE.url,
    sourceLabel: `${NCKU_HOUSING_SOURCE.label}；營業時間見 ${NCKU_HOURS_SOURCE.label}`,
  },
  {
    slug: 'yunping-cafe',
    schoolId: 'ncku',
    name: '雲平咖啡',
    location: '光復校區雲平大樓 1 樓',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'ncku-hall-mall',
    schoolId: 'ncku',
    name: '成大會館 BOT 附設商場',
    location: '勝利校區成大會館',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。櫃位與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'med-4f',
    schoolId: 'ncku',
    name: '醫學院 4 樓簡易餐廳',
    location: '成杏校區醫學院 4 樓',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'youyang',
    schoolId: 'ncku',
    name: '優氧食光',
    location: '生醫卓群大樓 1 樓',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'chimei-mall',
    schoolId: 'ncku',
    name: '奇美樓 1 樓附設商場',
    location: '自強校區奇美樓 1 樓',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。櫃位與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'shinyuan',
    schoolId: 'ncku',
    name: '新園春室',
    location: '成功校區',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'hospital-mall',
    schoolId: 'ncku',
    name: '成大醫學院附設醫院地下商場',
    location: '成大醫學院附設醫院地下商場',
    openingHours: PENDING,
    intro: '校內其他餐飲資訊所列據點。櫃位與營業時間待補。',
    websiteUrl: NCKU_HOUSING_SOURCE.url,
    sourceLabel: NCKU_HOUSING_SOURCE.label,
  },
  {
    slug: 'youmi',
    schoolId: 'ntpu',
    name: '優米自助餐',
    location: '三峽校區心湖會館 1F（A 區）',
    openingHours: '週一至週五 10:30–14:00、16:30–19:30；週日 10:30–14:00；週六公休',
    intro: '自助餐、團體便當。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet/3_6/1',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜美食 A 區`,
  },
  {
    slug: 'bozhi',
    schoolId: 'ntpu',
    name: '波之家石鍋料理',
    location: '三峽校區心湖會館 1F（A 區）',
    openingHours: '週一至週五 11:00–19:00；週日 11:00–14:00；週六公休',
    intro: '韓式石鍋料理。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet/3_6/1',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜美食 A 區`,
  },
  {
    slug: 'thaile',
    schoolId: 'ntpu',
    name: 'Thai Le 泰料',
    location: '三峽校區心湖會館 1F（A 區）',
    openingHours: '週一至週五 11:00–19:00；週日 11:00–14:00；週六公休',
    intro: '泰式料理。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet/3_6/1',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜美食 A 區`,
  },
  {
    slug: '24ratio',
    schoolId: 'ntpu',
    name: '24 個比例手搖飲／輕食',
    location: '三峽校區心湖會館 1F（A 區）',
    openingHours: '週一至週五 10:00–19:00；週日 10:30–17:30；週六公休',
    intro: '手搖飲、輕食小點。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet/3_6/1',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜美食 A 區`,
  },
  {
    slug: 'chubao',
    schoolId: 'ntpu',
    name: '初飽快餐',
    location: '三峽校區心湖會館 1F（B 區）',
    openingHours: '週一至週五 11:00–19:00；週日 11:00–14:00；週六公休',
    intro: '中式快餐。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet_detail/63',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜初飽快餐`,
  },
  {
    slug: 'ahua',
    schoolId: 'ntpu',
    name: 'A 華加湯滷味',
    location: '三峽校區心湖會館 1F（B 區）',
    openingHours: '週一至週五 10:30–19:30；週日 11:30–14:30；週六公休',
    intro: '滷味。特色餐點含藥燉鴨血、招牌滷蘿蔔。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet_detail/44',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜A華加湯滷味`,
  },
  {
    slug: 'chuqing',
    schoolId: 'ntpu',
    name: '初晴食堂',
    location: '三峽校區心湖會館 1F（B 區）',
    openingHours: '週一至週五 11:00–19:00；週日 10:00–14:00；週六公休',
    intro: '日式咖哩飯、丼飯。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet_detail/78',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜初晴食堂`,
  },
  {
    slug: 'papershoot',
    schoolId: 'ntpu',
    name: 'PaperShoot Café',
    location: '三峽校區心湖會館 2F',
    openingHours: '週三至週一 10:30–18:00；週二公休',
    intro: '輕食、甜點、咖啡飲品。',
    websiteUrl: 'https://life.ntpu.edu.tw/gourmet_detail/37',
    sourceLabel: `${NTPU_GOURMET_HOME.label}｜PaperShoot Café`,
  },
];

export const PUBLIC_DINING_SOURCES = {
  ncku: [NCKU_HOUSING_SOURCE, NCKU_HOURS_SOURCE],
  ntpu: [NTPU_GOURMET_HOME],
} as const;

export function publicDiningCafeteriaId(schoolId: string, slug: string): string {
  return `${schoolId}-${slug}`;
}

export function publicDiningCafeterias(schoolId: string): CafeteriaCatalogRecord[] {
  return VENUES.filter((venue) => venue.schoolId === schoolId).map((venue) => ({
    id: publicDiningCafeteriaId(venue.schoolId, venue.slug),
    name: venue.name,
    schoolId: venue.schoolId,
    location: venue.location,
    openingHours: venue.openingHours,
    intro: venue.intro,
    websiteUrl: venue.websiteUrl,
    merchantMode: 'info_only',
    sourceLabel: venue.sourceLabel,
    reviewStatus: 'unverified',
  }));
}

export function hasPublicDiningFallback(schoolId: string): boolean {
  return publicDiningCafeterias(schoolId).length > 0;
}
