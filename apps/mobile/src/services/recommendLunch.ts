/**
 * 午餐／正餐推薦：排除飲料點心、主食優先排序（供 aiToolLayer、工具層共用）。
 */

export type LunchMenuRow = {
  id: string;
  name: string;
  price?: number;
  cafeteria?: string;
  category?: string;
  isPopular?: boolean;
};

const DRINK_DESSERT_SNACK =
  /飲料|手搖|奶茶|咖啡|茶飲|紅茶|綠茶|可樂|氣泡|果汁|冰沙|點心|甜點|蛋糕|布丁|冰淇淋|餅乾|小點|加購飲|杯飲/;

const MAIN_CATEGORY_HINT =
  /主食|便當|套餐|定食|麵|飯|湯麵|炒飯|燴飯|排餐|鍋物|火鍋|自助餐|蔬食|素食|早午餐|brunch|^main$|^set$|^soup$/i;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s｜|／/,，、\-—_()（）]/g, '');
}

/** 排除明顯飲料／甜點／點心類（依分類與品名） */
export function isLikelyNonMainMeal(row: LunchMenuRow): boolean {
  const cat = String(row.category ?? '').toLowerCase();
  const name = String(row.name ?? '');
  if (cat === 'beverage' || cat === 'dessert') return true;
  if (DRINK_DESSERT_SNACK.test(cat) || DRINK_DESSERT_SNACK.test(name)) return true;
  if (/飲料|甜點|點心|咖啡|茶|冷飲|熱飲/.test(cat) && !/餐|飯|麵|便當/.test(cat)) return true;
  return false;
}

export function filterMainMealCandidates(menus: LunchMenuRow[]): LunchMenuRow[] {
  const mains = menus.filter((m) => !isLikelyNonMainMeal(m));
  if (mains.length > 0) return mains;
  return [...menus];
}

function mainMealSortScore(row: LunchMenuRow, budgetCap?: number): number {
  let score = 0;
  const cat = String(row.category ?? '');
  const name = String(row.name ?? '');
  if (MAIN_CATEGORY_HINT.test(cat)) score += 40;
  if (row.isPopular) score += 25;
  const price = typeof row.price === 'number' ? row.price : 9999;
  if (typeof budgetCap === 'number' && Number.isFinite(budgetCap) && budgetCap > 0) {
    if (price <= budgetCap) score += 15;
    score -= Math.min(price, 500) * 0.02;
  } else {
    score -= price * 0.01;
  }
  score -= name.length * 0.05;
  return score;
}

export type RecommendLunchOptions = {
  budgetCap?: number;
  /** 預留：午／晚等，目前僅影響文案可擴充 */
  timeSlot?: 'lunch' | 'dinner' | 'breakfast';
  maxItems?: number;
  /** 飲食偏好：素食 / 低卡 / 不要再吃炸物等 */
  dietaryPreference?: 'vegetarian' | 'low_calorie' | 'no_fried' | 'high_protein' | null;
};

// ── 均衡飲食：把候選分成三類（主食、蛋白質、蔬菜），三選一輪流挑 ──
const PROTEIN_RE = /(雞|豬|牛|魚|蝦|海鮮|蛋|豆|tofu|chicken|beef|pork|fish|egg)/i;
const VEGGIE_RE = /(蔬|菜|沙拉|青菜|salad|veg|燙青菜|涼拌|花椰|高麗|地瓜葉)/;
const STARCH_RE = /(飯|麵|麵食|燴飯|炒飯|拉麵|義大利麵|pasta|rice|noodle|烏龍|河粉|湯麵|湯飯|蓋飯|便當)/i;
const FRIED_RE = /(炸|酥|tempura|fried|crispy)/i;

type MealCategory = 'starch' | 'protein' | 'veggie' | 'other';

function classifyMeal(row: LunchMenuRow): MealCategory {
  const name = String(row.name ?? '');
  if (VEGGIE_RE.test(name)) return 'veggie';
  if (STARCH_RE.test(name)) return 'starch';
  if (PROTEIN_RE.test(name)) return 'protein';
  return 'other';
}

function applyDietaryFilter(
  menus: LunchMenuRow[],
  pref: RecommendLunchOptions['dietaryPreference'],
): LunchMenuRow[] {
  if (!pref) return menus;
  return menus.filter((m) => {
    const name = String(m.name ?? '');
    const cat = String(m.category ?? '');
    if (pref === 'vegetarian') {
      if (/(素|蔬食|vegetarian|vegan|tofu|豆)/i.test(name) || /素|蔬食/.test(cat)) return true;
      if (/(雞|豬|牛|魚|蝦|海鮮|肉)/.test(name)) return false;
      return false;
    }
    if (pref === 'no_fried') return !FRIED_RE.test(name);
    if (pref === 'low_calorie') return !FRIED_RE.test(name) && !/起司|奶油|焗烤|cream/i.test(name);
    if (pref === 'high_protein') return PROTEIN_RE.test(name);
    return true;
  });
}

/**
 * 從菜單中挑出適合當正餐的候選並排序，並強制涵蓋「主食 + 蛋白質 + 蔬菜」三類。
 *
 * 規則（對應 wellbeing/recommend_lunch 守則）：
 * - 不要全炸：≤1 個炸物候選
 * - 三類盡量配齊：每個 category 至少各推 1 樣（若菜單裡有）
 * - 遵循使用者飲食偏好（素食 / 不要再推炸物 / 低卡 / 高蛋白）
 */
export function recommendLunchCandidates(
  menus: LunchMenuRow[],
  opts: RecommendLunchOptions = {},
): { items: LunchMenuRow[]; topPick: LunchMenuRow | undefined; coverage: Record<MealCategory, number> } {
  const maxItems = Math.min(Math.max(opts.maxItems ?? 3, 1), 8);
  const filtered = applyDietaryFilter(menus, opts.dietaryPreference);
  const pool = filterMainMealCandidates(filtered.length > 0 ? filtered : menus);

  const sorted = [...pool].sort(
    (a, b) => mainMealSortScore(b, opts.budgetCap) - mainMealSortScore(a, opts.budgetCap),
  );

  // 第一輪：依分類各取一個 → 確保配齊
  const buckets: Record<MealCategory, LunchMenuRow[]> = {
    starch: [],
    protein: [],
    veggie: [],
    other: [],
  };
  for (const r of sorted) buckets[classifyMeal(r)].push(r);

  const items: LunchMenuRow[] = [];
  const fryCount = () => items.filter((it) => FRIED_RE.test(String(it.name ?? ''))).length;

  // 優先順序：主食 → 蛋白 → 蔬菜（如果有的話）
  for (const cat of ['starch', 'protein', 'veggie'] as MealCategory[]) {
    const next = buckets[cat].shift();
    if (next && items.length < maxItems) {
      if (FRIED_RE.test(String(next.name ?? '')) && fryCount() >= 1) {
        // 已經有炸物，再從同類別找一個非炸物的
        const alt = buckets[cat].find((r) => !FRIED_RE.test(String(r.name ?? '')));
        if (alt) {
          items.push(alt);
          buckets[cat] = buckets[cat].filter((r) => r !== alt);
          continue;
        }
      }
      items.push(next);
    }
  }

  // 第二輪：補滿 maxItems，依分數，但維持「≤1 個炸物」
  const remaining = [...buckets.starch, ...buckets.protein, ...buckets.veggie, ...buckets.other];
  for (const r of remaining) {
    if (items.length >= maxItems) break;
    if (FRIED_RE.test(String(r.name ?? '')) && fryCount() >= 1) continue;
    if (!items.includes(r)) items.push(r);
  }

  const coverage: Record<MealCategory, number> = { starch: 0, protein: 0, veggie: 0, other: 0 };
  for (const it of items) coverage[classifyMeal(it)] += 1;

  return { items, topPick: items[0], coverage };
}

const BUDGET_RE = /預算\s*(\d{2,4})|(\d{2,4})\s*元(?:以內|以下)?|便宜.*(\d{2,4})/;

export function parseBudgetCapFromMessage(message: string): number | undefined {
  const m = message.match(BUDGET_RE);
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? m[3];
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function itemLine(m: LunchMenuRow, withIndex: boolean, index: number): string {
  const core = `${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`;
  return withIndex ? `${index}. ${core}` : core;
}

/** 使用者向：單品推薦 + 候選列表一句話 */
export function formatLunchRecommendationReply(
  items: LunchMenuRow[],
  opts?: { mealLabel?: string },
): string {
  const label = opts?.mealLabel ?? '午餐';
  if (items.length === 0) {
    return `我翻了你載入的菜單，暫時找不到適合當${label}的主食類品項（可能多為飲料或未分類）。要不要先到「校園 → 點餐」同步菜單，或換個說法（例如指定想吃的類型）？`;
  }
  const top = items[0];
  const rest = items.slice(1, 3);
  let body = `今天${label}幫你挑這道：${itemLine(top, false, 0)}`;
  if (rest.length > 0) {
    body += `\n\n其他主食候選：\n${rest.map((m, i) => itemLine(m, true, i + 1)).join('\n')}`;
  }
  body += '\n\n要我直接幫你下單的話，回「好，幫我點這個」或點下面選項；想換別種再說「換一個」。';
  return body;
}

/** 訊息是否在問「午／晚正餐吃什麼」（用於 dining_lookup 主食過濾） */
export function messageWantsMainMealRecommendation(message: string): boolean {
  const m = message.trim();
  if (/飲料|奶茶|咖啡|手搖|甜點|點心/.test(m)) return false;
  return /午餐|晚餐|早餐|今天中午|今晚吃|吃午飯|吃晚飯|正餐|吃什麼好|覓食/.test(m);
}
