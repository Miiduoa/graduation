/**
 * GlobalAIConfirmModalHost — 全域待確認計畫 Modal 主機
 * ═══════════════════════════════════════════════════════════════════════
 * 訂閱 aiBrain.subscribePendingPlans，當有任何 plan 需要使用者確認時
 * 自動跳出 AIActionConfirmModal。可在 App 根節點掛一次。
 */

import React, { useCallback, useState } from 'react';
import { usePendingActionPlans } from '../app/useAIBrain';
import AIActionConfirmModal from './AIActionConfirmModal';
import type { ActionPlan } from '../services/aiBrain';

export function GlobalAIConfirmModalHost() {
  const { pendingPlans, confirm, dismiss } = usePendingActionPlans();
  const [activePlan, setActivePlan] = useState<ActionPlan | null>(null);

  // 自動把最新的 pending plan 推上來
  React.useEffect(() => {
    if (!activePlan && pendingPlans.length > 0) {
      setActivePlan(pendingPlans[0]);
    }
    if (activePlan && !pendingPlans.find((p) => p.id === activePlan.id)) {
      // 已被別處 consume 掉 → 關閉
      setActivePlan(null);
    }
  }, [pendingPlans, activePlan]);

  const handleConfirm = useCallback(async () => {
    if (!activePlan) return;
    try {
      await confirm(activePlan.id);
    } catch (err) {
      console.warn('[GlobalAIConfirmModal] confirm failed:', err);
    }
    setActivePlan(null);
  }, [activePlan, confirm]);

  const handleCancel = useCallback(() => {
    if (activePlan) dismiss(activePlan.id);
    setActivePlan(null);
  }, [activePlan, dismiss]);

  return (
    <AIActionConfirmModal
      plan={activePlan}
      visible={!!activePlan}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}

export default GlobalAIConfirmModalHost;
