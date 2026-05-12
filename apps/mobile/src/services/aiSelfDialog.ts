/* eslint-disable */
/**
 * AI Self-Dialog Evaluation — DEPRECATED STUB
 * ═══════════════════════════════════════════════
 * 此模組僅用於測試/品質評估，無任何執行期消費者。
 * 保留型別匯出以相容現有測試。
 */

export type AISelfDialogScenario = {
  id: string;
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedTopics?: string[];
};

export type AISelfDialogFailure = {
  scenarioId: string;
  reason: string;
  actual: string;
};

export type AISelfDialogReport = {
  total: number;
  passed: number;
  failed: number;
  failures: AISelfDialogFailure[];
  durationMs: number;
};

export const AI_SELF_DIALOG_SCENARIOS: AISelfDialogScenario[] = [];

export function evaluateSelfDialogResponse(
  _scenario: AISelfDialogScenario,
  _response: string,
): AISelfDialogFailure | null {
  return null;
}

export async function runAISelfDialogEvaluation(
  _options?: { scenarios?: AISelfDialogScenario[]; concurrency?: number },
): Promise<AISelfDialogReport> {
  return { total: 0, passed: 0, failed: 0, failures: [], durationMs: 0 };
}
