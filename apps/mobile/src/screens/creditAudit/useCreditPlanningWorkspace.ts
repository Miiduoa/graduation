import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  readMobileCreditPlan,
  writeMobileCreditPlan,
} from '../../features/academics/creditPlanRepository';
import {
  createCreditPlanSession,
  type CreditPlanTicket,
} from '../../features/academics/creditPlanSession';

type WorkspaceState = {
  phase: 'loading' | 'ready' | 'error';
  plan: CreditPlan | null;
  ticket: CreditPlanTicket;
  error: string;
  notice: string;
};
type SavedPlan = { plan: CreditPlan; ticket: CreditPlanTicket };

/** The parent keys this hook's component by account and campus. */
export function useCreditPlanningWorkspace(scopeKey: string) {
  const [session] = useState(createCreditPlanSession);
  const [state, setState] = useState<WorkspaceState>(() => ({
    phase: 'loading', plan: null, ticket: session.snapshot(), error: '', notice: '',
  }));
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const ticket = session.restart();
    setSaving(false);
    setState({ phase: 'loading', plan: null, ticket, error: '', notice: '' });
    try {
      const plan = await readMobileCreditPlan(scopeKey);
      if (!session.isCurrent(ticket)) return;
      setState({ phase: 'ready', plan, ticket, error: '', notice: '' });
    } catch (error) {
      if (!session.isCurrent(ticket)) return;
      setState({
        phase: 'error', plan: null, ticket, notice: '',
        error: error instanceof Error ? error.message : '讀取個人規劃失敗，原資料仍保留。',
      });
    }
  }, [scopeKey, session]);

  useEffect(() => {
    void reload();
    return () => session.dispose();
  }, [reload, session]);

  async function save(
    next: CreditPlan,
    notice: string,
    ticket = state.ticket,
  ): Promise<SavedPlan | null> {
    if (state.phase === 'loading' || !session.isLive(ticket)) return null;
    if (!session.isCurrent(ticket)) {
      Alert.alert('規劃已更新', '這個確認畫面已過期。請重新檢視目前規劃後再操作，新的內容沒有被覆蓋。');
      return null;
    }
    if (!session.acquire(ticket)) return null;
    setSaving(true);
    try {
      await writeMobileCreditPlan(scopeKey, next);
      const savedTicket = session.finish(ticket, true);
      if (!savedTicket) return null;
      setState({ phase: 'ready', plan: next, ticket: savedTicket, notice, error: '' });
      return { plan: next, ticket: savedTicket };
    } catch (error) {
      if (session.finish(ticket, false)) {
        Alert.alert('規劃未儲存', error instanceof Error ? error.message : '無法存到這台裝置，原規劃沒有被取代。');
      }
      return null;
    } finally {
      if (session.isLive(ticket)) setSaving(false);
    }
  }

  return { ...state, saving, session, reload, save };
}
