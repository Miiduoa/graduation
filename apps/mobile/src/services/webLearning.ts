import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  answerWithOnlineSearch,
  shouldUseWebSearch,
  type WebGroundedAnswer,
  type WebSearchSource,
} from './webSearch';

export type WebLearningItem = {
  id: string;
  query: string;
  normalizedQuery: string;
  answer: string;
  sources: WebSearchSource[];
  confidence: WebGroundedAnswer['confidence'];
  tags: string[];
  fetchedAt: string;
  learnedAt: string;
  lastUsedAt?: string;
  useCount: number;
};

type WebLearningStore = {
  version: 1;
  updatedAt: string;
  lastBackgroundSyncAt?: string;
  items: WebLearningItem[];
};

export type WebLearningSyncReport = {
  attempted: number;
  learned: number;
  skipped: number;
};

const STORAGE_KEY = '@ai_web_learning:v1';
const MAX_ITEMS = 120;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FRESH_DATA_MAX_AGE_MS = 90 * 60 * 1000;
const BACKGROUND_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_WEB_LEARNING_SEEDS = [
  '怎麼去台中車站',
  '現在台中天氣如何',
  '美國總統是誰',
  '台灣總統是誰',
  '台中市長是誰',
  'Python 裝飾器是什麼',
  '量子力學是什麼',
];

function nowIso(): string {
  return new Date().toISOString();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeWebLearningQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/臺/g, '台')
    .replace(/静/g, '靜')
    .replace(/[？?。！!，,、：:；;"'「」『』（）()[\]\s]+/g, '')
    .trim();
}

function extractTags(query: string, answer: string, sources: WebSearchSource[]): string[] {
  const text =
    `${query} ${answer} ${sources.map((source) => `${source.title} ${source.source}`).join(' ')}`.toLowerCase();
  const tags = new Set<string>();
  const patterns: Array<[string, RegExp]> = [
    ['weather', /天氣|氣溫|下雨|open-meteo/],
    ['transport', /公車|車站|路線|交通|google maps|臺中市公車|台中市公車/],
    ['current_fact', /現任|總統|市長|校長|ceo|誰是|是誰/],
    ['definition', /是什麼|意思|定義|介紹|wikipedia|維基/],
    ['taichung', /台中|臺中|沙鹿|靜宜|静宜/],
  ];
  for (const [tag, pattern] of patterns) {
    if (pattern.test(text)) tags.add(tag);
  }
  return Array.from(tags);
}

function tokenSet(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/臺/g, '台').replace(/静/g, '靜');
  const tokens = new Set<string>();

  normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length >= 2)
    .forEach((part) => tokens.add(part));

  const cjkSegments = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const segment of cjkSegments) {
    tokens.add(segment);
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.add(segment.slice(index, index + 2));
    }
  }

  return tokens;
}

function similarity(a: string, b: string): number {
  const normalizedA = normalizeWebLearningQuery(a);
  const normalizedB = normalizeWebLearningQuery(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 0.9;

  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export function requiresFreshWebData(query: string): boolean {
  return /現在|目前|今天|即時|最新|新聞|天氣|氣溫|下雨|到站|班次|股價|股票|匯率|價格|票價/.test(
    query,
  );
}

async function readStore(): Promise<WebLearningStore> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: 1, updatedAt: nowIso(), items: [] };
    }
    const parsed = JSON.parse(raw) as Partial<WebLearningStore>;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? nowIso(),
      lastBackgroundSyncAt: parsed.lastBackgroundSyncAt,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { version: 1, updatedAt: nowIso(), items: [] };
  }
}

async function writeStore(store: WebLearningStore): Promise<void> {
  const sortedItems = [...store.items]
    .sort((a, b) => {
      const bScore = Date.parse(b.fetchedAt) + b.useCount * 60_000;
      const aScore = Date.parse(a.fetchedAt) + a.useCount * 60_000;
      return bScore - aScore;
    })
    .slice(0, MAX_ITEMS);

  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...store,
      updatedAt: nowIso(),
      items: sortedItems,
    }),
  );
}

export async function saveWebLearningAnswer(
  query: string,
  answer: WebGroundedAnswer,
): Promise<WebLearningItem> {
  const normalizedQuery = normalizeWebLearningQuery(query);
  const store = await readStore();
  const existing = store.items.find((item) => item.normalizedQuery === normalizedQuery);
  const learnedAt = nowIso();

  const item: WebLearningItem = {
    id: existing?.id ?? `web_${hashText(`${normalizedQuery}:${answer.fetchedAt}`)}`,
    query,
    normalizedQuery,
    answer: answer.content,
    sources: answer.sources,
    confidence: answer.confidence,
    tags: extractTags(query, answer.content, answer.sources),
    fetchedAt: answer.fetchedAt,
    learnedAt: existing?.learnedAt ?? learnedAt,
    lastUsedAt: existing?.lastUsedAt,
    useCount: existing?.useCount ?? 0,
  };

  store.items = [
    item,
    ...store.items.filter(
      (entry) => entry.id !== item.id && entry.normalizedQuery !== normalizedQuery,
    ),
  ];
  await writeStore(store);
  return item;
}

export async function findRelevantWebLearningItem(
  query: string,
  options: { maxAgeMs?: number; minSimilarity?: number; allowStale?: boolean } = {},
): Promise<WebLearningItem | null> {
  const store = await readStore();
  const maxAgeMs =
    options.maxAgeMs ?? (requiresFreshWebData(query) ? FRESH_DATA_MAX_AGE_MS : DEFAULT_MAX_AGE_MS);
  const minSimilarity = options.minSimilarity ?? 0.35;
  const now = Date.now();

  const best = store.items
    .map((item) => ({
      item,
      score: similarity(query, item.query),
      ageMs: now - Date.parse(item.fetchedAt),
    }))
    .filter(
      ({ score, ageMs }) => score >= minSimilarity && (options.allowStale || ageMs <= maxAgeMs),
    )
    .sort((a, b) => b.score - a.score || a.ageMs - b.ageMs)[0]?.item;

  if (!best) return null;

  best.lastUsedAt = nowIso();
  best.useCount += 1;
  await writeStore({
    ...store,
    items: store.items.map((item) => (item.id === best.id ? best : item)),
  });

  return best;
}

export function buildAnswerFromLearnedWebItem(
  query: string,
  item: WebLearningItem,
): WebGroundedAnswer {
  const sourceLines = item.sources
    .slice(0, 4)
    .map((source, index) => `${index + 1}. ${source.title}（${source.source}）\n${source.url}`);
  const fetchedAtText = new Date(item.fetchedAt).toLocaleString('zh-TW');

  return {
    content: [
      '我沒有把舊資料當成即時結果；以下是本機先前連網學到、並保留來源的資料：',
      '',
      item.answer,
      '',
      `原始問題：${item.query}`,
      `本次問題：${query}`,
      `原查詢時間：${fetchedAtText}`,
      '',
      '保留來源：',
      ...sourceLines,
      '',
      requiresFreshWebData(query)
        ? '提醒：這題可能需要最新資料，建議重新查一次來源確認。'
        : '提醒：這是本機知識庫快取，不是重新訓練模型權重。',
    ].join('\n'),
    sources: item.sources,
    fetchedAt: item.fetchedAt,
    confidence: item.confidence,
    suggestions: ['重新連網查', '換個問法', '問校園資料'],
  };
}

export function buildWebLearningTrainingText(item: WebLearningItem): string {
  const evidence = item.sources
    .map(
      (source, index) =>
        `來源 ${index + 1}: ${source.title} / ${source.source} / ${source.snippet}`,
    )
    .join('\n');

  return [
    `問題: ${item.query}`,
    '任務: 只能根據來源回答，不能編造。',
    evidence,
    `答案: ${item.answer}`,
  ].join('\n');
}

export async function listWebLearningItems(): Promise<WebLearningItem[]> {
  return (await readStore()).items;
}

export async function clearWebLearningItems(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function syncWebLearningKnowledgeBase(
  seedQueries: string[] = DEFAULT_WEB_LEARNING_SEEDS,
  options: { force?: boolean; maxQueries?: number; signal?: AbortSignal } = {},
): Promise<WebLearningSyncReport> {
  const store = await readStore();
  const lastSyncMs = store.lastBackgroundSyncAt ? Date.parse(store.lastBackgroundSyncAt) : 0;
  if (!options.force && lastSyncMs && Date.now() - lastSyncMs < BACKGROUND_SYNC_INTERVAL_MS) {
    return { attempted: 0, learned: 0, skipped: seedQueries.length };
  }

  let attempted = 0;
  let learned = 0;
  let skipped = 0;
  const maxQueries = options.maxQueries ?? 3;

  for (const query of seedQueries.slice(0, maxQueries)) {
    if (options.signal?.aborted) break;
    if (!shouldUseWebSearch(query, 'general')) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const answer = await answerWithOnlineSearch(query, options.signal);
    if (answer) {
      await saveWebLearningAnswer(query, answer);
      learned += 1;
    } else {
      skipped += 1;
    }
  }

  const nextStore = await readStore();
  await writeStore({
    ...nextStore,
    lastBackgroundSyncAt: nowIso(),
  });

  return { attempted, learned, skipped };
}
