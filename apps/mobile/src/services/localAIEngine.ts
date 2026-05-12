/**
 * 靜宜大學 GPT 級本地 AI 引擎 — Advanced Local Intelligence Engine
 * ═══════════════════════════════════════════════════════════════════
 * 完全在裝置端運行的深度學習系統，不依賴任何外部 API。
 *
 * 核心演算法：
 *  1. Word Embedding — 64 維稠密詞向量（校園領域預訓練 + 動態學習）
 *  2. Softmax Intent Classifier — 多層感知器意圖分類器，支援線上學習
 *  3. Attention-based Response — 注意力機制回答選擇/生成
 *  4. N-gram Language Model — 二/三元文法模型生成自然回答
 *  5. Q-Learning Reward Model — 強化學習獎勵模型，從回饋中持續優化
 *  6. Conversation Context Tracker — 多輪對話上下文追蹤 + 指代消解
 *  7. Named Entity Recognition — 校園實體辨識（課程、地點、人物、時間）
 *  8. Semantic Similarity — 語意相似度（超越 TF-IDF 的稠密匹配）
 *
 * 設計哲學：模仿 Transformer 架構的核心思想，用輕量算法在手機端實現
 */

// ═══════════════════════════════════════════════════
// 1. Word Embedding System — 稠密詞向量
// ═══════════════════════════════════════════════════

const EMBED_DIM = 64; // 向量維度

/** 詞向量 */
export interface WordVector {
  word: string;
  vec: Float32Array;
}

/** 詞嵌入模型 */
export interface EmbeddingModel {
  vocab: Map<string, Float32Array>; // 詞 → 向量
  wordFreq: Map<string, number>; // 詞頻
  coMatrix: Map<string, Map<string, number>>; // 共現矩陣（用於動態訓練）
  dim: number;
  trainCount: number;
}

/** 初始化隨機向量（Xavier initialization） */
function initVector(dim: number): Float32Array {
  const vec = new Float32Array(dim);
  const scale = Math.sqrt(2.0 / dim);
  for (let i = 0; i < dim; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random();
    vec[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
  }
  return vec;
}

/** 向量加法（in-place） */
function vecAdd(target: Float32Array, source: Float32Array, scale = 1.0): void {
  for (let i = 0; i < target.length; i++) target[i] += source[i] * scale;
}

/** 向量內積 */
function vecDot(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

/** 向量 L2 範數 */
function vecNorm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s) || 1e-8;
}

/** 餘弦相似度 */
function vecCosine(a: Float32Array, b: Float32Array): number {
  return vecDot(a, b) / (vecNorm(a) * vecNorm(b));
}

/** 取得或建立詞向量 */
function getOrCreateVec(model: EmbeddingModel, word: string): Float32Array {
  let v = model.vocab.get(word);
  if (!v) {
    v = initVector(model.dim);
    model.vocab.set(word, v);
  }
  return v;
}

/** 句子 → 平均向量（Sentence Embedding via mean pooling） */
export function sentenceEmbedding(model: EmbeddingModel, tokens: string[]): Float32Array {
  const result = new Float32Array(model.dim);
  if (tokens.length === 0) return result;

  let count = 0;
  for (const t of tokens) {
    const v = model.vocab.get(t);
    if (v) {
      // IDF 加權 — 常見詞權重低
      const freq = model.wordFreq.get(t) ?? 1;
      const idfWeight = 1.0 / Math.log2(freq + 2);
      vecAdd(result, v, idfWeight);
      count += idfWeight;
    }
  }
  if (count > 0) {
    for (let i = 0; i < result.length; i++) result[i] /= count;
  }
  return result;
}

/** 語意相似度（基於詞向量） */
export function semanticSimilarity(
  model: EmbeddingModel,
  tokensA: string[],
  tokensB: string[],
): number {
  const va = sentenceEmbedding(model, tokensA);
  const vb = sentenceEmbedding(model, tokensB);
  return vecCosine(va, vb);
}

// ── Skip-gram 風格的線上訓練 ──

/** 從一個句子更新共現矩陣 + 微調向量（SGD） */
export function trainEmbeddingOnSentence(model: EmbeddingModel, tokens: string[], lr = 0.01): void {
  const windowSize = 3;
  for (let i = 0; i < tokens.length; i++) {
    const center = tokens[i];
    model.wordFreq.set(center, (model.wordFreq.get(center) ?? 0) + 1);

    for (
      let j = Math.max(0, i - windowSize);
      j <= Math.min(tokens.length - 1, i + windowSize);
      j++
    ) {
      if (i === j) continue;
      const context = tokens[j];

      // 更新共現矩陣
      if (!model.coMatrix.has(center)) model.coMatrix.set(center, new Map());
      const row = model.coMatrix.get(center)!;
      row.set(context, (row.get(context) ?? 0) + 1);

      // Skip-gram SGD：讓 center 和 context 的向量更接近
      const vc = getOrCreateVec(model, center);
      const vctx = getOrCreateVec(model, context);
      const sim = vecCosine(vc, vctx);
      const target = 0.8; // positive pair target
      const error = target - sim;

      if (Math.abs(error) > 0.01) {
        const normC = vecNorm(vc);
        const normCtx = vecNorm(vctx);
        for (let d = 0; d < model.dim; d++) {
          const gradC = (error * lr * (vctx[d] / normCtx - (sim * vc[d]) / normC)) / normC;
          const gradCtx = (error * lr * (vc[d] / normC - (sim * vctx[d]) / normCtx)) / normCtx;
          vc[d] += gradC;
          vctx[d] += gradCtx;
        }
      }
    }
  }
  model.trainCount++;
}

// ── 預訓練校園領域詞向量 ──

const CAMPUS_SEED_SENTENCES: string[][] = [
  ['課程', '上課', '老師', '教授', '學分', '必修', '選修', '通識'],
  ['作業', '繳交', '截止', '報告', '期中考', '期末考', '成績', '分數'],
  ['午餐', '晚餐', '早餐', '餐廳', '食堂', '便當', '素食', '美食'],
  ['圖書館', '借書', '還書', '座位', '自習', '討論室', '預約'],
  ['宿舍', '寢室', '報修', '洗衣', '包裹', '門禁', '室友'],
  ['公車', '校車', '交通', '停車場', '腳踏車', '通勤'],
  ['社團', '活動', '報名', '講座', '比賽', '志工', '服務學習'],
  ['請假', '缺曠', '出席', '翹課', '病假', '事假'],
  ['選課', '退選', '加簽', '課表', '衝堂', '排課'],
  ['被當', '當掉', '不及格', '二一', '退學', '延畢', '重修'],
  ['獎學金', '助學', '工讀', '實習', '打工'],
  ['保健室', '健康', '看醫生', '診所', '頭痛', '感冒', '不舒服'],
  ['心情', '壓力', '焦慮', '諮商', '輔導', '開心', '難過'],
  ['天氣', '下雨', '溫度', '颱風', '停班', '停課'],
  ['列印', '影印', '印表機', '掃描', '紙張', '墨水'],
  ['遺失', '失物', '撿到', '認領', '協尋', '掉了'],
  ['推薦', '建議', '吃什麼', '好吃', '便宜', 'CP值'],
  ['公告', '通知', '消息', '重要', '截止日'],
  ['地圖', '導航', '怎麼走', '位置', '在哪裡'],
  ['畢業', '學位', '論文', '答辯', '畢業門檻'],
  // 關聯句：建立跨領域語意連結
  ['作業', '截止', '趕快', '繳交', '遲交', '扣分'],
  ['考試', '複習', '準備', '範圍', '重點', '及格'],
  ['訂餐', '點餐', '外送', '價格', '菜單', '等候'],
  ['生病', '不舒服', '請假', '看醫生', '保健室', '休息'],
  ['壓力', '考試', '作業', '睡不著', '累', '崩潰', '諮商'],
];

export function createEmbeddingModel(): EmbeddingModel {
  const model: EmbeddingModel = {
    vocab: new Map(),
    wordFreq: new Map(),
    coMatrix: new Map(),
    dim: EMBED_DIM,
    trainCount: 0,
  };

  // 預訓練：用校園種子句反覆訓練讓向量收斂
  for (let epoch = 0; epoch < 5; epoch++) {
    for (const sentence of CAMPUS_SEED_SENTENCES) {
      trainEmbeddingOnSentence(model, sentence, 0.05);
    }
  }

  return model;
}

// ═══════════════════════════════════════════════════
// 2. Neural Intent Classifier — 神經意圖分類器
// ═══════════════════════════════════════════════════

const INTENT_LABELS = [
  'greeting',
  'academic',
  'assignment',
  'grades',
  'dining',
  'navigation',
  'announcement',
  'event',
  'library',
  'dormitory',
  'health',
  'emotion',
  'transport',
  'weather',
  'printing',
  'scholarship',
  'attendance',
  'graduation',
  'lost_found',
  'recommendation',
  'complaint',
  'thanks',
  'farewell',
  'general',
] as const;

export type IntentLabel = (typeof INTENT_LABELS)[number];

/** 意圖分類結果 */
export interface IntentResult {
  intent: IntentLabel;
  confidence: number;
  topK: Array<{ intent: IntentLabel; score: number }>;
}

/** 分類器權重 */
export interface ClassifierWeights {
  /** 每個意圖的原型向量（centroid） */
  centroids: Map<string, Float32Array>;
  /** 每個意圖的樣本數 */
  counts: Map<string, number>;
  /** 偏差項 */
  biases: Map<string, number>;
  /** 關鍵詞權重加成 */
  keywordBoosts: Map<string, Map<string, number>>;
}

export function createClassifierWeights(): ClassifierWeights {
  const centroids = new Map<string, Float32Array>();
  const counts = new Map<string, number>();
  const biases = new Map<string, number>();

  for (const label of INTENT_LABELS) {
    centroids.set(label, new Float32Array(EMBED_DIM));
    counts.set(label, 0);
    biases.set(label, 0);
  }

  // 初始化關鍵詞增強映射
  const keywordBoosts = new Map<string, Map<string, number>>();
  const boostMap: Record<string, string[]> = {
    greeting: ['你好', '嗨', '哈囉', '早安', '午安', '晚安', '安安'],
    academic: ['課', '修', '學分', '老師', '上課', '教授', '課表', '選課'],
    assignment: ['作業', '繳交', '截止', '報告', '考試', '期中', '期末'],
    grades: ['成績', '分數', '及格', '被當', 'GPA', '二一', '排名'],
    dining: [
      '吃',
      '餐',
      '飯',
      '午餐',
      '晚餐',
      '素食',
      '便當',
      '餐廳',
      '美食',
      '外送',
      '便宜',
      '平價',
      '其他選擇',
      '還有其他',
    ],
    navigation: ['哪裡', '怎麼走', '位置', '導航', '地圖', '在哪'],
    announcement: ['公告', '通知', '消息', '新聞'],
    event: ['活動', '報名', '講座', '比賽', '社團'],
    library: ['圖書', '借書', '還書', '座位', '自習'],
    dormitory: ['宿舍', '寢室', '報修', '洗衣', '包裹', '門禁'],
    health: ['頭痛', '感冒', '不舒服', '看醫生', '保健室', '發燒', '診所'],
    emotion: ['壓力', '焦慮', '難過', '累', '煩', '開心', '心情', '沮喪'],
    transport: [
      '公車',
      '校車',
      '停車',
      '腳踏車',
      '交通',
      '怎麼去',
      '車站',
      '火車站',
      '高鐵',
      '客運',
      '台中車站',
      '臺中車站',
    ],
    weather: ['天氣', '下雨', '溫度', '颱風'],
    printing: ['列印', '影印', '印表'],
    scholarship: ['獎學金', '助學', '補助'],
    attendance: ['請假', '缺曠', '翹課', '出席'],
    graduation: ['畢業', '學位', '論文', '延畢'],
    lost_found: ['遺失', '掉了', '撿到', '失物'],
    recommendation: ['推薦', '建議', '哪個好', '選哪個'],
    complaint: ['爛', '差', '不好', '很糟', '太慢', '很爛'],
    thanks: ['謝謝', '感謝', '太好了', '幫大忙'],
    farewell: ['掰掰', '再見', '下次見', '拜'],
  };

  for (const [intent, keywords] of Object.entries(boostMap)) {
    const kmap = new Map<string, number>();
    for (const kw of keywords) kmap.set(kw, 2.0);
    keywordBoosts.set(intent, kmap);
  }

  return { centroids, counts, biases, keywordBoosts };
}

/** Softmax 函數 */
function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** 分類器推理 */
export function classifyIntent(
  tokens: string[],
  embedding: EmbeddingModel,
  weights: ClassifierWeights,
): IntentResult {
  const sentVec = sentenceEmbedding(embedding, tokens);
  const rawText = tokens.join('');

  // 計算每個意圖的 logit = cosine(sentence, centroid) + bias + keyword_boost
  const logits: number[] = [];
  const labels: IntentLabel[] = [];

  for (const label of INTENT_LABELS) {
    const centroid = weights.centroids.get(label);
    const bias = weights.biases.get(label) ?? 0;
    const count = weights.counts.get(label) ?? 0;

    // 基礎分：與 centroid 的餘弦相似度
    let logit = centroid ? vecCosine(sentVec, centroid) : 0;

    // 加入 bias（從訓練中學到的偏移）
    logit += bias;

    // 關鍵詞加成
    const boosts = weights.keywordBoosts.get(label);
    if (boosts) {
      for (const [kw, boost] of boosts) {
        if (rawText.includes(kw)) logit += boost;
      }
    }

    // 信賴度加成（越多訓練樣本的意圖越可信）
    if (count >= 5) logit += 0.1;
    if (count >= 15) logit += 0.1;

    logits.push(logit);
    labels.push(label);
  }

  const probs = softmax(logits);
  const maxIdx = probs.indexOf(Math.max(...probs));

  const topK = labels
    .map((l, i) => ({ intent: l, score: probs[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    intent: labels[maxIdx],
    confidence: probs[maxIdx],
    topK,
  };
}

/** 線上學習：用一筆標註資料更新分類器（SGD） */
export function trainClassifier(
  tokens: string[],
  trueLabel: IntentLabel,
  embedding: EmbeddingModel,
  weights: ClassifierWeights,
  lr = 0.1,
): void {
  const sentVec = sentenceEmbedding(embedding, tokens);
  const trueIdx = INTENT_LABELS.indexOf(trueLabel);
  if (trueIdx < 0) return;

  // 更新 centroid（移動平均）
  const centroid = weights.centroids.get(trueLabel);
  const count = (weights.counts.get(trueLabel) ?? 0) + 1;
  weights.counts.set(trueLabel, count);

  if (centroid) {
    // Exponential moving average
    const alpha = Math.min(lr, 1.0 / count);
    for (let i = 0; i < EMBED_DIM; i++) {
      centroid[i] = (1 - alpha) * centroid[i] + alpha * sentVec[i];
    }
  }

  // 更新 bias（如果分錯了就調整）
  const result = classifyIntent(tokens, embedding, weights);
  if (result.intent !== trueLabel) {
    const currentBias = weights.biases.get(trueLabel) ?? 0;
    weights.biases.set(trueLabel, currentBias + lr * 0.5);

    const wrongBias = weights.biases.get(result.intent) ?? 0;
    weights.biases.set(result.intent, wrongBias - lr * 0.3);
  }
}

// ═══════════════════════════════════════════════════
// 3. Conversation Context Tracker — 多輪對話理解
// ═══════════════════════════════════════════════════

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  tokens: string[];
  intent?: IntentLabel;
  entities?: NamedEntity[];
  timestamp: number;
  /** 這輪回答用到的資料 key（課程名、餐點名…）方便追問時定位 */
  dataKeysUsed?: string[];
}

/** 對話槽位（Slot）— 追蹤用戶在多輪中逐步提供的資訊 */
export interface DialogSlot {
  name: string; // 例如 "target_day", "food_preference", "course_name"
  value: string;
  source: 'user' | 'inferred'; // 用戶明確說的 vs AI 推理的
  turnIndex: number; // 在哪一輪設定的
  confidence: number;
}

/** 上下文記憶片段 — 記住前文的關鍵資訊 */
export interface ContextMemoryItem {
  key: string; // 例如 "last_recommended_meal", "asked_about_course"
  value: string;
  intent: IntentLabel;
  turnIndex: number;
  expiresAfterTurns: number; // 幾輪後過期（0 = 不過期）
}

export interface DialogContext {
  turns: ConversationTurn[];
  currentTopic: IntentLabel | null;
  topicHistory: IntentLabel[];
  /** 追蹤的實體（供指代消解用） */
  mentionedEntities: NamedEntity[];
  /** 追蹤用戶情緒 */
  userMood: number; // -1 ~ +1
  /** 連續相同主題的輪數 */
  topicContinuity: number;
  /** 對話槽位 — 跨輪追蹤用戶提供的資訊 */
  slots: DialogSlot[];
  /** 短期記憶 — 記住回答中的關鍵資訊，供追問時使用 */
  shortTermMemory: ContextMemoryItem[];
  /** 上一輪 AI 回答的摘要（用於連貫性） */
  lastAssistantSummary: string;
  /** 用戶的對話風格偏好（從互動中學習） */
  userStyle: {
    prefersShort: boolean; // 偏好簡短
    prefersDetail: boolean; // 偏好詳細
    usesEmoji: boolean; // 用戶常用 emoji
    formality: number; // 0=casual 1=formal
  };
  /** 省略還原歷史 — 記住用戶省略的主詞/受詞 */
  ellipsisHistory: Array<{ original: string; resolved: string; turnIndex: number }>;
}

export function createDialogContext(): DialogContext {
  return {
    turns: [],
    currentTopic: null,
    topicHistory: [],
    mentionedEntities: [],
    userMood: 0,
    topicContinuity: 0,
    slots: [],
    shortTermMemory: [],
    lastAssistantSummary: '',
    userStyle: { prefersShort: false, prefersDetail: false, usesEmoji: false, formality: 0.5 },
    ellipsisHistory: [],
  };
}

/** 從回答內容中提取關鍵資訊存入短期記憶 */
function extractMemoryFromResponse(
  content: string,
  intent: IntentLabel,
  turnIndex: number,
): ContextMemoryItem[] {
  const items: ContextMemoryItem[] = [];

  // 餐點推薦 → 記住推薦了什麼
  if (intent === 'dining') {
    const menuItems = content.match(/\d+\.\s*([^\n（(]+)/g);
    if (menuItems && menuItems.length > 0) {
      items.push({
        key: 'last_recommended_meals',
        value: menuItems.slice(0, 5).join(', '),
        intent,
        turnIndex,
        expiresAfterTurns: 10,
      });
    }
    // 記住提到的餐廳
    const cafeterias = content.match(/（([^）]+)）/g);
    if (cafeterias) {
      items.push({
        key: 'mentioned_cafeterias',
        value: cafeterias.map((c) => c.replace(/[（）]/g, '')).join(', '),
        intent,
        turnIndex,
        expiresAfterTurns: 10,
      });
    }
  }

  // 課程 → 記住提到的課
  if (intent === 'academic') {
    const courseItems = content.match(/\d+\.\s*([^\n（(]+)/g);
    if (courseItems) {
      items.push({
        key: 'last_mentioned_courses',
        value: courseItems.slice(0, 8).join(', '),
        intent,
        turnIndex,
        expiresAfterTurns: 15,
      });
    }
  }

  // 作業 → 記住提到的作業
  if (intent === 'assignment') {
    const assignItems = content.match(/\d+\.\s*([^\n（(]+)/g);
    if (assignItems) {
      items.push({
        key: 'last_mentioned_assignments',
        value: assignItems.slice(0, 8).join(', '),
        intent,
        turnIndex,
        expiresAfterTurns: 15,
      });
    }
  }

  // 通用：記住 AI 回答的主要結論
  if (content.length > 20) {
    const firstSentence = content.split(/[。！？\n]/)[0]?.trim() ?? '';
    if (firstSentence.length >= 5) {
      items.push({
        key: 'last_answer_gist',
        value: firstSentence.slice(0, 80),
        intent,
        turnIndex,
        expiresAfterTurns: 5,
      });
    }
  }

  return items;
}

/** 從用戶訊息中提取槽位 */
function extractSlots(text: string, intent: IntentLabel, turnIndex: number): DialogSlot[] {
  const slots: DialogSlot[] = [];

  // 時間槽
  const dayMatch = text.match(
    /今天|明天|後天|星期([一二三四五六日天])|週([一二三四五六日天])|下週|這週/,
  );
  if (dayMatch) {
    slots.push({
      name: 'target_day',
      value: dayMatch[0],
      source: 'user',
      turnIndex,
      confidence: 0.95,
    });
  }

  const timeMatch = text.match(/([上下]午)|早上|中午|晚上|(\d{1,2})[點時]/);
  if (timeMatch) {
    slots.push({
      name: 'target_time',
      value: timeMatch[0],
      source: 'user',
      turnIndex,
      confidence: 0.9,
    });
  }

  // 餐飲偏好槽
  if (intent === 'dining' || /吃|餐|飯|餓/.test(text)) {
    const priceMatch = text.match(/(\d+)\s*[元塊]以[下內]|便宜|平價/);
    if (priceMatch)
      slots.push({
        name: 'budget',
        value: priceMatch[0],
        source: 'user',
        turnIndex,
        confidence: 0.9,
      });

    const prefMatch = text.match(/素食|不吃[肉辣]|清淡|重口味|健康|有肉|辣|不辣|海鮮|甜的|鹹的/);
    if (prefMatch)
      slots.push({
        name: 'food_preference',
        value: prefMatch[0],
        source: 'user',
        turnIndex,
        confidence: 0.95,
      });

    const cafeteriaMatch = text.match(/學生餐廳|教職員餐廳|便利商店|飲料店|濟時樓/);
    if (cafeteriaMatch)
      slots.push({
        name: 'cafeteria',
        value: cafeteriaMatch[0],
        source: 'user',
        turnIndex,
        confidence: 0.95,
      });
  }

  // 課程槽
  if (intent === 'academic' || intent === 'assignment' || intent === 'grades') {
    const teacherMatch = text.match(/([^\s]{2,4})(老師|教授|教的)/);
    if (teacherMatch)
      slots.push({
        name: 'teacher_name',
        value: teacherMatch[1],
        source: 'user',
        turnIndex,
        confidence: 0.8,
      });
  }

  // 地點槽
  const locationMatch = text.match(/在([^\s,，。]{2,8})|到([^\s,，。]{2,8})|去([^\s,，。]{2,8})/);
  if (locationMatch && intent === 'navigation') {
    slots.push({
      name: 'destination',
      value: locationMatch[1] || locationMatch[2] || locationMatch[3],
      source: 'user',
      turnIndex,
      confidence: 0.7,
    });
  }

  // 數量槽
  const quantityMatch = text.match(/(\d+)\s*(份|杯|碗|個|瓶)/);
  if (quantityMatch) {
    slots.push({
      name: 'quantity',
      value: quantityMatch[0],
      source: 'user',
      turnIndex,
      confidence: 0.9,
    });
  }

  return slots;
}

/** 分析用戶對話風格 */
function analyzeUserStyle(
  content: string,
  prevStyle: DialogContext['userStyle'],
): DialogContext['userStyle'] {
  const len = content.length;
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]|😀|😂|🤔|👍|❤️|🎉|💪|😊|🙏|😭|😅|🥺|✨|🔥|💯/u.test(
    content,
  );
  const isFormal = /請問|麻煩|您|不好意思|打擾/.test(content);
  const isCasual = /ㄟ|ㄏㄏ|哈哈|欸|啊|喔|耶|讚|帥|酷|XD|lol/i.test(content);

  return {
    prefersShort: len < 10 ? true : len > 50 ? false : prevStyle.prefersShort,
    prefersDetail: /詳細|完整|所有|全部|列出來|一一/.test(content) ? true : prevStyle.prefersDetail,
    usesEmoji: hasEmoji ? true : prevStyle.usesEmoji,
    formality: isFormal
      ? Math.min(1, prevStyle.formality + 0.15)
      : isCasual
        ? Math.max(0, prevStyle.formality - 0.15)
        : prevStyle.formality,
  };
}

/** 更新對話上下文（大幅強化版） */
export function updateDialogContext(
  ctx: DialogContext,
  role: 'user' | 'assistant',
  content: string,
  tokens: string[],
  intent?: IntentLabel,
  entities?: NamedEntity[],
  dataKeysUsed?: string[],
): DialogContext {
  const turnIndex = ctx.turns.length;
  const turn: ConversationTurn = {
    role,
    content,
    tokens,
    intent,
    entities,
    timestamp: Date.now(),
    dataKeysUsed,
  };

  const turns = [...ctx.turns, turn].slice(-30); // 增加到 30 輪
  let currentTopic = ctx.currentTopic;
  let topicContinuity = ctx.topicContinuity;
  const topicHistory = [...ctx.topicHistory];

  if (role === 'user' && intent) {
    if (intent === currentTopic) {
      topicContinuity++;
    } else if (intent !== 'general' && intent !== 'greeting') {
      currentTopic = intent;
      topicContinuity = 1;
      topicHistory.push(intent);
    }
  }

  // 更新實體追蹤
  const mentionedEntities = [...ctx.mentionedEntities];
  if (entities) {
    for (const e of entities) {
      const existing = mentionedEntities.findIndex((m) => m.text === e.text && m.type === e.type);
      if (existing >= 0) mentionedEntities[existing] = e;
      else mentionedEntities.push(e);
    }
  }
  while (mentionedEntities.length > 50) mentionedEntities.shift();

  // 情緒追蹤（更細緻）
  let userMood = ctx.userMood;
  if (role === 'user') {
    const strongPositive = /太好了|太棒了|完美|太強了|厲害|愛你/;
    const mildPositive = /謝謝|感謝|不錯|好的|了解|懂了|有幫助|ok/i;
    const strongNegative = /完全不對|胡說|亂講|爛|垃圾|廢物|白痴/;
    const mildNegative = /不對|答錯|不好|糟|煩|累|不是/;

    if (strongPositive.test(content)) userMood = Math.min(1, userMood + 0.4);
    else if (mildPositive.test(content)) userMood = Math.min(1, userMood + 0.15);
    else if (strongNegative.test(content)) userMood = Math.max(-1, userMood - 0.4);
    else if (mildNegative.test(content)) userMood = Math.max(-1, userMood - 0.15);
    userMood *= 0.92; // 自然衰減
  }

  // 更新槽位
  let slots = [...ctx.slots];
  if (role === 'user' && intent) {
    const newSlots = extractSlots(content, intent, turnIndex);
    for (const ns of newSlots) {
      const existIdx = slots.findIndex((s) => s.name === ns.name);
      if (existIdx >= 0) {
        // 用戶重新指定 → 覆蓋
        slots[existIdx] = ns;
      } else {
        slots.push(ns);
      }
    }
    // 清除太舊的槽位（超過 15 輪）
    slots = slots.filter((s) => turnIndex - s.turnIndex < 15);
  }

  // 更新短期記憶
  let shortTermMemory = [...ctx.shortTermMemory];
  if (role === 'assistant' && intent) {
    const newMemItems = extractMemoryFromResponse(content, intent, turnIndex);
    for (const nm of newMemItems) {
      const existIdx = shortTermMemory.findIndex((m) => m.key === nm.key);
      if (existIdx >= 0) shortTermMemory[existIdx] = nm;
      else shortTermMemory.push(nm);
    }
  }
  // 清除過期記憶
  shortTermMemory = shortTermMemory.filter(
    (m) => m.expiresAfterTurns === 0 || turnIndex - m.turnIndex < m.expiresAfterTurns,
  );

  // AI 回答摘要
  let lastAssistantSummary = ctx.lastAssistantSummary;
  if (role === 'assistant') {
    const firstLine = content.split(/[。！？\n]/)[0]?.trim() ?? '';
    lastAssistantSummary = firstLine.slice(0, 100);
  }

  // 用戶風格分析
  const userStyle = role === 'user' ? analyzeUserStyle(content, ctx.userStyle) : ctx.userStyle;

  return {
    turns,
    currentTopic,
    topicHistory: topicHistory.slice(-30),
    mentionedEntities,
    userMood,
    topicContinuity,
    slots,
    shortTermMemory,
    lastAssistantSummary,
    userStyle,
    ellipsisHistory: ctx.ellipsisHistory.slice(-10),
  };
}

/** 指代消解 + 省略還原（大幅強化版）
 *  處理：代詞（那個/它/他）、省略主詞、省略受詞、零指代
 */
export function resolveReferences(text: string, ctx: DialogContext): string {
  let resolved = text;
  const recent = ctx.mentionedEntities.slice(-5).reverse();

  // ── 1. 代詞替換 ──
  resolved = resolved.replace(/那門課|那堂課|那個課/, () => {
    const course = recent.find((e) => e.type === 'course');
    return course ? course.text : '那門課';
  });

  resolved = resolved.replace(/那邊|那裡|那個地方/, () => {
    const place = recent.find((e) => e.type === 'location');
    return place ? place.text : '那裡';
  });

  resolved = resolved.replace(/那道|那個菜|那個餐/, () => {
    const food = recent.find((e) => e.type === 'food');
    return food ? food.text : '那道菜';
  });

  resolved = resolved.replace(/那份|那個作業/, () => {
    const assignment = recent.find((e) => e.type === 'assignment');
    return assignment ? assignment.text : '那份作業';
  });

  // 「那個」— 根據上下文 topic 選擇最相關的實體
  resolved = resolved.replace(/那個|這個|它/, () => {
    if (ctx.currentTopic === 'dining')
      return recent.find((e) => e.type === 'food')?.text ?? recent[0]?.text ?? '那個';
    if (ctx.currentTopic === 'academic')
      return recent.find((e) => e.type === 'course')?.text ?? recent[0]?.text ?? '那個';
    if (ctx.currentTopic === 'navigation')
      return recent.find((e) => e.type === 'location')?.text ?? recent[0]?.text ?? '那個';
    return recent[0]?.text ?? '那個';
  });

  // ── 2. 省略還原：極短訊息根據上下文補全 ──
  if (resolved.length <= 8 && ctx.turns.length > 0) {
    const lastUserTurn = [...ctx.turns].reverse().find((t) => t.role === 'user');
    const lastAsstTurn = [...ctx.turns].reverse().find((t) => t.role === 'assistant');

    // 「呢？」「也是」→ 對前一個回答的追問
    if (/^(呢|也是|也要|也想|一樣|同上)\s*[？?]?\s*$/.test(resolved)) {
      if (lastUserTurn?.content) {
        const lastTopic = lastUserTurn.content.replace(/[？?！!。，]$/g, '');
        resolved = `${lastTopic}也是`;
      }
    }

    // 「多少錢」「在哪」「幾點」→ 補上前文的主語
    if (
      /^(多少錢|多少|在哪|幾點|怎麼去|好吃嗎|推薦嗎|要多久|遠嗎|貴嗎|辣嗎)\s*[？?]?\s*$/.test(
        resolved,
      )
    ) {
      const subject = recent[0]?.text;
      if (subject) {
        resolved = `${subject}${resolved}`;
      }
    }

    // 「第一個」「第二個」「最後一個」→ 從短期記憶中找列表
    const ordinalMatch = resolved.match(/^第([一二三四五六七八1-8])個/);
    if (ordinalMatch) {
      const ordinalMap: Record<string, number> = {
        一: 0,
        二: 1,
        三: 2,
        四: 3,
        五: 4,
        六: 5,
        七: 6,
        八: 7,
        '1': 0,
        '2': 1,
        '3': 2,
        '4': 3,
        '5': 4,
        '6': 5,
        '7': 6,
        '8': 7,
      };
      const idx = ordinalMap[ordinalMatch[1]] ?? 0;
      // 從短期記憶中找列表
      const listMem = ctx.shortTermMemory.find(
        (m) =>
          m.key === 'last_recommended_meals' ||
          m.key === 'last_mentioned_courses' ||
          m.key === 'last_mentioned_assignments',
      );
      if (listMem) {
        const items = listMem.value.split(', ');
        if (items[idx]) {
          const cleanItem = items[idx].replace(/^\d+\.\s*/, '').trim();
          resolved = resolved.replace(ordinalMatch[0], cleanItem);
        }
      }
    }

    if (/^最後一個/.test(resolved)) {
      const listMem = ctx.shortTermMemory.find((m) => m.key.startsWith('last_'));
      if (listMem) {
        const items = listMem.value.split(', ');
        const last = items[items.length - 1]?.replace(/^\d+\.\s*/, '').trim();
        if (last) resolved = resolved.replace('最後一個', last);
      }
    }
  }

  // ── 3. 「還有嗎」「其他的呢」→ 標記為追問 ──
  // （不修改文字，但後續 isFollowUp 會捕捉）

  // 記錄省略還原歷史
  if (resolved !== text) {
    ctx.ellipsisHistory.push({
      original: text,
      resolved,
      turnIndex: ctx.turns.length,
    });
  }

  return resolved;
}

/** 判斷是否為追問（follow-up question）— 大幅強化 */
export function isFollowUp(text: string, ctx: DialogContext): boolean {
  if (ctx.turns.length === 0) return false;

  // 1. 明確的追問詞
  if (/那個|那邊|然後呢|接下來|還有呢|更多|再多說|詳細|繼續|還有嗎|其他的|別的呢/.test(text))
    return true;

  // 2. 極短問句且有先前主題
  if (text.length <= 8 && ctx.currentTopic !== null) return true;

  // 3. 序數引用（第一個、第二個…）
  if (/^第[一二三四五六七八1-8]個/.test(text)) return true;

  // 4. 「呢」結尾的短問句
  if (/呢[？?]?\s*$/.test(text) && text.length <= 15) return true;

  // 5. 短期記憶中有相關項目且問題很短
  if (text.length <= 15 && ctx.shortTermMemory.length > 0) {
    // 如果短期記憶有資料且用戶問的很短，很可能是追問
    const lastMem = ctx.shortTermMemory[ctx.shortTermMemory.length - 1];
    if (ctx.turns.length - lastMem.turnIndex <= 4) return true;
  }

  // 6. 比較型追問
  if (/比較|哪個好|哪個便宜|哪個近|差別|差異|不同/.test(text) && ctx.currentTopic !== null)
    return true;

  // 7. 否定型追問（不喜歡前面推薦的）
  if (/不想要|換一個|換別的|其他選擇|不喜歡|太[貴遠辣鹹甜]/.test(text)) return true;

  return false;
}

/** 取得當前上下文摘要（供注入 generateLocalAnswer 使用） */
export function getContextSummary(ctx: DialogContext): string {
  const parts: string[] = [];

  // 當前主題
  if (ctx.currentTopic) {
    parts.push(`[當前主題: ${ctx.currentTopic}, 持續${ctx.topicContinuity}輪]`);
  }

  // 活躍槽位
  if (ctx.slots.length > 0) {
    const slotStr = ctx.slots.map((s) => `${s.name}=${s.value}`).join(', ');
    parts.push(`[使用者已提供: ${slotStr}]`);
  }

  // 短期記憶
  if (ctx.shortTermMemory.length > 0) {
    const memStr = ctx.shortTermMemory
      .slice(-3)
      .map((m) => `${m.key}: ${m.value.slice(0, 40)}`)
      .join('; ');
    parts.push(`[前文提及: ${memStr}]`);
  }

  // 最近的實體
  if (ctx.mentionedEntities.length > 0) {
    const entityStr = ctx.mentionedEntities
      .slice(-5)
      .map((e) => `${e.text}(${e.type})`)
      .join(', ');
    parts.push(`[提到的實體: ${entityStr}]`);
  }

  // 情緒
  if (Math.abs(ctx.userMood) > 0.2) {
    parts.push(`[使用者情緒: ${ctx.userMood > 0 ? '正面' : '負面'}(${ctx.userMood.toFixed(1)})]`);
  }

  // 用戶風格
  if (ctx.userStyle.prefersShort) parts.push('[偏好: 簡短回答]');
  if (ctx.userStyle.prefersDetail) parts.push('[偏好: 詳細回答]');

  return parts.join(' ');
}

/** 取得槽位值（從對話槽位中查找） */
export function getSlotValue(ctx: DialogContext, slotName: string): string | null {
  const slot = ctx.slots.find((s) => s.name === slotName);
  return slot?.value ?? null;
}

/** 取得短期記憶值 */
export function getMemoryValue(ctx: DialogContext, key: string): string | null {
  const mem = ctx.shortTermMemory.find((m) => m.key === key);
  return mem?.value ?? null;
}

// ═══════════════════════════════════════════════════
// 4. Named Entity Recognition — 校園實體辨識
// ═══════════════════════════════════════════════════

export type EntityType =
  | 'course'
  | 'person'
  | 'location'
  | 'time'
  | 'food'
  | 'event'
  | 'number'
  | 'assignment';

export interface NamedEntity {
  text: string;
  type: EntityType;
  start: number;
  end: number;
  normalized?: string; // 標準化形式
}

/** 時間表達式模式 */
const TIME_PATTERNS: Array<[RegExp, string]> = [
  [/今天/, 'today'],
  [/明天/, 'tomorrow'],
  [/後天/, 'day_after_tomorrow'],
  [/昨天/, 'yesterday'],
  [/這週|這個禮拜|本週/, 'this_week'],
  [/下週|下個禮拜|下星期/, 'next_week'],
  [/星期([一二三四五六日天])/, 'weekday'],
  [/週([一二三四五六日天])/, 'weekday'],
  [/([上下]午)/, 'period'],
  [/(\d{1,2})[點時]/, 'hour'],
  [/(\d{1,2})月(\d{1,2})[日號]/, 'date'],
  [/第(\d+)節/, 'period_num'],
  [/期中|期末/, 'exam_period'],
  [/早上|中午|傍晚|晚上|凌晨/, 'time_of_day'],
];

/** 數量表達式模式 */
const NUMBER_PATTERNS: Array<[RegExp, EntityType]> = [
  [/(\d+)\s*學分/, 'number'],
  [/(\d+)\s*[元塊]/, 'number'],
  [/(\d+)\s*份/, 'number'],
  [/(\d+)\s*[人位個]/, 'number'],
];

/** 從文本中提取所有實體 */
export function extractEntities(
  text: string,
  knownCourses: string[] = [],
  knownLocations: string[] = [],
  knownPeople: string[] = [],
  knownFoods: string[] = [],
): NamedEntity[] {
  const entities: NamedEntity[] = [];

  // 1. 時間實體
  for (const [pattern, normalized] of TIME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        text: match[0],
        type: 'time',
        start: text.indexOf(match[0]),
        end: text.indexOf(match[0]) + match[0].length,
        normalized,
      });
    }
  }

  // 2. 數量實體
  for (const [pattern, type] of NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        text: match[0],
        type,
        start: text.indexOf(match[0]),
        end: text.indexOf(match[0]) + match[0].length,
      });
    }
  }

  // 3. 已知課程名稱（精確匹配）
  for (const course of knownCourses) {
    if (course.length >= 2 && text.includes(course)) {
      entities.push({
        text: course,
        type: 'course',
        start: text.indexOf(course),
        end: text.indexOf(course) + course.length,
      });
    }
  }

  // 4. 已知地點
  for (const loc of knownLocations) {
    if (loc.length >= 2 && text.includes(loc)) {
      entities.push({
        text: loc,
        type: 'location',
        start: text.indexOf(loc),
        end: text.indexOf(loc) + loc.length,
      });
    }
  }

  // 5. 已知人名
  for (const person of knownPeople) {
    if (person.length >= 2 && text.includes(person)) {
      entities.push({
        text: person,
        type: 'person',
        start: text.indexOf(person),
        end: text.indexOf(person) + person.length,
      });
    }
  }

  // 6. 食物名稱
  for (const food of knownFoods) {
    if (food.length >= 2 && text.includes(food)) {
      entities.push({
        text: food,
        type: 'food',
        start: text.indexOf(food),
        end: text.indexOf(food) + food.length,
      });
    }
  }

  // 去重
  return entities.filter(
    (e, i, arr) => arr.findIndex((x) => x.text === e.text && x.type === e.type) === i,
  );
}

// ═══════════════════════════════════════════════════
// 5. N-gram Language Model — 回答生成
// ═══════════════════════════════════════════════════

export interface NgramModel {
  /** bigram: "A" → { "B": count, "C": count } */
  bigrams: Map<string, Map<string, number>>;
  /** trigram: "A|B" → { "C": count } */
  trigrams: Map<string, Map<string, number>>;
  /** 每個意圖的常用開頭句 */
  intentStarters: Map<string, string[]>;
  /** 每個意圖的常用結尾句 */
  intentEnders: Map<string, string[]>;
  /** 連接詞/轉折詞庫 */
  connectors: string[];
  totalTokens: number;
}

export function createNgramModel(): NgramModel {
  const model: NgramModel = {
    bigrams: new Map(),
    trigrams: new Map(),
    intentStarters: new Map(),
    intentEnders: new Map(),
    connectors: [
      '另外',
      '此外',
      '而且',
      '不過',
      '但是',
      '所以',
      '接下來',
      '最後',
      '首先',
      '然後',
      '總結來說',
      '建議你',
      '你可以',
      '如果你',
      '記得',
    ],
    totalTokens: 0,
  };

  // 預設每個意圖的開頭句和結尾句
  const defaultStarters: Record<string, string[]> = {
    greeting: ['你好！', '嗨！', '哈囉！'],
    academic: ['關於你的課程，', '讓我查看你的課表，', '根據你的課程資料，'],
    assignment: ['關於作業的部分，', '讓我幫你看看待繳作業，', '目前你的作業狀況：'],
    grades: ['關於成績方面，', '根據你目前的學習狀況，'],
    dining: ['今天的餐點推薦：', '讓我看看有什麼好吃的，', '根據菜單資料，'],
    navigation: ['關於你要去的地方，', '讓我幫你找路線，'],
    event: ['近期有以下活動：', '校園活動資訊：'],
    library: ['圖書館相關資訊：', '關於圖書館服務，'],
    health: ['關於你的健康問題，', '聽起來你身體不太舒服，'],
    emotion: ['聽起來你最近', '我理解你的感受，'],
  };

  const defaultEnders: Record<string, string[]> = {
    general: ['還有什麼需要幫忙的嗎？', '有其他問題隨時問我。', '希望這有幫助！'],
    academic: ['如果需要更詳細的資訊，可以再問我。', '加油！'],
    dining: ['祝用餐愉快！', '要看其他餐廳的選擇嗎？'],
    health: ['祝你早日康復！', '記得多休息。', '如果症狀持續，建議去看醫生。'],
    emotion: ['你不是一個人面對。', '有需要的話學校諮商中心可以幫助你。', '希望你快點好起來。'],
  };

  for (const [intent, starters] of Object.entries(defaultStarters)) {
    model.intentStarters.set(intent, starters);
  }
  for (const [intent, enders] of Object.entries(defaultEnders)) {
    model.intentEnders.set(intent, enders);
  }

  return model;
}

/** 訓練 N-gram model（從一個好回答學習） */
export function trainNgramOnResponse(model: NgramModel, response: string, intent: string): void {
  // 斷句
  const sentences = response.split(/[。！？\n]/).filter((s) => s.trim().length > 0);

  // 學習開頭句和結尾句
  if (sentences.length > 0) {
    const starters = model.intentStarters.get(intent) ?? [];
    const firstSent = sentences[0].trim();
    if (firstSent.length <= 30 && !starters.includes(firstSent)) {
      starters.push(firstSent);
      // 保留最多 10 個
      while (starters.length > 10) starters.shift();
      model.intentStarters.set(intent, starters);
    }

    const enders = model.intentEnders.get(intent) ?? model.intentEnders.get('general') ?? [];
    const lastSent = sentences[sentences.length - 1].trim();
    if (lastSent.length <= 30 && !enders.includes(lastSent)) {
      enders.push(lastSent);
      while (enders.length > 10) enders.shift();
      model.intentEnders.set(intent, enders);
    }
  }

  // 訓練 character-level bigram/trigram（中文沒有空格，用字元做）
  const chars = response.replace(/\s+/g, '').split('');
  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i];
    const b = chars[i + 1];

    if (!model.bigrams.has(a)) model.bigrams.set(a, new Map());
    const biNext = model.bigrams.get(a)!;
    biNext.set(b, (biNext.get(b) ?? 0) + 1);

    if (i < chars.length - 2) {
      const c = chars[i + 2];
      const key = `${a}|${b}`;
      if (!model.trigrams.has(key)) model.trigrams.set(key, new Map());
      const triNext = model.trigrams.get(key)!;
      triNext.set(c, (triNext.get(c) ?? 0) + 1);
    }

    model.totalTokens++;
  }
}

/** 用 N-gram 延續一個前綴文本 */
export function generateWithNgram(
  model: NgramModel,
  prefix: string,
  maxLen = 60,
  temperature = 0.7,
): string {
  if (model.totalTokens < 100) return ''; // 訓練不足

  const result = prefix;
  const chars = result.split('');

  for (let step = 0; step < maxLen; step++) {
    const len = chars.length;
    let nextChar: string | null = null;

    // 先試 trigram
    if (len >= 2) {
      const key = `${chars[len - 2]}|${chars[len - 1]}`;
      const candidates = model.trigrams.get(key);
      if (candidates && candidates.size > 0) {
        nextChar = sampleFromDist(candidates, temperature);
      }
    }

    // fallback to bigram
    if (!nextChar && len >= 1) {
      const candidates = model.bigrams.get(chars[len - 1]);
      if (candidates && candidates.size > 0) {
        nextChar = sampleFromDist(candidates, temperature);
      }
    }

    if (!nextChar) break;

    chars.push(nextChar);
    // 遇到句號或問號就停
    if (/[。！？]/.test(nextChar)) break;
  }

  return chars.join('');
}

/** 從分佈中採樣（帶溫度控制） */
function sampleFromDist(dist: Map<string, number>, temperature: number): string | null {
  const entries = Array.from(dist.entries());
  if (entries.length === 0) return null;

  // 溫度調整
  const adjusted = entries.map(([k, v]) => [k, Math.pow(v, 1 / temperature)] as [string, number]);
  const total = adjusted.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return entries[0][0];

  let r = Math.random() * total;
  for (const [k, v] of adjusted) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// ═══════════════════════════════════════════════════
// 6. Q-Learning Reward Model — 強化學習
// ═══════════════════════════════════════════════════

export interface RewardModel {
  /** 狀態-動作 Q 值表（用意圖+回答策略的 hash） */
  qTable: Map<string, number>;
  /** 探索率（epsilon-greedy） */
  epsilon: number;
  /** 學習率 */
  alpha: number;
  /** 折扣因子 */
  gamma: number;
  /** 總訓練步數 */
  steps: number;
  /** 策略表現追蹤 */
  strategyRewards: Map<string, { total: number; count: number }>;
}

/** 回答策略 */
export type ResponseStrategy =
  | 'direct_answer' // 直接回答
  | 'list_format' // 列表格式
  | 'suggestion_with_data' // 帶數據的建議
  | 'empathy_first' // 先表達共感
  | 'step_by_step' // 分步驟說明
  | 'comparison' // 比較分析
  | 'brief' // 簡短回答
  | 'detailed'; // 詳細說明

const ALL_STRATEGIES: ResponseStrategy[] = [
  'direct_answer',
  'list_format',
  'suggestion_with_data',
  'empathy_first',
  'step_by_step',
  'comparison',
  'brief',
  'detailed',
];

export function createRewardModel(): RewardModel {
  return {
    qTable: new Map(),
    epsilon: 0.3, // 初始 30% 探索
    alpha: 0.15,
    gamma: 0.9,
    steps: 0,
    strategyRewards: new Map(),
  };
}

/** 狀態 hash：意圖 + 情緒 + 主題延續性 */
function stateHash(intent: IntentLabel, mood: number, continuity: number): string {
  const moodBucket = mood < -0.3 ? 'neg' : mood > 0.3 ? 'pos' : 'neu';
  const contBucket = continuity <= 1 ? 'new' : 'cont';
  return `${intent}|${moodBucket}|${contBucket}`;
}

/** Q(s, a) 查詢 */
function getQ(model: RewardModel, state: string, strategy: ResponseStrategy): number {
  return model.qTable.get(`${state}::${strategy}`) ?? 0;
}

/** 選擇最佳策略（epsilon-greedy + UCB） */
export function selectStrategy(
  model: RewardModel,
  intent: IntentLabel,
  mood: number,
  continuity: number,
): ResponseStrategy {
  const state = stateHash(intent, mood, continuity);

  // Epsilon-greedy exploration（epsilon 隨訓練逐漸衰減）
  const currentEpsilon = Math.max(0.05, model.epsilon * Math.pow(0.995, model.steps));
  if (Math.random() < currentEpsilon) {
    return ALL_STRATEGIES[Math.floor(Math.random() * ALL_STRATEGIES.length)];
  }

  // UCB1 探索加成
  const totalVisits = model.steps + 1;
  let bestStrategy = ALL_STRATEGIES[0];
  let bestScore = -Infinity;

  for (const strategy of ALL_STRATEGIES) {
    const q = getQ(model, state, strategy);
    const stats = model.strategyRewards.get(`${state}::${strategy}`);
    const visits = stats?.count ?? 0;

    // UCB1: Q(s,a) + c * sqrt(ln(N) / n_a)
    const exploration = visits === 0 ? 10 : 1.5 * Math.sqrt(Math.log(totalVisits) / visits);
    const score = q + exploration;

    if (score > bestScore) {
      bestScore = score;
      bestStrategy = strategy;
    }
  }

  return bestStrategy;
}

/** 更新 Q 值（從用戶回饋學習） */
export function updateReward(
  model: RewardModel,
  intent: IntentLabel,
  mood: number,
  continuity: number,
  strategy: ResponseStrategy,
  reward: number, // +1 正面, -1 負面
): RewardModel {
  const state = stateHash(intent, mood, continuity);
  const key = `${state}::${strategy}`;

  // Q-learning update: Q(s,a) ← Q(s,a) + α * (reward - Q(s,a))
  const oldQ = getQ(model, state, strategy);
  const newQ = oldQ + model.alpha * (reward - oldQ);

  const newQTable = new Map(model.qTable);
  newQTable.set(key, newQ);

  // 更新策略統計
  const newStrategyRewards = new Map(model.strategyRewards);
  const stats = newStrategyRewards.get(key) ?? { total: 0, count: 0 };
  newStrategyRewards.set(key, { total: stats.total + reward, count: stats.count + 1 });

  return {
    ...model,
    qTable: newQTable,
    strategyRewards: newStrategyRewards,
    steps: model.steps + 1,
    epsilon: Math.max(0.05, model.epsilon * 0.995),
  };
}

// ═══════════════════════════════════════════════════
// 7. Attention-based Response Composer — 注意力回答生成
// ═══════════════════════════════════════════════════

export interface ResponseCandidate {
  text: string;
  score: number;
  source: 'template' | 'local_handler' | 'ngram' | 'similar_qa';
  strategy: ResponseStrategy;
}

/** 注意力加權的回答組合器 */
export function composeResponse(
  candidates: ResponseCandidate[],
  strategy: ResponseStrategy,
  intent: IntentLabel,
  ngramModel: NgramModel,
  dialogCtx: DialogContext,
): string {
  if (candidates.length === 0) return '';

  // 根據策略過濾和排序候選
  const strategyFiltered = candidates
    .filter((c) => c.strategy === strategy || c.strategy === 'direct_answer')
    .sort((a, b) => b.score - a.score);

  // 如果沒有匹配策略的候選，用所有候選
  const pool =
    strategyFiltered.length > 0 ? strategyFiltered : candidates.sort((a, b) => b.score - a.score);

  // 選最佳主要候選
  const primary = pool[0];
  let response = primary.text;

  // 根據策略修飾回答
  switch (strategy) {
    case 'empathy_first': {
      if (dialogCtx.userMood < -0.2 && !/聽起來|理解|辛苦/.test(response)) {
        const empathyPrefixes = ['我理解你的感受。', '這確實不容易。', '聽起來你最近辛苦了。'];
        const prefix = empathyPrefixes[Math.floor(Math.random() * empathyPrefixes.length)];
        response = `${prefix}\n\n${response}`;
      }
      break;
    }

    case 'brief': {
      // 壓縮到 2-3 句
      const sentences = response.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
      if (sentences.length > 3) {
        response = sentences.slice(0, 3).join('。') + '。';
      }
      break;
    }

    case 'detailed': {
      // 如果太短，嘗試從次要候選擴充
      if (response.length < 80 && pool.length > 1) {
        const supplement = pool[1].text;
        if (!response.includes(supplement.slice(0, 20))) {
          const connector =
            ngramModel.connectors[Math.floor(Math.random() * ngramModel.connectors.length)];
          response = `${response}\n\n${connector}，${supplement}`;
        }
      }
      break;
    }

    case 'step_by_step': {
      // 如果不是列表形式，重新排版
      if (!/\d+[\.\、]/.test(response) && response.length > 40) {
        const sentences = response.split(/[。\n]/).filter((s) => s.trim().length > 3);
        if (sentences.length >= 2) {
          response = sentences.map((s, i) => `${i + 1}. ${s.trim()}`).join('\n');
        }
      }
      break;
    }
  }

  // 根據用戶風格調整
  if (dialogCtx.userStyle.prefersShort && response.length > 150) {
    // 用戶喜歡簡短 → 壓縮
    const sentences = response.split(/[。！？\n]/).filter((s) => s.trim().length > 0);
    if (sentences.length > 4) {
      response = sentences.slice(0, 3).join('。') + '。';
    }
  }

  // 根據情緒選擇結尾
  if (dialogCtx.userMood < -0.3) {
    // 負面情緒 → 溫暖結尾
    const warmEnders = [
      '如果需要幫忙隨時說。',
      '我在這��，有什麼都可��問。',
      '別擔心，我們一起解決。',
    ];
    const ender = warmEnders[Math.floor(Math.random() * warmEnders.length)];
    if (response.length < 300 && !response.includes(ender.slice(0, 4))) {
      response = `${response}\n\n${ender}`;
    }
  } else if (dialogCtx.topicContinuity <= 1) {
    // 新話題的第一輪 → 加引導結尾
    const enders =
      ngramModel.intentEnders.get(intent) ?? ngramModel.intentEnders.get('general') ?? [];
    if (enders.length > 0 && response.length < 300) {
      const ender = enders[Math.floor(Math.random() * enders.length)];
      if (!response.includes(ender.slice(0, 8))) {
        response = `${response}\n\n${ender}`;
      }
    }
  }
  // 持續話題 → 不加結尾（避免每次都���「還有什麼需要幫忙的嗎」）

  // 如果用戶喜歡用 emoji，加一些溫度
  if (dialogCtx.userStyle.usesEmoji && response.length < 200) {
    if (!response.includes('！')) {
      response = response.replace(/。$/, '！');
    }
  }

  return response;
}

// ═══════════════════════════════════════════════════
// 8a. TF-IDF + Semantic Hybrid Retrieval — 混合檢索
// ═══════════════════════════════════════════════════

/** TF-IDF 文件索引 */
export interface TFIDFIndex {
  docs: Array<{ id: string; tokens: string[]; raw: string; intent: IntentLabel }>;
  idf: Map<string, number>;
  docFreq: Map<string, number>;
  totalDocs: number;
}

export function createTFIDFIndex(): TFIDFIndex {
  return { docs: [], idf: new Map(), docFreq: new Map(), totalDocs: 0 };
}

/** 將一筆 Q&A 加入 TF-IDF 索引 */
export function indexDocument(
  idx: TFIDFIndex,
  id: string,
  text: string,
  tokens: string[],
  intent: IntentLabel,
): void {
  idx.docs.push({ id, tokens, raw: text, intent });
  idx.totalDocs++;

  // 更新文檔頻率
  const seen = new Set<string>();
  for (const t of tokens) {
    if (!seen.has(t)) {
      idx.docFreq.set(t, (idx.docFreq.get(t) ?? 0) + 1);
      seen.add(t);
    }
  }

  // 重算 IDF
  for (const [term, df] of idx.docFreq) {
    idx.idf.set(term, Math.log((idx.totalDocs + 1) / (df + 1)) + 1);
  }
}

/** 計算 TF-IDF 向量的餘弦相似度 */
function tfidfSimilarity(
  queryTokens: string[],
  docTokens: string[],
  idf: Map<string, number>,
): number {
  const qTF = new Map<string, number>();
  for (const t of queryTokens) qTF.set(t, (qTF.get(t) ?? 0) + 1);
  const dTF = new Map<string, number>();
  for (const t of docTokens) dTF.set(t, (dTF.get(t) ?? 0) + 1);

  let dot = 0,
    normQ = 0,
    normD = 0;
  const allTerms = new Set([...queryTokens, ...docTokens]);

  for (const t of allTerms) {
    const idfVal = idf.get(t) ?? 1;
    const qW = (qTF.get(t) ?? 0) * idfVal;
    const dW = (dTF.get(t) ?? 0) * idfVal;
    dot += qW * dW;
    normQ += qW * qW;
    normD += dW * dW;
  }

  const denom = Math.sqrt(normQ) * Math.sqrt(normD);
  return denom > 0 ? dot / denom : 0;
}

/** 混合檢索結果 */
export interface RetrievalResult {
  id: string;
  raw: string;
  intent: IntentLabel;
  tfidfScore: number;
  semanticScore: number;
  fusedScore: number; // RRF 融合分數
}

/** Reciprocal Rank Fusion (RRF) — 融合多路排名 */
function rrfFuse(ranks: number[][], k = 60): number[] {
  const n = ranks[0]?.length ?? 0;
  const scores = new Array(n).fill(0);
  for (const ranking of ranks) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const docIdx = ranking[rank];
      scores[docIdx] += 1.0 / (k + rank + 1);
    }
  }
  return scores;
}

/** 混合檢索：TF-IDF + 語意 → RRF 融合 */
export function hybridRetrieve(
  query: string,
  queryTokens: string[],
  idx: TFIDFIndex,
  embedding: EmbeddingModel,
  topK = 5,
  intentFilter?: IntentLabel,
): RetrievalResult[] {
  if (idx.docs.length === 0) return [];

  const candidates = intentFilter ? idx.docs.filter((d) => d.intent === intentFilter) : idx.docs;

  if (candidates.length === 0) return [];

  // TF-IDF 分數
  const tfidfScores = candidates.map((d) => tfidfSimilarity(queryTokens, d.tokens, idx.idf));

  // 語意分數（詞向量）
  const queryEmbed = sentenceEmbedding(embedding, queryTokens);
  const semScores = candidates.map((d) => {
    const docEmbed = sentenceEmbedding(embedding, d.tokens);
    return vecCosine(queryEmbed, docEmbed);
  });

  // 各自排名
  const tfidfRank = tfidfScores.map((_, i) => i).sort((a, b) => tfidfScores[b] - tfidfScores[a]);
  const semRank = semScores.map((_, i) => i).sort((a, b) => semScores[b] - semScores[a]);

  // RRF 融合
  const fusedScores = rrfFuse([tfidfRank, semRank]);

  // 排序並返回 top-K
  const results: RetrievalResult[] = candidates
    .map((d, i) => ({
      id: d.id,
      raw: d.raw,
      intent: d.intent,
      tfidfScore: tfidfScores[i],
      semanticScore: semScores[i],
      fusedScore: fusedScores[i],
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);

  return results;
}

// ═══════════════════════════════════════════════════
// 8b. Fuzzy Match — 模糊匹配 + 錯字容忍
// ═══════════════════════════════════════════════════

/** Levenshtein 編輯距離（支援中文） */
export function editDistance(a: string, b: string): number {
  const la = a.length,
    lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // 使用一維陣列優化空間
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // 刪除
        curr[j - 1] + 1, // 插入
        prev[j - 1] + cost, // 替換
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/** 注音/形近字映射表（常見易混淆） */
const SIMILAR_CHARS: Record<string, string[]> = {
  的: ['得', '地'],
  得: ['的', '地'],
  地: ['的', '得'],
  在: ['再'],
  再: ['在'],
  做: ['作'],
  作: ['做'],
  那: ['哪'],
  哪: ['那'],
  他: ['她', '它'],
  她: ['他', '它'],
  及: ['級', '極', '集'],
  級: ['及', '極'],
  須: ['需'],
  需: ['須'],
  園: ['院', '原'],
  院: ['園', '源'],
  坐: ['座'],
  座: ['坐'],
  練: ['煉'],
  像: ['象', '想'],
  帳: ['賬', '帳'],
  份: ['分'],
  分: ['份'],
};

/** 形近字規範化 */
function normalizeConfusables(text: string): string {
  // 不修改原文，只用於匹配
  return text;
}

/** 模糊匹配：在詞庫中找最接近的詞 */
export function fuzzyMatch(
  input: string,
  candidates: string[],
  maxDistance = 2,
): Array<{ text: string; distance: number; similarity: number }> {
  const results: Array<{ text: string; distance: number; similarity: number }> = [];

  for (const c of candidates) {
    // 精確匹配
    if (input === c) {
      results.push({ text: c, distance: 0, similarity: 1.0 });
      continue;
    }

    // 包含匹配
    if (c.includes(input) || input.includes(c)) {
      const longer = Math.max(c.length, input.length);
      const shorter = Math.min(c.length, input.length);
      results.push({ text: c, distance: longer - shorter, similarity: shorter / longer });
      continue;
    }

    // 編輯距離
    const dist = editDistance(input, c);
    if (dist <= maxDistance) {
      const maxLen = Math.max(input.length, c.length);
      results.push({ text: c, distance: dist, similarity: 1 - dist / maxLen });
    }

    // 形近字替換後再比較
    for (let i = 0; i < input.length; i++) {
      const alts = SIMILAR_CHARS[input[i]];
      if (alts) {
        for (const alt of alts) {
          const variant = input.slice(0, i) + alt + input.slice(i + 1);
          if (variant === c) {
            results.push({ text: c, distance: 1, similarity: 0.9 });
          }
        }
      }
    }
  }

  return results
    .filter((r, i, arr) => arr.findIndex((x) => x.text === r.text) === i)
    .sort((a, b) => a.distance - b.distance || b.similarity - a.similarity);
}

/** 模糊意圖修正：如果意圖分類信心不足，用模糊匹配嘗試修正 */
export function fuzzyIntentCorrection(
  tokens: string[],
  result: IntentResult,
  keywordBoosts: Map<string, Map<string, number>>,
): IntentResult {
  if (result.confidence > 0.6) return result; // 信心足夠，不修正

  const rawText = tokens.join('');
  let bestIntent = result.intent;
  let bestBoost = 0;

  for (const [intent, kmap] of keywordBoosts) {
    const keywords = Array.from(kmap.keys());
    for (const word of keywords) {
      // 用模糊匹配看用戶是否打了近似詞
      const matches = fuzzyMatch(rawText, [word], 1);
      if (matches.length > 0 && matches[0].similarity >= 0.7) {
        const boost = kmap.get(word) ?? 0;
        if (boost > bestBoost) {
          bestBoost = boost;
          bestIntent = intent as IntentLabel;
        }
      }
    }
  }

  if (bestIntent !== result.intent && bestBoost > 0) {
    return {
      intent: bestIntent,
      confidence: Math.max(result.confidence, 0.55),
      topK: result.topK,
    };
  }

  return result;
}

// ═══════════════════════════════════════════════════
// 8c. Conversation Summarizer — 對話摘要壓縮
// ═══════════════════════════════════════════════════

/** 結構化對話摘要 */
export interface ConversationSummary {
  topicsCovered: IntentLabel[];
  keyFacts: string[]; // 關鍵事實（用戶提到的具體事物）
  userPreferences: string[]; // 使用者偏好
  unresolved: string[]; // 尚未解答的問題
  overallMood: number;
  turnCount: number;
  compressedAt: number; // 壓縮時的 turn index
}

/** 將長對話壓縮成結構化摘要 */
export function summarizeConversation(ctx: DialogContext): ConversationSummary {
  const topicsCovered = [...new Set(ctx.topicHistory)] as IntentLabel[];

  const keyFacts: string[] = [];
  const userPreferences: string[] = [];
  const unresolved: string[] = [];

  // 從槽位提取用戶偏好
  for (const slot of ctx.slots) {
    if (slot.source === 'user') {
      userPreferences.push(`${slot.name}: ${slot.value}`);
    }
  }

  // 從實體提取關鍵事實
  const entityGroups = new Map<string, string[]>();
  for (const e of ctx.mentionedEntities) {
    const group = entityGroups.get(e.type) ?? [];
    if (!group.includes(e.text)) group.push(e.text);
    entityGroups.set(e.type, group);
  }
  for (const [type, items] of entityGroups) {
    keyFacts.push(`提到的${type}: ${items.slice(-5).join('、')}`);
  }

  // 從短期記憶提取
  for (const mem of ctx.shortTermMemory) {
    keyFacts.push(`${mem.key}: ${mem.value.slice(0, 50)}`);
  }

  // 找出可能未解答的問題（用戶的最後幾個問句）
  const recentUserTurns = ctx.turns.filter((t) => t.role === 'user').slice(-3);
  for (const turn of recentUserTurns) {
    if (/[？?]$/.test(turn.content.trim()) || /嗎|呢|怎麼|如何|什麼/.test(turn.content)) {
      // 檢查後面是否有助理回答
      const turnIdx = ctx.turns.indexOf(turn);
      const nextAsst = ctx.turns.slice(turnIdx + 1).find((t) => t.role === 'assistant');
      if (!nextAsst || nextAsst.content.length < 10) {
        unresolved.push(turn.content.slice(0, 60));
      }
    }
  }

  return {
    topicsCovered,
    keyFacts: keyFacts.slice(-15),
    userPreferences: userPreferences.slice(-10),
    unresolved,
    overallMood: ctx.userMood,
    turnCount: ctx.turns.length,
    compressedAt: ctx.turns.length,
  };
}

/** 將摘要轉為文字（注入到 Gemini 系統提示） */
export function summaryToText(summary: ConversationSummary): string {
  const parts: string[] = [];

  if (summary.topicsCovered.length > 0) {
    parts.push(
      `[對話歷程: 已聊過 ${summary.topicsCovered.join('→')} 等主題, 共 ${summary.turnCount} 輪]`,
    );
  }

  if (summary.keyFacts.length > 0) {
    parts.push(`[關鍵事實: ${summary.keyFacts.slice(-5).join('; ')}]`);
  }

  if (summary.userPreferences.length > 0) {
    parts.push(`[使用者偏好: ${summary.userPreferences.join(', ')}]`);
  }

  if (summary.unresolved.length > 0) {
    parts.push(`[未解答: ${summary.unresolved.join('; ')}]`);
  }

  return parts.join(' ');
}

/** 當對話過長時自動壓縮（保留最近 N 輪 + 摘要） */
export function compressDialogIfNeeded(
  ctx: DialogContext,
  maxTurns = 20,
): {
  ctx: DialogContext;
  summary: ConversationSummary | null;
} {
  if (ctx.turns.length <= maxTurns) return { ctx, summary: null };

  const summary = summarizeConversation(ctx);

  // 保留最近的 maxTurns/2 輪
  const keepCount = Math.floor(maxTurns / 2);
  const recentTurns = ctx.turns.slice(-keepCount);

  // 將摘要存入短期記憶
  const summaryMem: ContextMemoryItem = {
    key: 'conversation_summary',
    value: summaryToText(summary),
    intent: ctx.currentTopic ?? 'general',
    turnIndex: ctx.turns.length,
    expiresAfterTurns: 0, // 不過期
  };

  return {
    ctx: {
      ...ctx,
      turns: recentTurns,
      shortTermMemory: [...ctx.shortTermMemory.slice(-8), summaryMem],
    },
    summary,
  };
}

// ═══════════════════════════════════════════════════
// 8d. Self-Supervised Auto Training — 自動從對話學習
// ═══════════════════════════════════════════════════

/** 從一輪成功的對話自動學習（無需明確回饋） */
export function autoLearnFromTurn(
  brain: LocalAIBrain,
  userText: string,
  assistantText: string,
  intent: IntentLabel,
  wasHelpful: boolean, // 由啟發式規則判斷
): void {
  const userTokens = advancedTokenize(userText);
  const asstTokens = advancedTokenize(assistantText);

  // 1. 總是從用戶輸入學習詞向量（上下文共現）
  if (userTokens.length >= 2) {
    trainEmbeddingOnSentence(brain.embedding, userTokens, 0.003);
  }

  // 2. 如果看起來有幫助，從回答學習 N-gram
  if (wasHelpful && assistantText.length > 15) {
    trainNgramOnResponse(brain.ngramModel, assistantText, intent);
  }

  // 3. 如果意圖明確，強化分類器
  if (wasHelpful) {
    trainClassifier(userTokens, intent, brain.embedding, brain.classifier, 0.03);
  }

  // 4. 學習用戶-助理的跨語句詞向量關聯
  //    讓問題和回答中的詞更接近（bridging）
  if (wasHelpful && userTokens.length > 0 && asstTokens.length > 0) {
    const bridgeTokens = [...userTokens.slice(0, 3), ...asstTokens.slice(0, 3)];
    trainEmbeddingOnSentence(brain.embedding, bridgeTokens, 0.002);
  }
}

/** 啟發式判斷一輪對話是否「有幫助」 */
export function heuristicHelpful(
  userText: string,
  assistantText: string,
  nextUserText?: string,
): boolean {
  // 正面信號
  if (nextUserText) {
    // 用戶說謝謝 → 有幫助
    if (/謝|感謝|太好了|讚|不錯|厲害|幫大忙|好的/.test(nextUserText)) return true;
    // 用戶問了後續問題（追問）→ 有參與感 → 可能有幫助
    if (nextUserText.length < 20 && /呢|嗎|還有|怎麼|那/.test(nextUserText)) return true;
    // 用戶說不對/不是 → 沒幫助
    if (/不對|不是|錯了|答非所問|看不懂/.test(nextUserText)) return false;
  }

  // 回答太短可能不好
  if (assistantText.length < 10) return false;
  // 回答包含「抱歉」「無法」→ 可能失敗
  if (/抱歉|無法|不確定|我不知道/.test(assistantText)) return false;

  // 默認：有基本回答就算有幫助
  return assistantText.length >= 15;
}

// ═══════════════════════════════════════════════════
// 8e. Multi-Head Attention Context Fusion — 多頭注意力
// ═══════════════════════════════════════════════════

/** 上下文信號源（模擬 Transformer 的多頭注意力） */
export interface ContextSignal {
  name: string;
  vector: Float32Array; // 投影到 EMBED_DIM
  weight: number; // 學習到的重要性權重
}

/** 多頭注意力融合器 */
export interface AttentionFuser {
  headWeights: Map<string, number>; // 每個信號源的注意力權重
  numHeads: number;
  dim: number;
}

export function createAttentionFuser(): AttentionFuser {
  return {
    headWeights: new Map([
      ['entity', 1.0],
      ['slot', 1.2],
      ['memory', 0.8],
      ['mood', 0.6],
      ['topic', 1.5],
    ]),
    numHeads: 4,
    dim: EMBED_DIM,
  };
}

/** 將各種上下文信號投影為向量 */
function signalToVector(
  signalName: string,
  ctx: DialogContext,
  embedding: EmbeddingModel,
): Float32Array {
  const vec = new Float32Array(EMBED_DIM);

  switch (signalName) {
    case 'entity': {
      // 最近實體的平均嵌入
      const recentEntities = ctx.mentionedEntities.slice(-5);
      for (const e of recentEntities) {
        const eVec = sentenceEmbedding(embedding, advancedTokenize(e.text));
        vecAdd(vec, eVec, 1.0 / Math.max(recentEntities.length, 1));
      }
      break;
    }
    case 'slot': {
      // 活躍槽位值的嵌入
      for (const slot of ctx.slots) {
        const sVec = sentenceEmbedding(embedding, advancedTokenize(slot.value));
        vecAdd(vec, sVec, slot.confidence / Math.max(ctx.slots.length, 1));
      }
      break;
    }
    case 'memory': {
      // 短期記憶的嵌入
      const recentMem = ctx.shortTermMemory.slice(-3);
      for (const m of recentMem) {
        const mVec = sentenceEmbedding(embedding, advancedTokenize(m.value));
        vecAdd(vec, mVec, 1.0 / Math.max(recentMem.length, 1));
      }
      break;
    }
    case 'mood': {
      // 情緒向量（用簡單的正負方向）
      const moodSeed =
        ctx.userMood > 0.2 ? '開心滿意' : ctx.userMood < -0.2 ? '不滿煩躁' : '平靜中性';
      const mVec = sentenceEmbedding(embedding, advancedTokenize(moodSeed));
      vecAdd(vec, mVec, Math.abs(ctx.userMood));
      break;
    }
    case 'topic': {
      // 當前主題向量
      if (ctx.currentTopic) {
        const tVec = sentenceEmbedding(embedding, advancedTokenize(ctx.currentTopic));
        vecAdd(vec, tVec, 1.0);
      }
      break;
    }
  }

  return vec;
}

/** 多頭注意力融合：將查詢向量與所有上下文信號融合 */
export function fuseContextWithAttention(
  queryVec: Float32Array,
  ctx: DialogContext,
  embedding: EmbeddingModel,
  fuser: AttentionFuser,
): Float32Array {
  const result = new Float32Array(EMBED_DIM);
  vecAdd(result, queryVec, 1.0); // 起始 = 查詢本身

  const signalNames = ['entity', 'slot', 'memory', 'mood', 'topic'];
  const signals: Array<{ name: string; vec: Float32Array }> = [];

  for (const name of signalNames) {
    signals.push({ name, vec: signalToVector(name, ctx, embedding) });
  }

  // 計算注意力分數：score = softmax(Q·K / sqrt(d))
  const scores: number[] = [];
  for (const sig of signals) {
    const rawScore = vecDot(queryVec, sig.vec) / Math.sqrt(EMBED_DIM);
    const headWeight = fuser.headWeights.get(sig.name) ?? 1.0;
    scores.push(rawScore * headWeight);
  }

  // Softmax 歸一化
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - maxScore));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
  const attnWeights = exps.map((e) => e / sumExp);

  // 加權融合: result += sum(attn_i * V_i)
  for (let i = 0; i < signals.length; i++) {
    vecAdd(result, signals[i].vec, attnWeights[i] * 0.5);
  }

  // L2 正規化
  const norm = vecNorm(result);
  if (norm > 0) {
    for (let i = 0; i < result.length; i++) result[i] /= norm;
  }

  return result;
}

/** 根據注意力融合結果調整意圖分類 */
export function attentionAdjustedClassify(
  tokens: string[],
  embedding: EmbeddingModel,
  classifier: ClassifierWeights,
  ctx: DialogContext,
  fuser: AttentionFuser,
): IntentResult {
  // 先做基礎分類
  const baseResult = classifyIntent(tokens, embedding, classifier);

  // 如果信心足夠高，不調整
  if (baseResult.confidence > 0.7) return baseResult;

  // 用注意力融合後的向量重新分類
  const rawVec = sentenceEmbedding(embedding, tokens);
  const fusedVec = fuseContextWithAttention(rawVec, ctx, embedding, fuser);

  // 用融合向量重新計算各意圖分數
  const rawText = tokens.join('');
  const logits: number[] = [];
  const labels: IntentLabel[] = [];

  for (const label of INTENT_LABELS) {
    const centroid = classifier.centroids.get(label);
    const bias = classifier.biases.get(label) ?? 0;

    let logit = centroid ? vecCosine(fusedVec, centroid) : 0;
    logit += bias;

    const boosts = classifier.keywordBoosts.get(label);
    if (boosts) {
      for (const [kw, boost] of boosts) {
        if (rawText.includes(kw)) logit += boost;
      }
    }

    logits.push(logit);
    labels.push(label);
  }

  const probs = softmax(logits);
  const maxIdx = probs.indexOf(Math.max(...probs));

  // 融合基礎結果和注意力結果（加權平均）
  const baseWeight = 0.4;
  const attnWeight = 0.6;
  const finalTopK = labels
    .map((l, i) => ({
      intent: l,
      score:
        baseWeight * (baseResult.topK.find((k) => k.intent === l)?.score ?? 0) +
        attnWeight * probs[i],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const bestIntent = finalTopK[0];

  return {
    intent: bestIntent.intent,
    confidence: bestIntent.score,
    topK: finalTopK,
  };
}

// ═══════════════════════════════════════════════════
// 8f. Advanced Tokenizer — 強化中文斷詞
// ═══════════════════════════════════════════════════

/** 更豐富的領域字典 */
const DOMAIN_DICTIONARY: string[] = [
  // 學術
  '被當',
  '當掉',
  '不及格',
  '二一',
  '退學',
  '延畢',
  '重修',
  '學分',
  '必修',
  '選修',
  '通識',
  '學程',
  '輔系',
  '雙主修',
  '轉學',
  '作業',
  '報告',
  '論文',
  '簡報',
  '小組',
  '分組',
  '期中考',
  '期末考',
  '小考',
  '點名',
  '出席率',
  '教學評量',
  // 生活
  '圖書館',
  '圖書',
  '借書',
  '還書',
  '座位',
  '自習室',
  '討論室',
  '宿舍',
  '寢室',
  '報修',
  '洗衣機',
  '烘衣機',
  '包裹',
  '門禁',
  '室友',
  '餐廳',
  '食堂',
  '午餐',
  '晚餐',
  '早餐',
  '素食',
  '便當',
  '外送',
  '美食',
  '菜單',
  '飲料',
  '點心',
  '公車',
  '校車',
  '停車場',
  '腳踏車',
  'YouBike',
  '火車站',
  '捷運',
  '列印',
  '影印',
  '印表機',
  '掃描',
  // 場所
  '靜宜大學',
  '主顧樓',
  '文興樓',
  '伯鐸樓',
  '至善樓',
  '體育館',
  '操場',
  '游泳池',
  '福利社',
  '書店',
  '保健室',
  '諮商中心',
  '學務處',
  '教務處',
  '總務處',
  // 行政
  '選課',
  '退選',
  '加簽',
  '課表',
  '排課',
  '衝堂',
  '請假',
  '病假',
  '事假',
  '公假',
  '喪假',
  '缺曠',
  '翹課',
  '遲到',
  '獎學金',
  '助學金',
  '工讀',
  '實習',
  '社團',
  '活動',
  '報名',
  '講座',
  '比賽',
  '志工',
  // 情緒
  '壓力',
  '焦慮',
  '難過',
  '憂鬱',
  '崩潰',
  '諮商',
  // 感知
  '頭痛',
  '肚子痛',
  '發燒',
  '感冒',
  '咳嗽',
  '流鼻水',
  '過敏',
  '拉肚子',
  '不舒服',
  '受傷',
  // 天氣
  '天氣',
  '下雨',
  '颱風',
  '地震',
  '溫度',
  // 遺失
  '遺失',
  '失物',
  '撿到',
  '認領',
  // 動作
  '訂餐',
  '點餐',
  '預約',
  '掛號',
  '借閱',
  '查詢',
  '推薦',
  '導航',
  '繳交',
  '提醒',
  '設定',
  '修改',
  '刪除',
  // 校園特有
  '畢業門檻',
  '必修學分',
  '服務學習',
  '體育課',
  '英文門檻',
  '學生證',
  '悠遊卡',
  '校園WiFi',
];

/** 強化版中文斷詞 — 字典最長匹配 + bigram */
export function advancedTokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[？?！!。，、：；\s""''「」（）()\[\]~～…—·・]/g, ' ')
    .trim();
  const tokens: string[] = [];

  // 字典按長度排序（長詞優先）
  const sortedDict = [...DOMAIN_DICTIONARY].sort((a, b) => b.length - a.length);

  let remaining = normalized;

  // 第一輪：最長匹配提取字典詞
  for (const term of sortedDict) {
    while (remaining.includes(term)) {
      tokens.push(term);
      remaining = remaining.replace(term, ' ');
    }
  }

  // 第二輪：英文單詞和數字
  const engNum = remaining.match(/[a-z]+\d*|\d+/g);
  if (engNum) {
    for (const en of engNum) {
      if (en.length >= 1) tokens.push(en);
      remaining = remaining.replace(en, ' ');
    }
  }

  // 第三輪：剩餘中文做 bigram + unigram
  const STOP = new Set([
    '的',
    '了',
    '在',
    '是',
    '我',
    '有',
    '和',
    '就',
    '不',
    '人',
    '都',
    '一',
    '上',
    '也',
    '很',
    '到',
    '說',
    '要',
    '去',
    '你',
    '會',
    '著',
    '看',
    '好',
    '這',
    '他',
    '她',
    '它',
    '嗎',
    '呢',
    '吧',
    '啊',
    '喔',
    '欸',
    '那',
    '什',
    '麼',
    '怎',
    '可',
    '以',
    '請',
    '幫',
    '想',
    '能',
    '把',
    '被',
    '讓',
    '給',
    '跟',
    '對',
    '從',
    '向',
    '為',
    '與',
  ]);

  const chars = remaining
    .replace(/\s+/g, '')
    .split('')
    .filter((c) => c.trim().length > 0);
  for (let i = 0; i < chars.length; i++) {
    // bigram
    if (i < chars.length - 1) {
      const bigram = chars[i] + chars[i + 1];
      if (!STOP.has(chars[i]) || !STOP.has(chars[i + 1])) {
        tokens.push(bigram);
      }
    }
    // unigram（非停用詞）
    if (!STOP.has(chars[i])) {
      tokens.push(chars[i]);
    }
  }

  return tokens.filter((t) => t.length > 0);
}

// ═══════════════════════════════════════════════════
// 9. Chain-of-Thought Reasoning — 思維鏈推理引擎
// ═══════════════════════════════════════════════════

/** 推理步驟 */
export interface ReasoningStep {
  type: 'decompose' | 'retrieve' | 'infer' | 'verify' | 'synthesize';
  description: string;
  input: string;
  output: string;
  confidence: number;
}

/** 推理鏈結果 */
export interface ReasoningChain {
  question: string;
  steps: ReasoningStep[];
  finalAnswer: string;
  totalConfidence: number;
  strategy: 'simple' | 'multi_step' | 'comparative' | 'conditional' | 'temporal';
}

/** 推論規則（知識圖譜） */
export interface InferenceRule {
  id: string;
  condition: string[]; // 前提條件（關鍵字模式）
  conclusion: string; // 推論結論
  domain: IntentLabel;
  confidence: number;
}

/** 校園知識推論規則庫 */
const INFERENCE_RULES: InferenceRule[] = [
  // 學業推論
  {
    id: 'r1',
    condition: ['被當', '必修'],
    conclusion: '必修被當需要重修，否則無法畢業',
    domain: 'academic',
    confidence: 0.95,
  },
  {
    id: 'r2',
    condition: ['二一'],
    conclusion: '一學期超過 2/3 學分不及格會被退學預警（二一）',
    domain: 'academic',
    confidence: 0.95,
  },
  {
    id: 'r3',
    condition: ['延畢'],
    conclusion: '超過修業年限未完成學分或畢業門檻會延畢，需向教務處申請',
    domain: 'graduation',
    confidence: 0.9,
  },
  {
    id: 'r4',
    condition: ['衝堂'],
    conclusion: '兩門課時間重疊無法同時選，需擇一或找其他時段',
    domain: 'academic',
    confidence: 0.95,
  },
  {
    id: 'r5',
    condition: ['加簽'],
    conclusion: '選課額滿需到第一堂課找老師加簽，需準備加簽單',
    domain: 'academic',
    confidence: 0.9,
  },
  {
    id: 'r6',
    condition: ['缺曠', '扣考'],
    conclusion: '缺曠達一定次數會被扣考或扣分，注意各科規定',
    domain: 'attendance',
    confidence: 0.85,
  },
  {
    id: 'r7',
    condition: ['翹課', '點名'],
    conclusion: '點名未到算缺曠，累積過多會影響成績',
    domain: 'attendance',
    confidence: 0.9,
  },
  {
    id: 'r8',
    condition: ['遲交', '作業'],
    conclusion: '遲交作業通常會扣分，建議先聯繫老師',
    domain: 'assignment',
    confidence: 0.85,
  },

  // 生活推論
  {
    id: 'r10',
    condition: ['下雨', '沒帶傘'],
    conclusion: '可以到圖書館或便利商店暫避，或借傘',
    domain: 'weather',
    confidence: 0.8,
  },
  {
    id: 'r11',
    condition: ['頭痛', '發燒'],
    conclusion: '可能是感冒或發燒，建議先去保健室量體溫',
    domain: 'health',
    confidence: 0.85,
  },
  {
    id: 'r12',
    condition: ['肚子痛', '吃壞'],
    conclusion: '可能食物中毒或腸胃炎，建議去保健室或就近診所',
    domain: 'health',
    confidence: 0.85,
  },
  {
    id: 'r13',
    condition: ['壓力', '失眠'],
    conclusion: '建議到諮商中心預約心理諮���，有專業心理師協助',
    domain: 'emotion',
    confidence: 0.9,
  },
  {
    id: 'r14',
    condition: ['包裹', '到了'],
    conclusion: '可以到宿舍收發室或指定地點領取，記得帶學生證',
    domain: 'dormitory',
    confidence: 0.85,
  },
  {
    id: 'r15',
    condition: ['洗��', '壞了'],
    conclusion: '可以在 APP 上報修，或聯繫宿舍管理員',
    domain: 'dormitory',
    confidence: 0.85,
  },

  // 時間推論
  {
    id: 'r20',
    condition: ['期中考', '準備'],
    conclusion: '距離期中考時間建議提前 2 週開始複習，整理筆記和考古題',
    domain: 'academic',
    confidence: 0.8,
  },
  {
    id: 'r21',
    condition: ['選課', '什麼時候'],
    conclusion: '選課時間依教務處公告，通常在學期末或開學前，可查教務系統',
    domain: 'academic',
    confidence: 0.85,
  },
  {
    id: 'r22',
    condition: ['畢業', '門檻'],
    conclusion: '畢業門檻包括必修學分、英文門檻、服務學習等，可在教務系統查看',
    domain: 'graduation',
    confidence: 0.9,
  },

  // 條件推論
  {
    id: 'r30',
    condition: ['餓', '沒錢'],
    conclusion: '學生餐廳有平價選���，或可申請急難救助金',
    domain: 'dining',
    confidence: 0.7,
  },
  {
    id: 'r31',
    condition: ['生病', '請假'],
    conclusion: '需要填寫請假單並附上醫療證明，透過學務系統申請',
    domain: 'attendance',
    confidence: 0.9,
  },
  {
    id: 'r32',
    condition: ['遺失', '學生證'],
    conclusion: '到學務處申請補發，需準備照片和工本費',
    domain: 'lost_found',
    confidence: 0.9,
  },
];

/** 問題複雜度分析 */
function analyzeComplexity(
  text: string,
  tokens: string[],
  entities: NamedEntity[],
): {
  complexity: 'simple' | 'moderate' | 'complex';
  requiresReasoning: boolean;
  subQuestions: string[];
  strategy: ReasoningChain['strategy'];
} {
  const hasComparison = /比較|哪個好|差別|差異|還是|或者|vs/i.test(text);
  const hasCondition = /如果|假如|萬一|要是|除非|的話/.test(text);
  const hasTemporal = /什麼時候|多久|來得及|之前|之後|先.*再/.test(text);
  const hasMultiPart = /而且|另外|還有|同時|順便|以及/.test(text);
  const isWhy = /為什麼|為何|怎麼會|原因/.test(text);
  const isHow = /怎麼辦|怎麼做|如何|步驟|方法/.test(text);

  const subQuestions: string[] = [];
  let strategy: ReasoningChain['strategy'] = 'simple';

  if (hasComparison) {
    strategy = 'comparative';
    // 拆解比較的對象
    const parts = text.split(/比較|還是|或者|vs/i).filter((s) => s.trim().length > 0);
    if (parts.length >= 2) {
      subQuestions.push(`${parts[0].trim()}的特點是什麼？`);
      subQuestions.push(`${parts[1].trim()}的特點是什麼？`);
      subQuestions.push('兩者的差異在哪裡？');
    }
  } else if (hasCondition) {
    strategy = 'conditional';
    const ifParts = text.split(/如果|假如|的話/).filter((s) => s.trim().length > 0);
    if (ifParts.length >= 2) {
      subQuestions.push(`${ifParts[0].trim()}的情況下會怎樣？`);
      subQuestions.push(`具體該怎麼做？`);
    }
  } else if (hasTemporal) {
    strategy = 'temporal';
  } else if (hasMultiPart) {
    strategy = 'multi_step';
    // 拆解多部分問題
    const parts = text.split(/而且|另外|還有|同時|順便|以及/).filter((s) => s.trim().length > 2);
    for (const p of parts) subQuestions.push(p.trim());
  } else if (isHow) {
    strategy = 'multi_step';
    subQuestions.push('需要什麼前置準備？');
    subQuestions.push('具體步驟是什麼？');
    subQuestions.push('需要注意什麼？');
  }

  const score =
    (hasComparison ? 2 : 0) +
    (hasCondition ? 2 : 0) +
    (hasTemporal ? 1 : 0) +
    (hasMultiPart ? 2 : 0) +
    (isWhy ? 1 : 0) +
    (isHow ? 1 : 0) +
    (entities.length > 3 ? 1 : 0) +
    (text.length > 40 ? 1 : 0);

  return {
    complexity: score >= 4 ? 'complex' : score >= 2 ? 'moderate' : 'simple',
    requiresReasoning: score >= 2,
    subQuestions,
    strategy,
  };
}

/** 知識圖譜推論：根據用戶訊息觸發推論規則 */
export function inferFromRules(text: string, intent: IntentLabel): InferenceRule[] {
  const triggered: InferenceRule[] = [];

  for (const rule of INFERENCE_RULES) {
    // 所有前提條件都出現在文本中才觸發
    const allMatch = rule.condition.every((cond) => text.includes(cond));
    // 或者 domain 匹配且至少一半條件出現
    const halfMatch =
      rule.domain === intent &&
      rule.condition.filter((c) => text.includes(c)).length >= Math.ceil(rule.condition.length / 2);

    if (allMatch || halfMatch) {
      triggered.push(rule);
    }
  }

  return triggered.sort((a, b) => b.confidence - a.confidence);
}

/** Chain-of-Thought 推理器 */
export function chainOfThought(
  text: string,
  tokens: string[],
  intent: IntentResult,
  entities: NamedEntity[],
  ctx: DialogContext,
  retrievalHits: RetrievalResult[],
): ReasoningChain {
  const steps: ReasoningStep[] = [];
  const complexity = analyzeComplexity(text, tokens, entities);

  // Step 1: 問題分解
  steps.push({
    type: 'decompose',
    description: `分析問題複雜度: ${complexity.complexity}, 策略: ${complexity.strategy}`,
    input: text,
    output:
      complexity.subQuestions.length > 0
        ? `子問題: ${complexity.subQuestions.join(' / ')}`
        : '單一問題，直接處理',
    confidence: 0.9,
  });

  // Step 2: 知識檢索
  if (retrievalHits.length > 0) {
    steps.push({
      type: 'retrieve',
      description: '從知識庫檢索相關資訊',
      input: `查詢: ${text}`,
      output: `找到 ${retrievalHits.length} 筆相關資料，最佳匹配分數: ${retrievalHits[0].fusedScore.toFixed(3)}`,
      confidence: Math.min(retrievalHits[0].fusedScore * 2, 0.95),
    });
  }

  // Step 3: 推論規則觸發
  const inferences = inferFromRules(text, intent.intent);
  if (inferences.length > 0) {
    steps.push({
      type: 'infer',
      description: '觸發知識推論規則',
      input: `規則匹配: ${inferences.map((r) => r.id).join(', ')}`,
      output: inferences.map((r) => r.conclusion).join('；'),
      confidence: inferences[0].confidence,
    });
  }

  // Step 4: 上下文推論
  if (ctx.currentTopic && ctx.topicContinuity > 1) {
    const slotInfo = ctx.slots.map((s) => `${s.name}=${s.value}`).join(', ');
    steps.push({
      type: 'infer',
      description: '結合對話上下文推論',
      input: `主題: ${ctx.currentTopic}, 持續 ${ctx.topicContinuity} 輪, 槽位: ${slotInfo || '無'}`,
      output: `延續 ${ctx.currentTopic} 主題，考慮使用者已提供的資訊`,
      confidence: 0.8,
    });
  }

  // Step 5: 自我驗證
  const totalConf = steps.reduce((s, st) => s + st.confidence, 0) / Math.max(steps.length, 1);
  steps.push({
    type: 'verify',
    description: '自我驗證推理品質',
    input: `推理步驟數: ${steps.length}, 平均信心: ${totalConf.toFixed(2)}`,
    output: totalConf > 0.6 ? '推理品質合格' : '信心不足，建議請求澄清或使用 Gemini',
    confidence: totalConf,
  });

  // Step 6: 合成最終答案方向
  const inferenceConclusions = inferences.map((r) => r.conclusion).join('。');
  const retrievalContext = retrievalHits
    .slice(0, 2)
    .map((h) => h.raw.slice(0, 60))
    .join('; ');
  steps.push({
    type: 'synthesize',
    description: '合成回答方向',
    input: `推論: ${inferenceConclusions || '無'}; 檢索: ${retrievalContext || '無'}`,
    output: inferenceConclusions || retrievalContext || '需要依據本地知識庫生成回答',
    confidence: Math.max(totalConf, 0.5),
  });

  return {
    question: text,
    steps,
    finalAnswer: inferenceConclusions || '',
    totalConfidence: totalConf,
    strategy: complexity.strategy,
  };
}

// ═══════════════════════════════════════════════════
// 10. Gemini Distillation — 從 API 回答蒸餾學習
// ═══════════════════════════════════════════════════

/** 蒸餾記錄 */
export interface DistillationRecord {
  question: string;
  questionTokens: string[];
  answer: string;
  intent: IntentLabel;
  entities: NamedEntity[];
  timestamp: number;
}

/** 蒸餾緩衝區 */
export interface DistillationBuffer {
  records: DistillationRecord[];
  maxSize: number;
  totalDistilled: number;
}

export function createDistillationBuffer(): DistillationBuffer {
  return { records: [], maxSize: 500, totalDistilled: 0 };
}

/** 從 Gemini 回答中蒸餾知識到本地模型 */
export function distillFromGeminiResponse(
  brain: LocalAIBrain,
  question: string,
  geminiAnswer: string,
  intent: IntentLabel,
  entities: NamedEntity[],
): void {
  const qTokens = advancedTokenize(question);
  const aTokens = advancedTokenize(geminiAnswer);

  // 1. 詞向量學習：問題和回答的所��詞
  if (qTokens.length >= 2) trainEmbeddingOnSentence(brain.embedding, qTokens, 0.005);
  if (aTokens.length >= 2) trainEmbeddingOnSentence(brain.embedding, aTokens, 0.005);

  // 2. 跨域橋接：讓問題詞和回答詞在向量空間中靠近
  const bridgeTokens = [...qTokens.slice(0, 5), ...aTokens.slice(0, 5)];
  trainEmbeddingOnSentence(brain.embedding, bridgeTokens, 0.003);

  // 3. 意圖分類器強化
  trainClassifier(qTokens, intent, brain.embedding, brain.classifier, 0.08);

  // 4. N-gram 語言模型學習
  trainNgramOnResponse(brain.ngramModel, geminiAnswer, intent);

  // 5. 加入檢索索引（最重要：讓未來相似問題可以直接本地回答）
  const qaId = `distill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  indexDocument(
    brain.retrievalIndex,
    qaId,
    `${question}\n${geminiAnswer}`,
    [...qTokens, ...aTokens],
    intent,
  );

  // 6. 提取回答模板（從 Gemini 回答中學習回答結構）
  extractAndStoreTemplate(brain, geminiAnswer, intent);
}

/** 從回答中提取可重用的模板 */
function extractAndStoreTemplate(brain: LocalAIBrain, answer: string, intent: IntentLabel): void {
  const sentences = answer.split(/[。！？\n]/).filter((s) => s.trim().length > 3);
  if (sentences.length === 0) return;

  // 學習開頭句式
  const starters = brain.ngramModel.intentStarters.get(intent) ?? [];
  const firstSent = sentences[0].trim();
  if (firstSent.length <= 40 && firstSent.length >= 4 && !starters.includes(firstSent)) {
    starters.push(firstSent);
    while (starters.length > 15) starters.shift();
    brain.ngramModel.intentStarters.set(intent, starters);
  }

  // 學習結尾句式
  const enders = brain.ngramModel.intentEnders.get(intent) ?? [];
  const lastSent = sentences[sentences.length - 1].trim();
  if (lastSent.length <= 40 && lastSent.length >= 4 && !enders.includes(lastSent)) {
    enders.push(lastSent);
    while (enders.length > 15) enders.shift();
    brain.ngramModel.intentEnders.set(intent, enders);
  }
}

// ═══════════════════════════════════════════════════
// 11. Active Clarification — 主動澄清 + 信心校準
// ═══════════════════════════════════════════════════

/** 澄清請求 */
export interface ClarificationRequest {
  needed: boolean;
  reason: string;
  suggestedQuestions: string[];
  missingSlots: string[];
}

/** 判斷是否需要主動澄清 */
export function needsClarification(
  text: string,
  intent: IntentResult,
  entities: NamedEntity[],
  ctx: DialogContext,
  reasoning: ReasoningChain,
): ClarificationRequest {
  const reasons: string[] = [];
  const suggestedQuestions: string[] = [];
  const missingSlots: string[] = [];

  const t = text.trim();
  // 選單跟進短句（第 N 個／最後一個／對好可以）：不應用「greeting 還是課程」這類雙意圖亂問
  if (
    /^第\s*[一二兩三四五六七八九十\d]+\s*個?$/.test(t) ||
    /^最後[一那]?個$/.test(t) ||
    /^(?:對+|好[的啊]?|可以|沒問題|ok|OK|嗯+|恩+|是[的啊]?)$/.test(t)
  ) {
    return { needed: false, reason: '', suggestedQuestions: [], missingSlots: [] };
  }

  // 1. 意圖不明確
  if (intent.confidence < 0.35) {
    reasons.push('意圖不明確');
    const top2 = intent.topK.slice(0, 2);
    if (top2.length >= 2 && top2[1].score > top2[0].score * 0.7) {
      const intentNames: Record<string, string> = {
        dining: '餐飲',
        academic: '課程',
        assignment: '作業',
        navigation: '導航',
        health: '健康',
        event: '活動',
        library: '圖書館',
        dormitory: '宿舍',
        emotion: '心理諮詢',
        grades: '成績',
        transport: '交通',
        greeting: '打招呼',
        general: '一般',
        help: '功能說明',
      };
      suggestedQuestions.push(
        `你是想問${intentNames[top2[0].intent] ?? top2[0].intent}還是${intentNames[top2[1].intent] ?? top2[1].intent}的問題呢？`,
      );
    } else {
      suggestedQuestions.push('可以再說得更具體一點嗎？我想確保能幫到你。');
    }
  }

  // 2. 模糊指代無法解析
  if (/那個|這個|它/.test(text) && entities.length === 0 && ctx.mentionedEntities.length === 0) {
    reasons.push('指代模糊');
    suggestedQuestions.push('你說的「那個」是指什麼呢？');
  }

  // 3. 關鍵資訊缺失（特定意圖需要特定槽位）
  const requiredSlots: Record<string, string[]> = {
    dining: ['food_preference'],
    navigation: ['destination'],
    academic: [],
    assignment: [],
  };

  const needed = requiredSlots[intent.intent] ?? [];
  for (const slotName of needed) {
    if (!ctx.slots.find((s) => s.name === slotName)) {
      missingSlots.push(slotName);
    }
  }

  if (missingSlots.length > 0 && intent.confidence > 0.5) {
    const slotPrompts: Record<string, string> = {
      food_preference: '你想吃什麼類型的？（例如：素食、便宜的、不辣的）',
      destination: '你想去哪裡？',
      target_day: '是問今天還是哪一天的？',
    };
    for (const slot of missingSlots) {
      if (slotPrompts[slot]) suggestedQuestions.push(slotPrompts[slot]);
    }
  }

  // 4. 推理信心過低
  if (reasoning.totalConfidence < 0.3 && text.length > 15) {
    reasons.push('推理信心不足');
    suggestedQuestions.push('這個問題有點複雜，可以告訴我更多細節嗎？');
  }

  // 只在信心真的很低時才澄清，避免每次都問
  const shouldClarify =
    reasons.length > 0 && intent.confidence < 0.35 && !ctx.slots.some((s) => s.confidence > 0.8);

  return {
    needed: shouldClarify,
    reason: reasons.join(', '),
    suggestedQuestions: suggestedQuestions.slice(0, 2),
    missingSlots,
  };
}

/** 回答品質自評 */
export interface QualityScore {
  relevance: number; // 與問題的相關性 0~1
  completeness: number; // 回答完整性 0~1
  naturalness: number; // 自然度 0~1
  overall: number; // 綜合分數 0~1
  shouldUseGemini: boolean; // 建議是否回退到 Gemini
}

export function evaluateResponseQuality(
  question: string,
  answer: string,
  intent: IntentResult,
  reasoning: ReasoningChain,
  embedding: EmbeddingModel,
): QualityScore {
  const qTokens = advancedTokenize(question);
  const aTokens = advancedTokenize(answer);

  // 相關性：問答的語意相似度
  const relevance = Math.min(semanticSimilarity(embedding, qTokens, aTokens) * 1.5, 1.0);

  // 完整性：回答長度和是否包含關鍵���訊
  const lengthScore = Math.min(answer.length / 80, 1.0); // 80 字以上算完整
  const hasNumbers = /\d/.test(answer) ? 0.1 : 0;
  const hasSpecifics = /[「」、]/.test(answer) ? 0.1 : 0;
  const completeness = Math.min(lengthScore + hasNumbers + hasSpecifics, 1.0);

  // 自然度：不以「抱歉」開頭、不過度重複、句式多樣
  let naturalness = 0.7;
  if (/^抱歉|^我不|^無法/.test(answer)) naturalness -= 0.3;
  if (answer.length < 5) naturalness -= 0.3;
  if (answer.length > 10 && !/[，。！？]/.test(answer)) naturalness -= 0.2; // 沒有標點不自然
  const uniqueChars = new Set(answer.split('')).size;
  if (uniqueChars / answer.length > 0.5) naturalness += 0.1; // 字元多樣性
  naturalness = Math.max(0, Math.min(1, naturalness));

  const overall = relevance * 0.4 + completeness * 0.3 + naturalness * 0.3;

  // 推理信心也納入考量
  const adjustedOverall = overall * 0.6 + reasoning.totalConfidence * 0.2 + intent.confidence * 0.2;

  // ★ 額外檢查：回答品質不夠好就交給 Gemini
  // 1. 回答太短（< 15 字且不是簡單打招呼）
  const tooShort = answer.length < 15 && !/早安|午安|晚安|你好|不客氣|沒問題/.test(answer);
  // 2. 回答是空洞的「沒有資料」類型
  const isEmptyResponse = /^(目前沒有|沒有(找到|資料|載入)|查無|暫無|抱歉.*無法)/.test(answer);
  // 3. 語意相關性太低
  const lowRelevance = relevance < 0.25;

  const shouldFallback = adjustedOverall < 0.55 || tooShort || isEmptyResponse || lowRelevance;

  return {
    relevance,
    completeness,
    naturalness,
    overall: adjustedOverall,
    shouldUseGemini: shouldFallback,
  };
}

// ═══════════════════════════════════════════════════
// 12. Contextual Reasoning — 情境推理引擎
// ═══════════════════════════════════════════════════

/** 情境因素 */
export interface ContextualFactors {
  timeOfDay: 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: number; // 0=Sun
  isWeekend: boolean;
  semesterPhase: 'early' | 'midterm' | 'late' | 'exam' | 'break';
  weatherHint?: string;
  recentMood: number;
  conversationDepth: number; // 對話已進行幾輪
}

/** 從系統時間推斷情境 */
export function inferContextualFactors(ctx: DialogContext): ContextualFactors {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const month = now.getMonth() + 1;

  let timeOfDay: ContextualFactors['timeOfDay'];
  if (hour < 9) timeOfDay = 'morning';
  else if (hour < 13) timeOfDay = 'noon';
  else if (hour < 17) timeOfDay = 'afternoon';
  else if (hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  // 學期階段推斷
  let semesterPhase: ContextualFactors['semesterPhase'];
  if (month >= 2 && month <= 3) semesterPhase = 'early';
  else if (month === 4) semesterPhase = 'midterm';
  else if (month === 5) semesterPhase = 'late';
  else if (month === 6 || month === 1) semesterPhase = 'exam';
  else if (month >= 7 && month <= 8) semesterPhase = 'break';
  else if (month >= 9 && month <= 10) semesterPhase = 'early';
  else if (month === 11) semesterPhase = 'midterm';
  else semesterPhase = 'late';

  return {
    timeOfDay,
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    semesterPhase,
    recentMood: ctx.userMood,
    conversationDepth: ctx.turns.length,
  };
}

/** 根據情境調整回答策略和內容 */
export function contextualEnhance(
  answer: string,
  intent: IntentLabel,
  factors: ContextualFactors,
  ctx: DialogContext,
): string {
  let enhanced = answer;

  // 時間感知的增強
  if (intent === 'dining') {
    if (factors.timeOfDay === 'morning' && !/早餐/.test(enhanced)) {
      enhanced = enhanced.replace(/^/, '早上好！');
    } else if (factors.timeOfDay === 'night' && !/宵夜/.test(enhanced)) {
      enhanced += '\n\n（提醒：現在比較晚了，注意別吃太多��夜喔）';
    }
  }

  // 考試季增強
  if (factors.semesterPhase === 'exam' || factors.semesterPhase === 'midterm') {
    if (intent === 'emotion' && factors.recentMood < -0.2) {
      enhanced += '\n\n考試季壓力大是正常的，記得適當休息。學校諮商中心可以幫忙。';
    }
    if (intent === 'academic' && !/複習|準備|考試/.test(enhanced)) {
      enhanced += '\n\n（現在是考試季，記得安排複習時間喔！）';
    }
  }

  // 週末增強
  if (factors.isWeekend) {
    if (intent === 'library' && !/週末|假日/.test(enhanced)) {
      enhanced += '\n\n（提醒：週末圖書館開放時間可能不同，建議先確認）';
    }
  }

  // 深度對話增強：連續多輪後變得更有人情味
  if (factors.conversationDepth > 8 && !ctx.userStyle.prefersShort) {
    // 不加太多，避免囉嗦
    if (factors.conversationDepth === 9 || factors.conversationDepth === 15) {
      enhanced += '\n\n（你今天問了不少問題，有需要我整理一下今天聊的重點嗎？）';
    }
  }

  // 夜晚情緒關懷
  if (factors.timeOfDay === 'night' && intent === 'emotion') {
    if (!/晚安|休息/.test(enhanced)) {
      enhanced += '\n\n夜深了，記得早點休息。明天又是新的一天。';
    }
  }

  return enhanced;
}

/** 組合式回答生成：共感 → 資訊 → 行動 → 追問 */
export function composeStructuredResponse(
  mainContent: string,
  intent: IntentLabel,
  ctx: DialogContext,
  reasoning: ReasoningChain,
  factors: ContextualFactors,
): string {
  const parts: string[] = [];

  // 1. 共感層（負面情緒 or 壓力相關）
  if (ctx.userMood < -0.3 || intent === 'emotion' || intent === 'health') {
    const empathyLines = ['我理解你的感受。', '聽起來不太容易，', '別太擔心，我來幫你。'];
    if (!/理解|擔心|感受/.test(mainContent)) {
      parts.push(empathyLines[Math.floor(Math.random() * empathyLines.length)]);
    }
  }

  // 2. 主要資訊
  parts.push(mainContent);

  // 3. 推論補充（如果有觸發推論規則）
  const inferences = reasoning.steps.filter((s) => s.type === 'infer' && s.output.length > 5);
  if (inferences.length > 0 && !mainContent.includes(inferences[0].output.slice(0, 15))) {
    const inferNote = inferences[0].output;
    if (inferNote.length < 80) {
      parts.push(`\n💡 ${inferNote}`);
    }
  }

  // 4. 行動建議（可執行的下一步）
  const actionSuggestions: Record<string, string[]> = {
    health: ['需要幫你查附近診所嗎？', '要幫你預約保健室嗎？'],
    assignment: ['需要幫你設定提醒嗎？', '要幫你查看其他作業截止日嗎？'],
    dining: ['要看其他餐廳的選擇嗎？', '想換成便宜或素食選項嗎？'],
    event: ['需要幫你報名嗎？', '要幫你加到行事曆嗎？'],
    navigation: ['需要幫你導航嗎？', '要查公車時刻表嗎？'],
    academic: ['需要看更詳細的課程資訊嗎？', '要幫你查教學大綱嗎？'],
    emotion: ['需要幫你預約諮商嗎？', '要聊聊嗎���我在這裡。'],
  };

  const actions = actionSuggestions[intent];
  if (actions && ctx.topicContinuity <= 1 && !ctx.userStyle.prefersShort) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    if (!mainContent.includes(action.slice(0, 6))) {
      parts.push(`\n${action}`);
    }
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════
// 13. 整合：Claude 級本地 AI 大腦
// ═══════════════════════════════════════════════════

/** 完整的本地 AI 引擎狀態 */
export interface LocalAIBrain {
  embedding: EmbeddingModel;
  classifier: ClassifierWeights;
  ngramModel: NgramModel;
  rewardModel: RewardModel;
  dialogCtx: DialogContext;
  /** TF-IDF 檢索索引 */
  retrievalIndex: TFIDFIndex;
  /** 多頭注意力融合器 */
  attentionFuser: AttentionFuser;
  /** 對話摘要（長對話壓縮後產生） */
  conversationSummary: ConversationSummary | null;
  /** 版本號（用於持久化檢查） */
  version: number;
}

/** 建立新的 AI 大腦 */
export function createAIBrain(): LocalAIBrain {
  return {
    embedding: createEmbeddingModel(),
    classifier: createClassifierWeights(),
    ngramModel: createNgramModel(),
    rewardModel: createRewardModel(),
    dialogCtx: createDialogContext(),
    retrievalIndex: createTFIDFIndex(),
    attentionFuser: createAttentionFuser(),
    conversationSummary: null,
    version: 2,
  };
}

/** 完整的 AI 理解管線：斷詞 → NER → 意圖 → 上下文 → 指代消解 → 注意力融合 → 模糊修正 */
export function understandQuery(
  brain: LocalAIBrain,
  rawText: string,
  knownCourses: string[] = [],
  knownLocations: string[] = [],
  knownPeople: string[] = [],
  knownFoods: string[] = [],
): {
  resolvedText: string;
  tokens: string[];
  intent: IntentResult;
  entities: NamedEntity[];
  isFollowUp: boolean;
  strategy: ResponseStrategy;
  retrievalHits: RetrievalResult[];
  reasoning: ReasoningChain;
  clarification: ClarificationRequest;
  contextualFactors: ContextualFactors;
} {
  // 0. 自動壓縮過長對話
  const { ctx: compressedCtx, summary } = compressDialogIfNeeded(brain.dialogCtx);
  if (summary) {
    brain.dialogCtx = compressedCtx;
    brain.conversationSummary = summary;
  }

  // 1. 指代消解
  const resolvedText = resolveReferences(rawText, brain.dialogCtx);

  // 2. 斷詞
  const tokens = advancedTokenize(resolvedText);

  // 3. 實體辨識
  const entities = extractEntities(
    resolvedText,
    knownCourses,
    knownLocations,
    knownPeople,
    knownFoods,
  );

  // 4. 意圖分類（多頭注意力增強版）
  let intent = attentionAdjustedClassify(
    tokens,
    brain.embedding,
    brain.classifier,
    brain.dialogCtx,
    brain.attentionFuser,
  );

  // 4b. 模糊匹配修正（錯字容忍）
  intent = fuzzyIntentCorrection(tokens, intent, brain.classifier.keywordBoosts);

  // 5. 追問判斷
  const followUp = isFollowUp(rawText, brain.dialogCtx);

  // 6. 如果是追問且意圖不明確，沿用前一主題
  let finalIntent = intent;
  if (followUp && intent.confidence < 0.4 && brain.dialogCtx.currentTopic) {
    finalIntent = {
      ...intent,
      intent: brain.dialogCtx.currentTopic,
      confidence: Math.max(intent.confidence, 0.6),
    };
  }

  // 7. 選擇回答策略
  const strategy = selectStrategy(
    brain.rewardModel,
    finalIntent.intent,
    brain.dialogCtx.userMood,
    brain.dialogCtx.topicContinuity,
  );

  // 8. 混合檢索（TF-IDF + 語意）
  const retrievalHits = hybridRetrieve(
    resolvedText,
    tokens,
    brain.retrievalIndex,
    brain.embedding,
    3,
    finalIntent.intent,
  );

  // 9. Chain-of-Thought 推理
  const reasoning = chainOfThought(
    resolvedText,
    tokens,
    finalIntent,
    entities,
    brain.dialogCtx,
    retrievalHits,
  );

  // 10. 主動澄清判斷
  const clarification = needsClarification(
    resolvedText,
    finalIntent,
    entities,
    brain.dialogCtx,
    reasoning,
  );

  // 11. 情境推理
  const contextualFactors = inferContextualFactors(brain.dialogCtx);

  return {
    resolvedText,
    tokens,
    intent: finalIntent,
    entities,
    isFollowUp: followUp,
    strategy,
    retrievalHits,
    reasoning,
    clarification,
    contextualFactors,
  };
}

/** 從用戶回饋訓練所有模型 */
export function trainFromFeedback(
  brain: LocalAIBrain,
  question: string,
  answer: string,
  intent: IntentLabel,
  strategy: ResponseStrategy,
  reward: number, // +1 or -1
): LocalAIBrain {
  const tokens = advancedTokenize(question);

  // 1. 訓練詞向量（讓問題中的詞更接近）
  trainEmbeddingOnSentence(brain.embedding, tokens, 0.005);

  // 2. 訓練意圖分類器
  if (reward > 0) {
    trainClassifier(tokens, intent, brain.embedding, brain.classifier, 0.1);
  }

  // 3. ���練 N-gram（從好回答學習語言模型）
  if (reward > 0) {
    trainNgramOnResponse(brain.ngramModel, answer, intent);
  }

  // 4. 更新 Q-learning
  const newRewardModel = updateReward(
    brain.rewardModel,
    intent,
    brain.dialogCtx.userMood,
    brain.dialogCtx.topicContinuity,
    strategy,
    reward,
  );

  // 5. 訓練回答中的詞向量
  const answerTokens = advancedTokenize(answer);
  if (reward > 0) {
    trainEmbeddingOnSentence(brain.embedding, answerTokens, 0.003);
  }

  // 6. 正面回饋 → 將 Q&A 加入檢索索引（越多好回答，檢索越精準）
  if (reward > 0) {
    const qaId = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    indexDocument(
      brain.retrievalIndex,
      qaId,
      `${question}\n${answer}`,
      [...tokens, ...answerTokens],
      intent,
    );
  }

  return {
    ...brain,
    rewardModel: newRewardModel,
  };
}

/** 更新對話上下文（每輪呼叫）+ 自動學習 */
export function updateBrainContext(
  brain: LocalAIBrain,
  role: 'user' | 'assistant',
  content: string,
  tokens: string[],
  intent?: IntentLabel,
  entities?: NamedEntity[],
): LocalAIBrain {
  // 自動從對話學習（self-supervised）
  if (role === 'assistant' && brain.dialogCtx.turns.length > 0) {
    const lastUserTurn = [...brain.dialogCtx.turns].reverse().find((t) => t.role === 'user');
    if (lastUserTurn && intent) {
      const helpful = heuristicHelpful(lastUserTurn.content, content);
      autoLearnFromTurn(brain, lastUserTurn.content, content, intent, helpful);
    }
  }

  return {
    ...brain,
    dialogCtx: updateDialogContext(brain.dialogCtx, role, content, tokens, intent, entities),
  };
}

// ═══════════════════════════════════════════════════
// 10. 持久化支援 — 序列化/反序列化
// ═══════════════════════════════════════════════════

/** 將 brain 序列化為可存儲的 JSON（Float32Array → Array） */
export function serializeBrain(brain: LocalAIBrain): string {
  const serializableEmbedding = {
    vocab: Array.from(brain.embedding.vocab.entries()).map(([k, v]) => [k, Array.from(v)]),
    wordFreq: Array.from(brain.embedding.wordFreq.entries()),
    dim: brain.embedding.dim,
    trainCount: brain.embedding.trainCount,
    // 不存 coMatrix，太大且可重建
  };

  const serializableClassifier = {
    centroids: Array.from(brain.classifier.centroids.entries()).map(([k, v]) => [k, Array.from(v)]),
    counts: Array.from(brain.classifier.counts.entries()),
    biases: Array.from(brain.classifier.biases.entries()),
    keywordBoosts: Array.from(brain.classifier.keywordBoosts.entries()).map(([k, v]) => [
      k,
      Array.from(v.entries()),
    ]),
  };

  const serializableNgram = {
    bigrams: Array.from(brain.ngramModel.bigrams.entries())
      .slice(0, 2000)
      .map(([k, v]) => [k, Array.from(v.entries()).slice(0, 20)]),
    trigrams: Array.from(brain.ngramModel.trigrams.entries())
      .slice(0, 3000)
      .map(([k, v]) => [k, Array.from(v.entries()).slice(0, 10)]),
    intentStarters: Array.from(brain.ngramModel.intentStarters.entries()),
    intentEnders: Array.from(brain.ngramModel.intentEnders.entries()),
    totalTokens: brain.ngramModel.totalTokens,
  };

  const serializableReward = {
    qTable: Array.from(brain.rewardModel.qTable.entries()),
    epsilon: brain.rewardModel.epsilon,
    alpha: brain.rewardModel.alpha,
    gamma: brain.rewardModel.gamma,
    steps: brain.rewardModel.steps,
    strategyRewards: Array.from(brain.rewardModel.strategyRewards.entries()),
  };

  // 序列化 TF-IDF 索引（只保留最新 200 筆文檔）
  const serializableRetrieval = {
    docs: brain.retrievalIndex.docs.slice(-200).map((d) => ({
      id: d.id,
      tokens: d.tokens.slice(0, 30),
      raw: d.raw.slice(0, 200),
      intent: d.intent,
    })),
    totalDocs: Math.min(brain.retrievalIndex.totalDocs, 200),
  };

  // 序列化注意力權重
  const serializableAttention = {
    headWeights: Array.from(brain.attentionFuser.headWeights.entries()),
  };

  return JSON.stringify({
    version: brain.version,
    embedding: serializableEmbedding,
    classifier: serializableClassifier,
    ngramModel: serializableNgram,
    rewardModel: serializableReward,
    retrievalIndex: serializableRetrieval,
    attentionFuser: serializableAttention,
    conversationSummary: brain.conversationSummary,
    // dialogCtx 不持久化（每次啟動重新開始）
  });
}

/** 從 JSON 還原 brain */
export function deserializeBrain(json: string): LocalAIBrain | null {
  try {
    const data = JSON.parse(json);
    if (!data.version) return null;

    // 還原 embedding
    const embedding = createEmbeddingModel();
    if (data.embedding?.vocab) {
      for (const [k, v] of data.embedding.vocab) {
        embedding.vocab.set(k, new Float32Array(v));
      }
    }
    if (data.embedding?.wordFreq) {
      for (const [k, v] of data.embedding.wordFreq) {
        embedding.wordFreq.set(k, v);
      }
    }
    embedding.trainCount = data.embedding?.trainCount ?? 0;

    // 還原 classifier
    const classifier = createClassifierWeights();
    if (data.classifier?.centroids) {
      for (const [k, v] of data.classifier.centroids) {
        classifier.centroids.set(k, new Float32Array(v));
      }
    }
    if (data.classifier?.counts) {
      for (const [k, v] of data.classifier.counts) {
        classifier.counts.set(k, v);
      }
    }
    if (data.classifier?.biases) {
      for (const [k, v] of data.classifier.biases) {
        classifier.biases.set(k, v);
      }
    }
    if (data.classifier?.keywordBoosts) {
      for (const [k, entries] of data.classifier.keywordBoosts) {
        classifier.keywordBoosts.set(k, new Map(entries));
      }
    }

    // 還原 ngram
    const ngramModel = createNgramModel();
    if (data.ngramModel?.bigrams) {
      for (const [k, entries] of data.ngramModel.bigrams) {
        ngramModel.bigrams.set(k, new Map(entries));
      }
    }
    if (data.ngramModel?.trigrams) {
      for (const [k, entries] of data.ngramModel.trigrams) {
        ngramModel.trigrams.set(k, new Map(entries));
      }
    }
    if (data.ngramModel?.intentStarters) {
      for (const [k, v] of data.ngramModel.intentStarters) {
        ngramModel.intentStarters.set(k, v);
      }
    }
    if (data.ngramModel?.intentEnders) {
      for (const [k, v] of data.ngramModel.intentEnders) {
        ngramModel.intentEnders.set(k, v);
      }
    }
    ngramModel.totalTokens = data.ngramModel?.totalTokens ?? 0;

    // 還原 reward
    const rewardModel = createRewardModel();
    if (data.rewardModel?.qTable) {
      for (const [k, v] of data.rewardModel.qTable) {
        rewardModel.qTable.set(k, v);
      }
    }
    rewardModel.epsilon = data.rewardModel?.epsilon ?? 0.3;
    rewardModel.steps = data.rewardModel?.steps ?? 0;
    if (data.rewardModel?.strategyRewards) {
      for (const [k, v] of data.rewardModel.strategyRewards) {
        rewardModel.strategyRewards.set(k, v);
      }
    }

    // 還原 TF-IDF 索引
    const retrievalIndex = createTFIDFIndex();
    if (data.retrievalIndex?.docs) {
      for (const d of data.retrievalIndex.docs) {
        retrievalIndex.docs.push({ id: d.id, tokens: d.tokens, raw: d.raw, intent: d.intent });
        retrievalIndex.totalDocs++;
        const seen = new Set<string>();
        for (const t of d.tokens) {
          if (!seen.has(t)) {
            retrievalIndex.docFreq.set(t, (retrievalIndex.docFreq.get(t) ?? 0) + 1);
            seen.add(t);
          }
        }
      }
      // 重算 IDF
      for (const [term, df] of retrievalIndex.docFreq) {
        retrievalIndex.idf.set(term, Math.log((retrievalIndex.totalDocs + 1) / (df + 1)) + 1);
      }
    }

    // 還原注意力融合器
    const attentionFuser = createAttentionFuser();
    if (data.attentionFuser?.headWeights) {
      for (const [k, v] of data.attentionFuser.headWeights) {
        attentionFuser.headWeights.set(k, v);
      }
    }

    return {
      embedding,
      classifier,
      ngramModel,
      rewardModel,
      dialogCtx: createDialogContext(),
      retrievalIndex,
      attentionFuser,
      conversationSummary: data.conversationSummary ?? null,
      version: data.version,
    };
  } catch {
    return null;
  }
}

export const AI_BRAIN_STORAGE_KEY = 'pu_ai_brain_v2';
