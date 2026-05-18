#!/usr/bin/env node
/* eslint-disable */
/**
 * 為 AI 代理點餐 demo 種 Firestore 資料：
 *   schools/{schoolId}/cafeterias/{cafeteriaId}            # 餐廳本體
 *   schools/{schoolId}/cafeterias/{cafeteriaId}/menuItems  # 菜單品項
 *
 * 用法：
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/seed-cafeterias.js
 *   或設 FIRESTORE_EMULATOR_HOST=localhost:8080 後執行
 *
 * 可選環境變數：
 *   SCHOOL_ID（預設 'pu'）
 *   GCLOUD_PROJECT / FIREBASE_PROJECT_ID
 */
'use strict';

const admin = require('firebase-admin');

const SCHOOL_ID = process.env.SCHOOL_ID || 'pu';
const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'campus-demo-3a869';

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
  init();
  const db = admin.firestore();
  console.log(`[seed] schoolId=${SCHOOL_ID} project=${PROJECT_ID}`);
  for (const c of CAFETERIAS) {
    await seedOne(db, c);
  }
  console.log('[seed] DONE.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[seed] FAILED:', e?.message || e);
  process.exit(1);
});
