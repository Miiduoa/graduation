#!/usr/bin/env node
/* eslint-disable */
/**
 * 為 AI 代理點餐 demo 種 Firestore 資料：
 *   schools/{schoolId}/cafeterias/{cafeteriaId}            # 餐廳本體
 *   schools/{schoolId}/cafeterias/{cafeteriaId}/menuItems  # 菜單品項
 *
 * 用法：
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/seed-cafeterias.js
 *   或 NODE_ENV=test 且專案是 demo- / test- / campus-demo- 的明確測試環境
 *
 * 偵測到正式庫（campus-one-tw、正式 DATABASE_URL、NODE_ENV=production、
 * 非本機模擬器）會直接停止。沒有繞過開關。
 *
 * 可選環境變數：
 *   SCHOOL_ID（預設 'pu'）
 *   GCLOUD_PROJECT / FIREBASE_PROJECT_ID
 */
'use strict';

const admin = require('firebase-admin');

const DEFAULT_TEST_PROJECT = 'campus-demo-3a869';
const PRODUCTION_PROJECTS = new Set(['campus-one-tw']);
const PROJECT_ENV_KEYS = [
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PROJECT',
];
const PRODUCTION_ENV_KEYS = ['NODE_ENV', 'APP_ENV', 'NEXT_PUBLIC_APP_ENV'];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listedProjectIds(env) {
  const ids = PROJECT_ENV_KEYS.map((key) => text(env[key])).filter(Boolean);
  return ids.length ? ids : [DEFAULT_TEST_PROJECT];
}

function resolveSeedProjectId(env = process.env) {
  return (
    text(env.GCLOUD_PROJECT) ||
    text(env.GOOGLE_CLOUD_PROJECT) ||
    text(env.FIREBASE_PROJECT_ID) ||
    text(env.FIREBASE_PROJECT) ||
    DEFAULT_TEST_PROJECT
  );
}

function isTestProjectId(projectId) {
  return /^(demo-|test-|campus-demo-)/.test(projectId);
}

function hostOf(value) {
  const raw = text(value);
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 1 ? raw.slice(1, end) : raw;
  }
  return raw.split('/')[0].split(':')[0];
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function databaseUrlIsLocal(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (!isLocalHost(url.hostname)) return false;
  const hostParam = url.searchParams.get('host');
  return !hostParam || isLocalHost(hostParam);
}

function refuse(reason) {
  throw new Error(`[seed] 拒絕寫入正式資料庫：${reason}。只允許本機模擬器或明確的測試環境。`);
}

function assertSafeCafeteriaSeedTarget(env = process.env) {
  for (const key of PRODUCTION_ENV_KEYS) {
    if (text(env[key]).toLowerCase() === 'production') {
      refuse(`${key}=production`);
    }
  }
  const projectIds = listedProjectIds(env);
  const productionProject = projectIds.find((id) => PRODUCTION_PROJECTS.has(id));
  if (productionProject) refuse(`Firebase 專案 ${productionProject}`);
  const databaseUrl = text(env.DATABASE_URL);
  if (databaseUrl && !databaseUrlIsLocal(databaseUrl)) {
    refuse('DATABASE_URL 指向正式或遠端資料庫');
  }
  const emulator = text(env.FIRESTORE_EMULATOR_HOST);
  if (emulator) {
    if (!isLocalHost(hostOf(emulator))) refuse(`模擬器位址不是本機（${emulator}）`);
    return;
  }
  const projectId = resolveSeedProjectId(env);
  if (text(env.NODE_ENV).toLowerCase() === 'test' && isTestProjectId(projectId)) return;
  refuse('沒有本機模擬器，也不是明確的測試環境');
}

const SCHOOL_ID = process.env.SCHOOL_ID || 'pu';

const NCKU_HOUSING_URL = 'https://housing-osa.ncku.edu.tw/p/412-1052-4084.php';
const NCKU_HOURS_URL = 'https://sites.google.com/view/ncku-cafeteria';

function publicDiningRow(schoolId, slug, name, location, openingHours, description, sourceLabel, sourceUrl) {
  return {
    id: `${schoolId}-${slug}`,
    name,
    description,
    location,
    openingHours,
    orderingEnabled: false,
    merchantMode: 'info_only',
    reviewStatus: 'unverified',
    sourceLabel,
    sourceUrl,
    websiteUrl: sourceUrl,
  };
}

const PUBLIC_DINING = {
  ncku: [
    publicDiningRow(
      'ncku',
      'kuangfu',
      '光復餐廳',
      '光復校區光二舍地下一樓',
      '待補',
      '學生宿舍餐廳。得標廠商為周氏蝦捲有限公司。營業時間見住宿服務組公告的顧客資訊網。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）；營業時間見國立成功大學學生宿舍餐廳顧客資訊網',
      NCKU_HOURS_URL,
    ),
    publicDiningRow(
      'ncku',
      'chingyeh',
      '敬業餐廳',
      '敬業校區敬一舍地下一樓',
      '待補',
      '學生宿舍餐廳。得標廠商為晨露朝食坊。營業時間見住宿服務組公告的顧客資訊網。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）；營業時間見國立成功大學學生宿舍餐廳顧客資訊網',
      NCKU_HOURS_URL,
    ),
    publicDiningRow(
      'ncku',
      'yunping-cafe',
      '雲平咖啡',
      '光復校區雲平大樓 1 樓',
      '待補',
      '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
    publicDiningRow(
      'ncku',
      'ncku-hall-mall',
      '成大會館 BOT 附設商場',
      '勝利校區成大會館',
      '待補',
      '校內其他餐飲資訊所列據點。櫃位與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
    publicDiningRow(
      'ncku',
      'med-4f',
      '醫學院 4 樓簡易餐廳',
      '成杏校區醫學院 4 樓',
      '待補',
      '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
    publicDiningRow(
      'ncku',
      'youyang',
      '優氧食光',
      '生醫卓群大樓 1 樓',
      '待補',
      '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
    publicDiningRow(
      'ncku',
      'chimei-mall',
      '奇美樓 1 樓附設商場',
      '自強校區奇美樓 1 樓',
      '待補',
      '校內其他餐飲資訊所列據點。櫃位與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
    publicDiningRow(
      'ncku',
      'shinyuan',
      '新園春室',
      '成功校區',
      '待補',
      '校內其他餐飲資訊所列據點。菜單與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
    publicDiningRow(
      'ncku',
      'hospital-mall',
      '成大醫學院附設醫院地下商場',
      '成大醫學院附設醫院地下商場',
      '待補',
      '校內其他餐飲資訊所列據點。櫃位與營業時間待補。',
      '國立成功大學住宿服務組｜學生宿舍餐廳（115.8.28 更新）',
      NCKU_HOUSING_URL,
    ),
  ],
  ntpu: [
    publicDiningRow(
      'ntpu',
      'youmi',
      '優米自助餐',
      '三峽校區心湖會館 1F（A 區）',
      '週一至週五 10:30–14:00、16:30–19:30；週日 10:30–14:00；週六公休',
      '自助餐、團體便當。',
      '國立臺北大學總務處事務組｜饗樂北大｜美食 A 區',
      'https://life.ntpu.edu.tw/gourmet/3_6/1',
    ),
    publicDiningRow(
      'ntpu',
      'bozhi',
      '波之家石鍋料理',
      '三峽校區心湖會館 1F（A 區）',
      '週一至週五 11:00–19:00；週日 11:00–14:00；週六公休',
      '韓式石鍋料理。',
      '國立臺北大學總務處事務組｜饗樂北大｜美食 A 區',
      'https://life.ntpu.edu.tw/gourmet/3_6/1',
    ),
    publicDiningRow(
      'ntpu',
      'thaile',
      'Thai Le 泰料',
      '三峽校區心湖會館 1F（A 區）',
      '週一至週五 11:00–19:00；週日 11:00–14:00；週六公休',
      '泰式料理。',
      '國立臺北大學總務處事務組｜饗樂北大｜美食 A 區',
      'https://life.ntpu.edu.tw/gourmet/3_6/1',
    ),
    publicDiningRow(
      'ntpu',
      '24ratio',
      '24 個比例手搖飲／輕食',
      '三峽校區心湖會館 1F（A 區）',
      '週一至週五 10:00–19:00；週日 10:30–17:30；週六公休',
      '手搖飲、輕食小點。',
      '國立臺北大學總務處事務組｜饗樂北大｜美食 A 區',
      'https://life.ntpu.edu.tw/gourmet/3_6/1',
    ),
    publicDiningRow(
      'ntpu',
      'chubao',
      '初飽快餐',
      '三峽校區心湖會館 1F（B 區）',
      '週一至週五 11:00–19:00；週日 11:00–14:00；週六公休',
      '中式快餐。',
      '國立臺北大學總務處事務組｜饗樂北大｜初飽快餐',
      'https://life.ntpu.edu.tw/gourmet_detail/63',
    ),
    publicDiningRow(
      'ntpu',
      'ahua',
      'A 華加湯滷味',
      '三峽校區心湖會館 1F（B 區）',
      '週一至週五 10:30–19:30；週日 11:30–14:30；週六公休',
      '滷味。特色餐點含藥燉鴨血、招牌滷蘿蔔。',
      '國立臺北大學總務處事務組｜饗樂北大｜A華加湯滷味',
      'https://life.ntpu.edu.tw/gourmet_detail/44',
    ),
    publicDiningRow(
      'ntpu',
      'chuqing',
      '初晴食堂',
      '三峽校區心湖會館 1F（B 區）',
      '週一至週五 11:00–19:00；週日 10:00–14:00；週六公休',
      '日式咖哩飯、丼飯。',
      '國立臺北大學總務處事務組｜饗樂北大｜初晴食堂',
      'https://life.ntpu.edu.tw/gourmet_detail/78',
    ),
    publicDiningRow(
      'ntpu',
      'papershoot',
      'PaperShoot Café',
      '三峽校區心湖會館 2F',
      '週三至週一 10:30–18:00；週二公休',
      '輕食、甜點、咖啡飲品。',
      '國立臺北大學總務處事務組｜饗樂北大｜PaperShoot Café',
      'https://life.ntpu.edu.tw/gourmet_detail/37',
    ),
  ],
};

function cafeteriasForSchool(schoolId) {
  if (schoolId === 'pu') return CAFETERIAS;
  return PUBLIC_DINING[schoolId] || [];
}
const PROJECT_ID = resolveSeedProjectId();

function init() {
  if (admin.apps.length > 0) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: PROJECT_ID });
    console.log(`[seed] Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ projectId: PROJECT_ID });
    console.log(`[seed] Using service account from GOOGLE_APPLICATION_CREDENTIALS for project ${PROJECT_ID}`);
  } else {
    console.error(
      '[seed] 需設定 GOOGLE_APPLICATION_CREDENTIALS（service account）或 FIRESTORE_EMULATOR_HOST（本地模擬器）',
    );
    process.exit(1);
  }
}

// 餐廳本體：欄位對應 backend tool listCafeterias / proposeOrder / createOrder
const CAFETERIAS = [
  {
    id: 'jingyuan',
    name: '靜園餐廳',
    description:
      '一樓至三樓共有 300 個座位，供應自助餐、麵食、滷味、蔬食、飲料、壽司、炸物等，校園內最大綜合餐廳。',
    poiId: 'pu-jingyuan',
    floors: '1F~3F',
    seats: 300,
    openTime: '07:00',
    closeTime: '19:00',
    orderingEnabled: true,
    reviewStatus: 'unverified',
    merchantId: 'jingyuan',
    features: ['自助餐', '壽司', '滷味', '炸物', '蔬食'],
  },
  {
    id: 'yiyuan',
    name: '宜園餐廳',
    description:
      '一樓至二樓共有 422 個座位，供應自助餐、簡餐、麵食、蔬食、飲料，座位數最多。',
    poiId: 'pu-yiyuan',
    floors: '1F~2F',
    seats: 422,
    openTime: '07:00',
    closeTime: '19:00',
    orderingEnabled: true,
    reviewStatus: 'unverified',
    merchantId: 'yiyuan',
    features: ['自助餐', '簡餐', '麵食', '蔬食'],
  },
  {
    id: 'zhishan',
    name: '至善美食廣場',
    description:
      '一樓至二樓共有 220 個座位，提供便利商店服務，並供應簡餐、麵食、滷味、飲料、水果、鬆餅等。',
    poiId: 'pu-zhishan',
    floors: '1F~2F',
    seats: 220,
    openTime: '07:30',
    closeTime: '20:00',
    orderingEnabled: true,
    reviewStatus: 'unverified',
    merchantId: 'zhishan',
    features: ['便利商店', '滷味', '水果', '鬆餅'],
  },
];

// 菜單：每家餐廳 8-12 項，含真實常見品項與合理價位
const MENU_ITEMS = {
  jingyuan: [
    { id: 'jy-buf-3菜', name: '三菜一飯', price: 55, category: '自助餐', description: '白飯＋自選三道菜', tags: ['自助餐', '主食'], available: true, stock: 80 },
    { id: 'jy-buf-4菜', name: '四菜一飯', price: 65, category: '自助餐', description: '白飯＋自選四道菜', tags: ['自助餐', '主食', '熱門'], available: true, stock: 80 },
    { id: 'jy-buf-5菜', name: '五菜一飯', price: 75, category: '自助餐', description: '白飯＋自選五道菜', tags: ['自助餐', '主食'], available: true, stock: 60 },
    { id: 'jy-soup', name: '加湯', price: 10, category: '湯品', description: '今日例湯（紫菜蛋花/味噌/玉米濃湯輪替）', tags: ['湯'], available: true, stock: 200 },
    { id: 'jy-egg', name: '滷蛋', price: 10, category: '配菜', description: '入味滷蛋一顆', tags: ['配菜'], available: true, stock: 150 },
    { id: 'jy-noodle-clear', name: '陽春麵', price: 35, category: '麵食', description: '清湯陽春麵附青菜', tags: ['麵食'], available: true, stock: 50 },
    { id: 'jy-noodle-beef', name: '紅燒牛肉麵', price: 85, category: '麵食', description: '熬煮牛肉湯頭', tags: ['麵食', '熱門'], available: true, stock: 30 },
    { id: 'jy-sushi-tuna', name: '鮪魚壽司（6貫）', price: 60, category: '壽司', description: '新鮮鮪魚壽司六貫', tags: ['壽司'], available: true, stock: 25 },
    { id: 'jy-fried-chicken', name: '炸雞排', price: 70, category: '炸物', description: '酥脆現炸雞排', tags: ['炸物', '熱門'], available: true, stock: 40 },
    { id: 'jy-fried-rice', name: '蛋炒飯', price: 60, category: '飯類', description: '香蔥蛋炒飯', tags: ['飯類'], available: true, stock: 50 },
    { id: 'jy-tea', name: '紅茶（大）', price: 20, category: '飲料', description: '無糖／半糖／全糖', tags: ['飲料'], available: true, stock: 100 },
    { id: 'jy-coffee', name: '美式咖啡', price: 35, category: '飲料', description: '中焙美式（冰/熱）', tags: ['飲料'], available: true, stock: 60 },
  ],
  yiyuan: [
    { id: 'yy-buf-3菜', name: '三菜一飯', price: 55, category: '自助餐', description: '白飯＋自選三道菜', tags: ['自助餐'], available: true, stock: 100 },
    { id: 'yy-buf-4菜', name: '四菜一飯', price: 65, category: '自助餐', description: '白飯＋自選四道菜', tags: ['自助餐', '熱門'], available: true, stock: 100 },
    { id: 'yy-set-pork', name: '排骨便當', price: 75, category: '簡餐', description: '酥炸排骨＋白飯＋三樣配菜', tags: ['簡餐', '熱門'], available: true, stock: 50 },
    { id: 'yy-set-chicken', name: '雞排飯', price: 75, category: '簡餐', description: '香酥雞排＋白飯＋配菜', tags: ['簡餐', '熱門'], available: true, stock: 60 },
    { id: 'yy-set-fish', name: '魚排飯', price: 80, category: '簡餐', description: '鱈魚排＋白飯＋配菜', tags: ['簡餐'], available: true, stock: 30 },
    { id: 'yy-dumpling-pork', name: '豬肉水餃（10顆）', price: 60, category: '麵食', description: '皮Q餡多', tags: ['麵食', '熱門'], available: true, stock: 80 },
    { id: 'yy-dumpling-veg', name: '韭菜水餃（10顆）', price: 60, category: '麵食', description: '素食可', tags: ['麵食', '素食'], available: true, stock: 50 },
    { id: 'yy-kbbq', name: '韓式燒肉飯', price: 95, category: '簡餐', description: '韓式烤豬五花＋泡菜＋白飯', tags: ['韓式', '熱門'], available: true, stock: 30 },
    { id: 'yy-bibimbap', name: '石鍋拌飯', price: 110, category: '韓式', description: '韓式蔬菜＋肉燥＋荷包蛋', tags: ['韓式'], available: true, stock: 25 },
    { id: 'yy-soup', name: '味噌湯', price: 15, category: '湯品', description: '味噌湯一碗', tags: ['湯'], available: true, stock: 100 },
    { id: 'yy-tea', name: '冬瓜茶（大）', price: 20, category: '飲料', description: '古早味冬瓜茶', tags: ['飲料'], available: true, stock: 80 },
  ],
  zhishan: [
    { id: 'zs-braised', name: '滷味拼盤（小）', price: 65, category: '滷味', description: '自選 4 樣滷味', tags: ['滷味'], available: true, stock: 40 },
    { id: 'zs-noodle-beef', name: '牛肉湯麵', price: 85, category: '麵食', description: '紅燒牛肉湯麵', tags: ['麵食', '熱門'], available: true, stock: 30 },
    { id: 'zs-toast-ham', name: '火腿起司吐司', price: 35, category: '早餐', description: '香烤吐司＋火腿＋起司', tags: ['早餐'], available: true, stock: 50 },
    { id: 'zs-toast-tuna', name: '鮪魚蛋吐司', price: 40, category: '早餐', description: '鮪魚＋荷包蛋＋吐司', tags: ['早餐', '熱門'], available: true, stock: 50 },
    { id: 'zs-waffle-cls', name: '原味鬆餅', price: 45, category: '甜點', description: '比利時鬆餅佐糖粉', tags: ['鬆餅'], available: true, stock: 40 },
    { id: 'zs-waffle-chc', name: '巧克力鬆餅', price: 55, category: '甜點', description: '鬆餅＋巧克力醬', tags: ['鬆餅', '熱門'], available: true, stock: 35 },
    { id: 'zs-fruit-cut', name: '綜合水果切盤', price: 50, category: '水果', description: '當季新鮮水果切盤', tags: ['水果', '健康'], available: true, stock: 30 },
    { id: 'zs-juice', name: '柳橙汁（大）', price: 35, category: '飲料', description: '現榨柳橙汁', tags: ['飲料'], available: true, stock: 50 },
    { id: 'zs-bubble', name: '珍珠奶茶（大）', price: 45, category: '飲料', description: '珍珠奶茶（無糖/半糖/全糖）', tags: ['飲料', '熱門'], available: true, stock: 80 },
    { id: 'zs-rice-bowl', name: '滷肉飯', price: 45, category: '飯類', description: '經典滷肉飯', tags: ['飯類', '熱門'], available: true, stock: 60 },
  ],
};

async function seedOne(db, cafeteria) {
  const cafRef = db.collection('schools').doc(SCHOOL_ID).collection('cafeterias').doc(cafeteria.id);
  const cafPayload = {
    ...cafeteria,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await cafRef.set(cafPayload, { merge: true });
  console.log(`[seed] ✔ cafeteria ${cafeteria.id} (${cafeteria.name})`);

  const items = MENU_ITEMS[cafeteria.id] || [];
  let count = 0;
  for (const item of items) {
    await cafRef.collection('menuItems').doc(item.id).set(
      {
        ...item,
        cafeteriaId: cafeteria.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    count++;
  }
  console.log(`[seed]   - ${count} menu items`);
}

async function main() {
  assertSafeCafeteriaSeedTarget(process.env);
  init();
  const db = admin.firestore();
  console.log(`[seed] schoolId=${SCHOOL_ID} project=${PROJECT_ID}`);
  const rows = cafeteriasForSchool(SCHOOL_ID);
  if (!rows.length) {
    throw new Error(`[seed] 沒有 ${SCHOOL_ID} 的餐廳種子資料`);
  }
  for (const c of rows) {
    await seedOne(db, c);
  }
  console.log('[seed] DONE.');
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[seed] FAILED:', e?.message || e);
    process.exit(1);
  });
}

module.exports = {
  assertSafeCafeteriaSeedTarget,
  resolveSeedProjectId,
  DEFAULT_TEST_PROJECT,
  cafeteriasForSchool,
};
