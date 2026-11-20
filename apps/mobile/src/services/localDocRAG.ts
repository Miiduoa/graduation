/**
 * 本機離線「輕量 RAG」：使用者筆記／長文本切段後存入 AsyncStorage，
 * 對話時以字詞／二元組重合評分檢索，將段落附加到 system prompt。
 *
 * 不依賴雲端或向量模型，適合完全離線 App；後續可換成真嵌入模型。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type LocalKnowledgeChunk = {
  id: string;
  title: string;
  text: string;
  createdAt: number;
};

const STORAGE_KEY = '@local_knowledge_chunks:v1';
const MAX_CHUNKS = 120;
const MAX_CHUNK_CHARS = 1200;

function scoreChunk(query: string, title: string, text: string): number {
  const q = query.trim().toLowerCase();
  const hay = `${title}\n${text}`.toLowerCase();
  if (q.length < 2) return 0;

  let s = 0;
  if (hay.includes(query.trim().toLowerCase())) s += 12;

  for (const t of q.split(/\s+/).filter((x) => x.length > 1)) {
    if (hay.includes(t)) s += 2;
  }

  for (let i = 0; i < q.length - 1; i++) {
    const bg = q.slice(i, i + 2);
    if (hay.includes(bg)) s += 0.75;
  }

  return s;
}

async function loadChunks(): Promise<LocalKnowledgeChunk[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveChunks(chunks: LocalKnowledgeChunk[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(chunks.slice(-MAX_CHUNKS)));
}

/** 新增或取代一整批使用者知識（段落自動切段）。 */
export async function ingestLocalKnowledgeDocument(title: string, body: string): Promise<number> {
  const trimmed = body.trim();
  if (!trimmed) return 0;

  const parts = trimmed.split(/\n{2,}/).filter((p) => p.trim().length >= 16);
  const slices = (parts.length > 0 ? parts : [trimmed]).map((p) =>
    p.length > MAX_CHUNK_CHARS ? `${p.slice(0, MAX_CHUNK_CHARS)}…` : p,
  );

  const prev = await loadChunks();
  const baseTs = Date.now();
  const next: LocalKnowledgeChunk[] = prev.concat(
    slices.map((text, i) => ({
      id: `lk_${baseTs}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      title: slices.length > 1 ? `${title}（${i + 1}/${slices.length}）` : title,
      text,
      createdAt: baseTs,
    })),
  );

  await saveChunks(next);
  return slices.length;
}

export async function removeLocalKnowledgeChunk(id: string): Promise<void> {
  const prev = await loadChunks();
  await saveChunks(prev.filter((c) => c.id !== id));
}

export async function clearLocalKnowledge(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** 產生可附加於 system prompt 的離線檢索片段（無命中回傳空字串）。 */
export async function formatLocalDocRagAppendix(
  query: string,
  topK = 3,
  maxTotalChars = 2200,
): Promise<string> {
  const chunks = await loadChunks();
  if (!chunks.length || !query.trim()) return '';

  const ranked = chunks
    .map((c) => ({
      c,
      sc: scoreChunk(query, c.title, c.text),
    }))
    .filter((x) => x.sc >= 2)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, topK);

  if (!ranked.length) return '';

  const lines: string[] = [];
  let used = 0;
  for (const { c } of ranked) {
    const block = `【${c.title}】\n${c.text}`;
    if (used + block.length > maxTotalChars) break;
    lines.push(block);
    used += block.length + 2;
  }

  if (!lines.length) return '';

  return (
    `---\n以下為使用者儲存在本機的參考筆記（離線關鍵字檢索；若與問題無關請忽略）：\n---\n\n` +
    lines.join('\n\n')
  );
}
