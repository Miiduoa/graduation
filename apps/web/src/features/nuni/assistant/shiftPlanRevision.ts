import { buildPlanShift } from '@/lib/assistantPlanShift';
import { getPlanSelectionTargets } from './planSelection';
import type { V2Turn } from './types';

export type PlanShiftChange = { mutationIds: string[]; offsetMinutes: number };

/** IDs refer to the current signed source, never a title or an ancestor index. */
export function buildShiftPlanRevision(turn: V2Turn, change: PlanShiftChange, protectedIndices: readonly number[] = []) {
  const targets = getPlanSelectionTargets(turn);
  if (!change || !Array.isArray(change.mutationIds) || change.mutationIds.length > targets.length ||
      new Set(change.mutationIds).size !== change.mutationIds.length)
    throw new Error('請重新選擇要平移的原提議項目。');
  const selectedIndices = change.mutationIds.map(id => {
    const index = targets.findIndex(target => target.mutationId === id);
    if (index < 0) throw new Error('找不到要平移的原提議，請重新選擇。');
    return index;
  });
  const result = buildPlanShift(targets.map(target => target.event), selectedIndices, change.offsetMinutes, protectedIndices);
  return { ...result, changed: true, label: `${result.selectedIndices.length} 項${result.offsetMinutes > 0 ? '延後' : '提前'} ${Math.abs(result.offsetMinutes)} 分鐘` };
}
