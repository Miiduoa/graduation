/**
 * Reflexion（語言化試錯）：Evaluator + Reflector + 短期記憶緩衝
 * 僅依「實際工具／代理結果」產出反思文字，注入後續 Actor prompt。
 */

import type { ToolCallResult } from './aiAgentTools';
import type { AgentQueryResult } from './aiLocalAgent';

/** 同一通 Gemini 工具對話中，最多額外反思次數（每次失敗軌跡 1 次） */
export const MAX_REFLEXIONS_PER_GEMINI_TRIAL = 2;

/** 每位使用者保留的反思條數（跨回合注入 system prompt） */
export const MAX_STORED_REFLEXIONS = 3;

/** 單條反思最大字元數（避免 prompt 爆炸） */
export const MAX_REFLECTION_CHARS = 480;

const REFLECTOR_SYSTEM_PROMPT = [
  '你是「反思模組」，只做錯因與下一步建議的摘要。',
  '規則：',
  '1. 只能根據使用者提供的「工具回傳摘要／錯誤」，不得發明未出現的 API、資料欄位或系統行為。',
  '2. 輸出 2～4 句繁體中文，總長不超過 480 字。',
  '3. 第 1～2 句：指出問題或不足（依事實）。',
  '4. 最後 1～2 句：下次可嘗試的做法（具體但勿捏造細節）。',
  '5. 勿重複貼上原始錯誤全文。',
].join('\n');

/** userId -> 最近反思文字（FIFO） */
const _sessionReflections = new Map<string, string[]>();

export function clampReflectionText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_REFLECTION_CHARS) return t;
  return t.slice(0, MAX_REFLECTION_CHARS) + '…';
}

export function rememberReflexion(userId: string | undefined, reflectionText: string): void {
  const text = clampReflectionText(reflectionText);
  if (!text || !userId) return;
  const prev = _sessionReflections.get(userId) ?? [];
  const next = [...prev, text].slice(-MAX_STORED_REFLEXIONS);
  _sessionReflections.set(userId, next);
}

/** 供 buildAgentSystemPrompt 結尾附加 */
export function formatReflexionHintsForSystemPrompt(userId: string | undefined): string {
  if (!userId) return '';
  const lines = _sessionReflections.get(userId);
  if (!lines?.length) return '';
  return [
    '',
    '## 近期助理反思（請避免重複相同錯誤；勿捏造下方未提及的資料）',
    ...lines.map((t, i) => `${i + 1}. ${t}`),
  ].join('\n');
}

export function clearReflexionHintsForUser(userId: string): void {
  _sessionReflections.delete(userId);
}

// ─── Evaluator（規則型，不使用額外 LLM 評分）────────────────────────────

export type ToolRoundEntry = { tool: string; result: ToolCallResult };

/** Gemini 單輪：任一工具失敗、或帶 error 即觸發反思 */
export function evaluateToolRoundForReflexion(roundResults: ToolRoundEntry[]): boolean {
  if (roundResults.length === 0) return false;
  return roundResults.some(
    (r) =>
      !r.result.success ||
      (r.result.error != null && String(r.result.error).trim().length > 0),
  );
}

/** 本機代理：讀取失敗、寫入失敗、或缺參無法執行 */
export function evaluateLocalAgentForReflexion(q: AgentQueryResult | null): boolean {
  if (!q) return false;
  if (q.failedActions.length > 0) return true;
  for (const r of q.results) {
    if (!r.result.success) return true;
  }
  for (const ea of q.executedActions) {
    if (!ea.result.success) return true;
  }
  return false;
}

/**
 * 零次 LLM 呼叫的「快速反思」— 僅拼接工具事實，供注入總結 prompt。
 * 與 Reflector 語句相比節省一整輪本機推理，明顯縮短首字延遲。
 */
export function composeQuickLocalReflection(q: AgentQueryResult): string {
  const parts: string[] = [];
  for (const r of q.results) {
    if (!r.result.success) {
      const hint = (r.result.error ?? r.result.summary ?? '').slice(0, 120);
      parts.push(`讀取「${r.tool}」未成功：${hint}`);
    }
  }
  for (const ea of q.executedActions) {
    if (!ea.result.success) {
      const hint = (ea.result.error ?? ea.result.summary ?? '').slice(0, 120);
      parts.push(`操作「${ea.tool}」未成功：${hint}`);
    }
  }
  for (const fa of q.failedActions) {
    parts.push(`「${fa.tool}」尚缺：${fa.missingInfo}`);
  }
  if (parts.length === 0) return '';
  return clampReflectionText(
    parts.join('；') + '。回覆時請依上述事實說明，並引導使用者補齊條件；勿捏造已成功。',
  );
}

// ─── Reflector 輸入組裝 ───────────────────────────────────────────────

export function buildReflectorUserPayloadForTools(
  lastUserMessage: string,
  roundResults: ToolRoundEntry[],
): string {
  const lines = roundResults.map((r) => {
    const err = r.result.error ? ` error=${r.result.error}` : '';
    return `- 工具「${r.tool}」success=${r.result.success} summary=${r.result.summary}${err}`;
  });
  return [
    '使用者原始需求（摘要）：',
    lastUserMessage.slice(0, 800),
    '',
    '本輪工具回傳（僅能依此推理）：',
    lines.join('\n'),
    '',
    '請依規則輸出反思。',
  ].join('\n');
}

export function buildReflectorUserPayloadForLocalAgent(
  message: string,
  queryResult: AgentQueryResult,
): string {
  const parts: string[] = [
    '使用者原始需求：',
    message.slice(0, 800),
    '',
    '代理執行狀態（僅能依此推理）：',
  ];
  for (const r of queryResult.results) {
    parts.push(
      `- 讀取「${r.tool}」success=${r.result.success} ${r.result.summary}${r.result.error ? ` (${r.result.error})` : ''}`,
    );
  }
  for (const ea of queryResult.executedActions) {
    parts.push(
      `- 寫入「${ea.tool}」success=${ea.result.success} ${ea.result.summary}${ea.result.error ? ` (${ea.result.error})` : ''}`,
    );
  }
  for (const fa of queryResult.failedActions) {
    parts.push(`- 無法自動執行「${fa.tool}」：${fa.missingInfo}`);
  }
  parts.push('', '請依規則輸出反思。');
  return parts.join('\n');
}

/**
 * 本機 Reflector 的 user 內容：先給規則摘要（防幻覺、省 token），再接完整事實表，讓模型寫出通順反思。
 */
export function buildLocalAgentReflectorUserContent(message: string, q: AgentQueryResult): string {
  const quick = composeQuickLocalReflection(q);
  const full = buildReflectorUserPayloadForLocalAgent(message, q);
  if (!quick) return full;
  return [
    '【系統已整理之失敗要點（必須依此，勿新增未發生的事實）】',
    quick,
    '',
    '---',
    '以下為完整代理狀態（可與上列對照）：',
    full,
  ].join('\n');
}

/** 給本機模型組 prompt 用的反思區塊（已由 Reflector 產出並裁切） */
export function formatReflexionHintSection(reflexionHint: string): string {
  const t = clampReflectionText(reflexionHint);
  if (!t) return '';
  return ['## 本輪工具／代理反思（僅調整說法與下一步建議，勿捏造資料）', t, ''].join('\n');
}

// ─── Gemini：僅文字 generateContent（無 tools）────────────────────────

export async function generateReflectionViaGemini(
  apiKey: string,
  userPayload: string,
  signal?: AbortSignal,
): Promise<string> {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: REFLECTOR_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPayload }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 512,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });
  if (!resp.ok) {
    console.warn('[Reflexion] Gemini reflector HTTP', resp.status);
    return '';
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? '';
  return clampReflectionText(String(text));
}

export { REFLECTOR_SYSTEM_PROMPT };
