import { useLayoutEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import type { createCreditPlanSession, CreditPlanTicket } from '../../features/academics/creditPlanSession';

type GuardState = {
  inputs: object;
  ticket: CreditPlanTicket;
  session: Pick<ReturnType<typeof createCreditPlanSession>, 'isCurrent'>;
  busy: boolean;
};
type Confirmation = {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  destructive?: boolean;
};

/** Confirmations authorize one action on one committed input/session snapshot. */
export function useCreditPlanDraftProtection(state: GuardState) {
  const latest = useRef(state);
  const pending = useRef<symbol | null>(null);
  useLayoutEffect(() => { latest.current = state; });
  useLayoutEffect(() => () => { pending.current = null; }, []);

  return function confirmAction(needed: boolean, action: () => void, prompt: Confirmation) {
    const expected = latest.current;
    if (pending.current || expected.busy || !expected.session.isCurrent(expected.ticket)) return;
    if (!needed) { action(); return; }
    const id = Symbol('credit-draft-confirmation');
    pending.current = id;
    const release = () => { if (pending.current === id) pending.current = null; };
    Alert.alert(prompt.title, prompt.message, [
      { text: prompt.cancelText ?? '繼續編輯', style: 'cancel', onPress: release },
      { text: prompt.confirmText, style: prompt.destructive === false ? 'default' : 'destructive',
        onPress: () => {
          if (pending.current !== id) return;
          release();
          const current = latest.current;
          if (current.busy || current.inputs !== expected.inputs ||
            !expected.session.isCurrent(expected.ticket)) return;
          action();
        } },
    ], { cancelable: true, onDismiss: release });
  };
}

/** Use React Navigation's native-stack-aware guard, not only a custom back button. */
export function CreditPlanNavigationGuard({ preventRemove, onAttemptLeave, dispatch }: {
  preventRemove: boolean;
  onAttemptLeave: (leave: () => void) => void;
  dispatch: (action: NavigationAction) => void;
}) {
  usePreventRemove(preventRemove, ({ data }) => onAttemptLeave(() => dispatch(data.action)));
  return null;
}
