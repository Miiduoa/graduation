import type { AIContext } from './ai';
import type { AIToolLayerResult } from './aiToolLayer';

export type AIResponseMode = 'instant' | 'thinking' | 'auto';

const THINKING_HINTS =
  /深入|深度|分析|推理|規劃|計畫|比較|評估|為什麼|原因|策略|總結.*建議|幫我想|怎麼辦|風險|預測|拆解/;
const WRITE_HINTS =
  /幫我(?:請假|點|訂|下單|報修|維修|預約|取消|退選|發.*訊|繳交|報名|簽到|掛號|列印|送出|新增|刪除|修改)|我要(?:請假|點|訂|吃|下單)|請.*假|核准|退回|駁回|審核|報修|維修|預約|取消|退選|發.*訊|繳交|報名|下單|訂.*[碗份個杯]|點.*[碗份個杯]|買.*[碗份個杯]|簽到|掛號|列印|送出|新增|刪除|修改/;

export function shouldUseInstantToolLayerAnswer(params: {
  mode?: AIResponseMode;
  message: string;
  result: AIToolLayerResult;
  context?: AIContext;
}): boolean {
  const mode = params.mode ?? 'auto';
  if (mode === 'thinking') return false;
  if (mode === 'instant') return Boolean(params.result.answer);
  if (!params.result.handled || !params.result.answer) return false;

  const text = params.message.trim();
  if (THINKING_HINTS.test(text)) return false;
  if (WRITE_HINTS.test(text) && params.result.intent !== 'schedule_lookup') return false;

  const quickIntents = new Set([
    'schedule_lookup',
    'assignment_lookup',
    'calendar_lookup',
    'dining_lookup',
    'order_status',
    'repair_status',
    'library_status',
    'print_status',
    'dorm_status',
    'health_status',
    'seat_status',
    'washing_status',
    'notification_lookup',
    'role_capability',
    'app_data_search',
  ]);

  if (!quickIntents.has(params.result.intent)) return false;
  if ((params.context?.appDataRecords?.length ?? 0) > 0) return true;
  return params.result.confidence >= 0.85;
}

export function withDeepDiveSuggestion(base: string[] | undefined): string[] {
  const out = [...(base ?? []), '深入分析這個'];
  return Array.from(new Set(out)).slice(0, 4);
}
