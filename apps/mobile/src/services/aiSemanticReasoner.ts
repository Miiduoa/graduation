/**
 * AI Semantic Reasoner — 語意推理層
 * ═══════════════════════════════════════════════════════════════════════
 * 取代「regex 死板字串匹配」的中央語意理解模組。
 *
 * 把使用者訊息解析成「結構化語意框架（Semantic Frame）」：
 *   {
 *     intent: 'order_food',                  // 高層意圖
 *     slots: {
 *       meal_time: 'lunch',                  // 「午餐」→ 用餐時間（不是餐點名稱）
 *       item: null,                          // 沒指定具體餐點
 *       category: 'main',                    // 推斷主餐
 *       quantity: 1,
 *     },
 *     reference: { type: 'ordinal', index: 8, target: 'last_list' }, // 「第 8 個」
 *     constraints: { vegetarian: true, spicy: false, maxPrice: 100 },
 *     confidence: 0.92,
 *     needsClarification: false,
 *     clarificationPrompt: null,
 *   }
 *
 * 設計重點：
 *  - 概念性詞語（午餐/晚餐/早餐）解析成 *時段*，不是餐點
 *  - 位置引用（第 N 個）綁定 lastChoiceMenu，不是當餐點名
 *  - 限制詞（辣的、清淡、便宜）綁進 constraints
 *  - 不會的詞透過 aiActiveLearning 標記為 unknownConcept，下次更聰明
 *  - 結果欄位明確：handler 不需要再做字串匹配
 */

import type { AssistantChoiceMenu } from '../data';
import { recordUnknownConcept, lookupLearnedConcept } from './aiActiveLearning';

// ─── Public types ────────────────────────────────────────────────────

export type SemanticIntent =
  | 'order_food'
  | 'browse_menu'
  | 'order_status'
  | 'request_leave'
  | 'borrow_book'
  | 'reserve_seat'
  | 'navigate'
  | 'send_message'
  | 'set_reminder'
  | 'ask_info'
  | 'clarify'
  | 'unknown';

export type MealTime = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface SemanticReference {
  type: 'ordinal' | 'demonstrative' | 'confirmation' | 'antecedent';
  index?: number;
  /** raw text of the referent, e.g. 「第 8 個」 */
  rawText?: string;
  /** what list/menu it points to */
  target: 'last_list' | 'last_mentioned' | 'unknown';
}

export interface SemanticSlots {
  meal_time?: MealTime;
  /** Concrete item name if directly stated, otherwise null */
  item?: string | null;
  category?: 'main' | 'beverage' | 'dessert' | 'set' | 'side';
  quantity?: number;
  date?: string;
  time?: string;
  course?: string;
  location?: string;
  recipient?: string;
  topic?: string;
}

export interface SemanticConstraints {
  vegetarian?: boolean;
  spicy?: boolean | 'avoid';
  maxPrice?: number;
  minPrice?: number;
  warm?: boolean;
  cold?: boolean;
  quick?: boolean;
  /** 「隨便/你決定/都可以」— 讓 AI 自動挑一個 */
  autoPick?: boolean;
  /** 對某類過敏 */
  avoidAllergens?: string[];
}

export interface SemanticFrame {
  /** 原始輸入 */
  rawMessage: string;
  /** 主要意圖 */
  intent: SemanticIntent;
  /** 結構化插槽 */
  slots: SemanticSlots;
  /** 指代資訊（第 N 個、那個、剛剛那個） */
  reference: SemanticReference | null;
  /** 約束條件（口味、價格、過敏…） */
  constraints: SemanticConstraints;
  /** 信心 0-1 */
  confidence: number;
  /** 是否需要先問使用者再行動 */
  needsClarification: boolean;
  /** 如果 needsClarification，建議的反問 */
  clarificationPrompt: string | null;
  /** 不認識的詞（同時會被丟去 aiActiveLearning） */
  unknownTerms: string[];
  /** 來自學習過的概念解析（debug 用） */
  recognizedConcepts: Array<{ term: string; resolvedAs: string; source: 'builtin' | 'learned' }>;
}

export interface SemanticContext {
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastChoiceMenu?: AssistantChoiceMenu;
  /** 從學習系統來的偏好 — 影響預設值（如過敏、常去餐廳） */
  preferences?: {
    foodPreferences?: string[];
    allergens?: string[];
    preferredCafeteria?: string | null;
  };
}

// ─── Concept dictionary (built-in semantic knowledge) ─────────────────

const MEAL_TIME_TERMS: Record<string, MealTime> = {
  早餐: 'breakfast',
  早飯: 'breakfast',
  早點: 'breakfast',
  breakfast: 'breakfast',
  午餐: 'lunch',
  午飯: 'lunch',
  中餐: 'lunch',
  中飯: 'lunch',
  lunch: 'lunch',
  晚餐: 'dinner',
  晚飯: 'dinner',
  消夜: 'dinner',
  宵夜: 'dinner',
  dinner: 'dinner',
  下午茶: 'snack',
  點心: 'snack',
  零食: 'snack',
  snack: 'snack',
};

const CATEGORY_TERMS: Record<string, NonNullable<SemanticSlots['category']>> = {
  飲料: 'beverage',
  飲品: 'beverage',
  咖啡: 'beverage',
  茶: 'beverage',
  奶茶: 'beverage',
  果汁: 'beverage',
  甜點: 'dessert',
  蛋糕: 'dessert',
  冰: 'dessert',
  套餐: 'set',
  便當: 'set',
  正餐: 'main',
  主餐: 'main',
  小菜: 'side',
};

const VEGETARIAN_TERMS = ['素食', '吃素', '純素', '蛋奶素', '素的', '素一點', '要素', '改素'];
const SPICY_WANT_TERMS = ['辣', '辣的', '麻辣', '夠辣', '川'];
const SPICY_AVOID_TERMS = ['不辣', '別辣', '不要辣', '少辣', '怕辣'];
const WARM_TERMS = ['熱的', '熱湯', '暖一點', '溫的', '熱食'];
const COLD_TERMS = ['冷的', '冰的', '清涼'];
const QUICK_TERMS = ['快一點', '快好', '不要等', '很急', '馬上', '趕時間', '趕'];
// 「清淡」「不油」→ 對應 avoid 油炸/辣 + warm 偏好
const LIGHT_TERMS = ['清淡', '不油', '少油', '低脂', '健康一點', '清爽'];
// 「便宜」「省一點」→ 對應 maxPrice 預設 80
const CHEAP_TERMS = ['便宜', '省一點', '少花', '預算少', 'cp 值高', 'cp高', '經濟實惠'];
// 「不要 X」→ 對應 avoidAllergens / 排除類別
const AVOID_TERMS_PREFIX = /(?:不要|別給我|不吃|避開|怕|過敏|拒絕|不喜歡)\s*([\u4e00-\u9fa5A-Za-z]{1,8})/g;
const AUTO_PICK_TERMS = [
  '隨便',
  '你決定',
  '你選',
  '你幫我選',
  '都可以',
  '都好',
  '任意',
  '隨機',
  'whatever',
  '看你',
  '看著辦',
];

const FOOD_ORDER_VERBS =
  /(?:幫我[點訂]|我要[點訂吃]|想吃|想喝|來[一個份碗杯]|買[一個份]|訂[一個份碗]|點[一個份碗]|給我來?[一個份]?|隨便.*[點訂吃喝]|[點訂吃喝].*隨便|(?:搞|弄|整)(?:個|點|份)?(?:晚餐|午餐|早餐|宵夜|吃的|飯)|來份|整點吃的)/;
const BROWSE_VERBS = /(?:看.*菜單|看.*餐廳|有什麼.*吃|有什麼.*喝|哪[裡裏].*有.*吃|推薦.*吃|吃什麼|喝什麼)/;
const STATUS_VERBS = /(?:訂單.*狀態|我的訂單|查訂單|查.*訂|追蹤訂單)/;
const LEAVE_VERBS = /(?:請[假病事].*|幫我請假|請.*個假)/;

// ─── Helpers ─────────────────────────────────────────────────────────

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseOrdinalReference(msg: string): SemanticReference | null {
  // 完整版：第 N 個 / 第幾個 / 第N項 / 第N份
  let m = msg.match(/第\s*([一二兩三四五六七八九十\d]+)\s*[個份項道杯碗台位件]/);
  if (m) {
    const n = CHINESE_NUMBERS[m[1]] ?? parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) {
      return { type: 'ordinal', index: n, rawText: m[0], target: 'last_list' };
    }
  }
  // 沒帶量詞：第一 / 第二 / 第 3 …（單獨成句或在句首句尾）
  m = msg.match(/(?:^|\s|，|,)第\s*([一二兩三四五六七八九十\d]+)(?:\s|，|,|$|的)/);
  if (m) {
    const n = CHINESE_NUMBERS[m[1]] ?? parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) {
      return { type: 'ordinal', index: n, rawText: m[0], target: 'last_list' };
    }
  }
  // 整句僅是「第 N」「第一個」「第二」「第3」
  m = msg.trim().match(/^第\s*([一二兩三四五六七八九十\d]+)\s*[個份項道杯碗台位件]?$/);
  if (m) {
    const n = CHINESE_NUMBERS[m[1]] ?? parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) {
      return { type: 'ordinal', index: n, rawText: m[0], target: 'last_list' };
    }
  }
  // 「最後一個」「最後那個」
  if (/最後[一那]?個|最後一項|最後那個/.test(msg)) {
    return { type: 'ordinal', index: -1, rawText: '最後一個', target: 'last_list' };
  }
  // 整句是「最後」/「最末」
  if (/^(?:最後|最末)$/.test(msg.trim())) {
    return { type: 'ordinal', index: -1, rawText: msg, target: 'last_list' };
  }
  return null;
}

function parseDemonstrative(msg: string): SemanticReference | null {
  if (/就?(?:剛剛?|上面|前面)?那[一個]?個?啊?|就[是]?(?:那|這|它)啊?|對[，,]?\s*(?:就是)?(?:那|這|它)/.test(msg)) {
    return { type: 'demonstrative', target: 'last_mentioned', rawText: msg };
  }
  return null;
}

function parseConfirmation(msg: string): SemanticReference | null {
  if (/^(?:對|好[的啊]?|可以|沒問題|ok|OK|嗯|恩|是[的啊]?)\s*$/.test(msg.trim())) {
    return { type: 'confirmation', target: 'last_mentioned', rawText: msg };
  }
  return null;
}

function detectMealTime(
  msg: string,
  recognized: SemanticFrame['recognizedConcepts'],
): MealTime | undefined {
  for (const [term, mealTime] of Object.entries(MEAL_TIME_TERMS)) {
    if (msg.includes(term)) {
      recognized.push({ term, resolvedAs: `meal_time=${mealTime}`, source: 'builtin' });
      return mealTime;
    }
  }
  // 從時間推斷
  const hour = new Date().getHours();
  if (/現在|這時間|這個時候/.test(msg)) {
    if (hour < 10) return 'breakfast';
    if (hour < 14) return 'lunch';
    if (hour < 21) return 'dinner';
    return 'snack';
  }
  return undefined;
}

function detectCategory(
  msg: string,
  recognized: SemanticFrame['recognizedConcepts'],
): SemanticSlots['category'] | undefined {
  for (const [term, cat] of Object.entries(CATEGORY_TERMS)) {
    if (msg.includes(term)) {
      recognized.push({ term, resolvedAs: `category=${cat}`, source: 'builtin' });
      return cat;
    }
  }
  return undefined;
}

function detectQuantity(msg: string): number {
  const m = msg.match(/(\d+)\s*[碗份個杯盤道]/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  const cn = msg.match(/([一兩二三四五六七八九十])\s*[碗份個杯盤道]/);
  if (cn) return CHINESE_NUMBERS[cn[1]] ?? 1;
  return 1;
}

function detectConstraints(msg: string, prefs?: SemanticContext['preferences']): SemanticConstraints {
  const c: SemanticConstraints = {};
  if (VEGETARIAN_TERMS.some((t) => msg.includes(t))) c.vegetarian = true;
  if (SPICY_AVOID_TERMS.some((t) => msg.includes(t))) c.spicy = 'avoid';
  else if (SPICY_WANT_TERMS.some((t) => msg.includes(t))) c.spicy = true;
  if (WARM_TERMS.some((t) => msg.includes(t))) c.warm = true;
  if (COLD_TERMS.some((t) => msg.includes(t))) c.cold = true;
  if (QUICK_TERMS.some((t) => msg.includes(t))) c.quick = true;
  if (AUTO_PICK_TERMS.some((t) => msg.includes(t))) c.autoPick = true;
  // 「清淡」→ avoid 辣 + warm
  if (LIGHT_TERMS.some((t) => msg.includes(t))) {
    if (c.spicy === undefined) c.spicy = 'avoid';
    c.warm = c.warm ?? true;
  }
  // 「便宜」→ maxPrice = 80（學生預算）
  if (CHEAP_TERMS.some((t) => msg.includes(t))) {
    c.maxPrice = c.maxPrice ?? 80;
  }
  // 「不要 X」→ 收進 avoidAllergens（也用於排除類別）
  const avoidList: string[] = [];
  let m: RegExpExecArray | null;
  // 重新建立 regex 物件避免 lastIndex 共享
  const re = new RegExp(AVOID_TERMS_PREFIX.source, 'g');
  while ((m = re.exec(msg)) !== null) {
    if (m[1] && m[1].length >= 1) avoidList.push(m[1]);
  }
  if (avoidList.length > 0) {
    c.avoidAllergens = [...(c.avoidAllergens ?? []), ...avoidList];
  }

  // 價格上限
  const priceMatch = msg.match(/(\d+)\s*(?:元|塊|塊錢|nt)?\s*(?:以下|以內|內|左右)/);
  if (priceMatch) c.maxPrice = parseInt(priceMatch[1], 10);

  // 過敏（從學習偏好繼承）
  if (prefs?.allergens && prefs.allergens.length > 0) {
    c.avoidAllergens = [...prefs.allergens];
  }
  return c;
}

/** 在訊息中找出可能是「具體餐點名」的字串（不是時段、不是引用、不是限制詞） */
function extractConcreteItemName(
  msg: string,
  removedTerms: Set<string>,
): string | null {
  // 嘗試找 動詞 + 候選餐點名
  const m = msg.match(/(?:幫我[點訂]|我要[點訂吃]|想[吃喝]|來[一個份碗杯]?|買[一個份]?|訂[一個份碗]?|點[一個份碗]?|給我來?[一個份]?)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,15})/);
  let candidate = m?.[1]?.trim() ?? '';

  if (!candidate) return null;
  candidate = candidate.split(/但|但是|不過|可是/)[0]?.trim() ?? candidate;
  if (!candidate) return null;

  // 去除已被識別成 meal_time / category 的字
  for (const r of removedTerms) {
    candidate = candidate.replace(r, '').trim();
  }

  // 全是限制詞 → null
  const allKnownTerms = [
    ...Object.keys(MEAL_TIME_TERMS),
    ...Object.keys(CATEGORY_TERMS),
    ...VEGETARIAN_TERMS,
    ...SPICY_WANT_TERMS,
    ...SPICY_AVOID_TERMS,
    ...WARM_TERMS,
    ...COLD_TERMS,
    ...LIGHT_TERMS,
    ...CHEAP_TERMS,
    ...AUTO_PICK_TERMS,
  ];
  if (allKnownTerms.includes(candidate)) return null;

  // 純數字、純位置引用 → null
  if (/^第\s*[一二三四五六七八九十\d]+\s*[個份項道杯碗]?$/.test(candidate)) return null;
  if (/^\d+\s*[碗份個杯盤道]?$/.test(candidate)) return null;

  // 動詞 / 助詞殘留（被 constraint 詞拿掉後剩下的）→ null
  // e.g. 「想吃點清淡的」→ 移除「清淡」後 candidate 變「點的」應該視為無意義
  const meaninglessResidue = /^[點喝吃訂買看的了嗎呢吧啊呀喔哦]+$/;
  if (meaninglessResidue.test(candidate)) return null;

  // 先把「清淡 / 便宜 / 隨便」這類已知 constraint 字眼從 candidate 內部移除，再判斷殘留
  const allConstraintTerms = [
    ...VEGETARIAN_TERMS,
    ...SPICY_WANT_TERMS,
    ...SPICY_AVOID_TERMS,
    ...WARM_TERMS,
    ...COLD_TERMS,
    ...LIGHT_TERMS,
    ...CHEAP_TERMS,
    ...AUTO_PICK_TERMS,
    ...QUICK_TERMS,
  ];
  let inner = candidate;
  for (const t of allConstraintTerms) inner = inner.split(t).join('');
  // 再去掉動詞 / 助詞殘留
  inner = inner.replace(/[的了嗎呢吧啊呀喔哦]+$/g, '').replace(/^[點喝吃訂買來想要]+/, '');
  // 也去掉 meal_time / category 字眼
  for (const t of [...Object.keys(MEAL_TIME_TERMS), ...Object.keys(CATEGORY_TERMS)]) {
    inner = inner.split(t).join('');
  }
  // 殘留太短 → 整段視為「沒有具體餐點」（純偏好句）
  if (inner.length < 2) return null;
  // 殘留太像助詞 → null
  if (meaninglessResidue.test(inner)) return null;

  // 太短／太空 → null
  if (candidate.length < 2) return null;
  return inner;
}

// ─── Main entry ──────────────────────────────────────────────────────

export function understand(message: string, ctx: SemanticContext = {}): SemanticFrame {
  const msg = (message ?? '').trim();
  const recognized: SemanticFrame['recognizedConcepts'] = [];
  const unknownTerms: string[] = [];
  const removed = new Set<string>();

  const reference =
    parseOrdinalReference(msg) ?? parseDemonstrative(msg) ?? parseConfirmation(msg);

  const mealTime = detectMealTime(msg, recognized);
  if (mealTime) {
    Object.keys(MEAL_TIME_TERMS).forEach((t) => {
      if (msg.includes(t) && MEAL_TIME_TERMS[t] === mealTime) removed.add(t);
    });
  }

  const category = detectCategory(msg, recognized);
  if (category) {
    Object.keys(CATEGORY_TERMS).forEach((t) => {
      if (msg.includes(t) && CATEGORY_TERMS[t] === category) removed.add(t);
    });
  }

  const constraints = detectConstraints(msg, ctx.preferences);
  const quantity = detectQuantity(msg);

  let intent: SemanticIntent = 'unknown';
  let confidence = 0;
  let item: string | null = null;
  let needsClarification = false;
  let clarificationPrompt: string | null = null;

  // ── 意圖判斷 ──
  // 對話接續：上一輪有 choiceMenu 時，使用者短回應應該被視為 follow-up
  const hasLastMenu = (ctx.lastChoiceMenu?.options?.length ?? 0) > 0;
  // 偵測上一輪是不是「點餐相關」的選單（看 sendAsUser 或 title）
  const lastMenuIsDining = hasLastMenu && (
    /[點訂]餐|餐點|餐廳|menu|飲料|飯|麵|便當|午餐|晚餐|早餐/.test(
      String(ctx.lastChoiceMenu?.title ?? '') +
      String(ctx.lastChoiceMenu?.prompt ?? '') +
      (ctx.lastChoiceMenu?.options ?? [])
        .map((o) => `${o.label ?? ''} ${o.sendAsUser ?? ''}`)
        .join(' '),
    )
  );

  if (LEAVE_VERBS.test(msg)) {
    intent = 'request_leave';
    confidence = 0.85;
  } else if (STATUS_VERBS.test(msg)) {
    intent = 'order_status';
    confidence = 0.9;
  } else if (
    FOOD_ORDER_VERBS.test(msg) ||
    // 「第 N 個」只有在上一輪是 dining 時才當點餐意圖；
    // 否則交由其他 handler（圖書、活動、訂單等）用 lastChoiceMenu 自己解析
    (reference?.type === 'ordinal' && lastMenuIsDining) ||
    // 短回應 + 上一輪是餐單 → 繼承「order_food」意圖
    (hasLastMenu && lastMenuIsDining && msg.length <= 10) ||
    // 純「隨便」「都可以」+ 有餐單 → autoPick
    (constraints.autoPick && lastMenuIsDining)
  ) {
    intent = 'order_food';
    confidence = 0.8;
    item = extractConcreteItemName(msg, removed);

    // 「幫我訂午餐」→ item 應該為 null（只有 meal_time）
    if (item && mealTime && item.length <= 3) item = null;
    // 「隨便幫我點」/「都可以」→ item 不應該抓到隨便這個字
    if (item && AUTO_PICK_TERMS.some((t) => item!.includes(t))) item = null;

    // 「第 N 個」沒有具體餐點 → 由 reference 填補
    if (reference?.type === 'ordinal' && hasLastMenu) {
      confidence = 0.97;
    } else if (constraints.autoPick) {
      // 「隨便幫我點」→ 由 handler 從可用選項挑一個（top-1 或 random）
      confidence = 0.9;
    } else if (item || mealTime) {
      // 有具體目標或時段 → 可由 handler 完成
    } else if (hasLastMenu && lastMenuIsDining) {
      // 短回應但有餐單 → 嘗試把整段訊息當作「過濾條件」交給 handler
      confidence = 0.7;
    } else if (!item && !mealTime && reference == null) {
      needsClarification = true;
      clarificationPrompt =
        '你想吃什麼？可以說具體餐點名（例如「滷肉飯」）、用餐時段（午餐/晚餐），或描述偏好（清淡的、辣的）。也可以說「隨便」我幫你決定。';
    }
  } else if (BROWSE_VERBS.test(msg) || /菜單|餐廳/.test(msg)) {
    intent = 'browse_menu';
    confidence = 0.75;
    item = extractConcreteItemName(msg, removed);
  } else if (reference?.type === 'demonstrative' || reference?.type === 'confirmation') {
    // 「就那個」「對」這類短回應 → 由執行層用歷史判斷
    intent = 'clarify';
    confidence = 0.6;
  } else if (msg.length === 0) {
    intent = 'unknown';
  } else {
    // 不認識：記為 unknown concept
    intent = 'unknown';
    confidence = 0.1;
    unknownTerms.push(msg.slice(0, 30));
    recordUnknownConcept(msg.slice(0, 30), { message: msg, context: ctx.conversationHistory?.slice(-2) });
  }

  // ── 從學習過的概念補強 ──
  const learnedItem = item ? lookupLearnedConcept(item) : null;
  if (learnedItem && !mealTime) {
    recognized.push({ term: item!, resolvedAs: learnedItem.meaning, source: 'learned' });
    if (learnedItem.itemName) item = learnedItem.itemName;
  }

  return {
    rawMessage: msg,
    intent,
    slots: {
      meal_time: mealTime,
      item,
      category,
      quantity,
    },
    reference,
    constraints,
    confidence,
    needsClarification,
    clarificationPrompt,
    unknownTerms,
    recognizedConcepts: recognized,
  };
}

/**
 * 從 frame 與菜單清單，過濾出最符合 constraints + slots 的候選。
 * 不做字串匹配，做的是「語意過濾」。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rankMenuCandidates<T extends Record<string, any>>(
  menus: T[],
  frame: SemanticFrame,
  cafeteriasById?: Map<string, { name?: string; merchantId?: string }>,
): T[] {
  const { slots, constraints, reference } = frame;

  // 「第 N 個」由執行層處理 (lastChoiceMenu)，這裡略過
  if (reference?.type === 'ordinal') return menus;

  let pool = menus.slice();

  if (slots.category) {
    const filtered = pool.filter((m) => m.category === slots.category);
    if (filtered.length > 0) pool = filtered;
  }

  if (slots.meal_time) {
    // 用 category 作為 meal_time 的近似映射
    const mealCategoryMap: Record<MealTime, Array<NonNullable<SemanticSlots['category']>>> = {
      breakfast: ['main', 'beverage', 'side'],
      lunch: ['main', 'set', 'side'],
      dinner: ['main', 'set'],
      snack: ['dessert', 'beverage', 'side'],
    };
    const allow = new Set(mealCategoryMap[slots.meal_time]);
    const filtered = pool.filter((m) => allow.has(m.category));
    if (filtered.length > 0) pool = filtered;

    // 「早餐」優先含「吐司、蛋餅、漢堡、咖啡」的店家
    if (slots.meal_time === 'breakfast') {
      const morning = pool.filter((m) =>
        /吐司|蛋餅|漢堡|早餐|morning|breakfast|咖啡/i.test(String(m.name ?? '')),
      );
      if (morning.length > 0) pool = morning;
    }
  }

  if (constraints.vegetarian) {
    const veg = pool.filter((m) =>
      m.isVegetarian === true ||
      /素|蔬|沙拉|青菜/.test(String(m.name ?? '')) ||
      /素/.test(String(m.description ?? '')),
    );
    if (veg.length > 0) pool = veg;
  }

  if (constraints.spicy === true) {
    const spicy = pool.filter((m) =>
      /辣|麻辣|川/.test(String(m.name ?? '')) ||
      /辣|麻辣|川/.test(String(m.description ?? '')),
    );
    if (spicy.length > 0) pool = spicy;
  } else if (constraints.spicy === 'avoid') {
    pool = pool.filter((m) => !/辣|麻辣/.test(String(m.name ?? '')));
  }

  if (constraints.maxPrice != null) {
    pool = pool.filter((m) => typeof m.price !== 'number' || m.price <= constraints.maxPrice!);
  }

  if (constraints.avoidAllergens && constraints.avoidAllergens.length > 0) {
    const pattern = new RegExp(constraints.avoidAllergens.join('|'));
    pool = pool.filter((m) => !pattern.test(String(m.name ?? '') + String(m.description ?? '')));
  }

  // 「快一點」→ 已標 popular 的擺前面（通常出餐快）
  if (constraints.quick) {
    pool.sort((a, b) => Number(b.popular ?? 0) - Number(a.popular ?? 0));
  }

  // 偏好餐廳擺前面
  if (cafeteriasById) {
    pool.sort((a, b) => {
      const ac = cafeteriasById.get(a.cafeteriaId ?? a.cafeteria_id ?? '')?.name ?? '';
      const bc = cafeteriasById.get(b.cafeteriaId ?? b.cafeteria_id ?? '')?.name ?? '';
      return ac === '' && bc !== '' ? 1 : 0;
    });
  }

  return pool;
}

/** 給 UI 用：把 frame 翻譯成人類可讀說明（debug 卡片用） */
export function describeFrame(frame: SemanticFrame): string {
  const parts: string[] = [];
  parts.push(`意圖：${frame.intent}（信心 ${(frame.confidence * 100).toFixed(0)}%）`);
  const slotEntries = Object.entries(frame.slots).filter(([, v]) => v != null && v !== '');
  if (slotEntries.length > 0) {
    parts.push(`插槽：${slotEntries.map(([k, v]) => `${k}=${v}`).join('、')}`);
  }
  const constraintEntries = Object.entries(frame.constraints).filter(([, v]) => v != null);
  if (constraintEntries.length > 0) {
    parts.push(`條件：${constraintEntries.map(([k, v]) => `${k}=${v}`).join('、')}`);
  }
  if (frame.reference) parts.push(`引用：${frame.reference.type}#${frame.reference.index ?? '-'}`);
  if (frame.unknownTerms.length > 0) parts.push(`未知詞：${frame.unknownTerms.join('、')}`);
  return parts.join(' · ');
}
