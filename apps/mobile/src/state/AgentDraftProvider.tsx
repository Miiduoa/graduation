import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Modal } from '../ui/Modal';
import { theme } from '../ui/theme';
import { aiOverlay } from '../app/useAIOverlay';
import { useAuth } from './auth';
import { useOptionalNuniSession } from './nuniSession';
import { useSchool } from './school';

type Confirmation = { epoch: number; finish: (accepted: boolean) => void };
type DraftKind = 'navigation' | 'saved';
type Store = {
  uid: string;
  accountId: string;
  schoolId: string;
  navigation: string;
  saved: string;
  retryReadyAt: number | null;
  epoch: number;
  ownerEpoch: number;
  activity: string;
  ready: boolean;
};
export type AgentDraftContextValue = {
  ownerKey: string;
  epoch: number;
  ready: boolean;
  navigation: string;
  saved: string;
  retryReadyAt: number | null;
  setDraft: (kind: DraftKind, text: string) => void;
  retainQuota: (readyAt: number) => void;
  consumePrompt: (entry: string | object, prompt: string) => void;
  isCurrent: () => boolean;
};
const Context = createContext<AgentDraftContextValue | null>(null);

/** Ephemeral text and quota only. Plans, consent and receipts belong to the active screen. */
export function AgentDraftProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const nuni = useOptionalNuniSession();
  const { school, registerSelectionGuard } = useSchool();
  const [, redraw] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const pendingConfirmation = useRef<Confirmation | null>(null);
  const storeRef = useRef<Store | null>(null);
  const mounted = useRef(true);
  const entries = useRef(new Set<string | object>());
  const pendingPrompts = useRef(new Map<string | object, { ownerEpoch: number; text: string }>());
  const previous = storeRef.current;
  const uid = auth.user?.uid ?? (auth.loading ? previous?.uid ?? '' : '');
  // Native refresh hides the principal and rotates context, even for the same account.
  const accountId = nuni?.session?.platformAccountId ??
    (nuni && (nuni.loading || nuni.error) && !nuni.pendingLogout ? previous?.accountId ?? '' : '');
  const ready = !auth.loading && !auth.profileLoading && !auth.tokenExpired && !auth.error &&
    (!nuni || (!nuni.loading && !nuni.error && !nuni.pendingLogout));
  const activity = JSON.stringify([
    uid, accountId, school.id, ready, nuni?.session?.context ?? '',
    nuni?.session?.isPlatformOperator ?? false, auth.profile?.role ?? '',
    auth.profile?.schoolMembershipRole ?? '', auth.profile?.schoolMembershipSchoolId ?? '',
  ]);
  const ownerChanged = previous && (
    previous.uid !== uid || previous.accountId !== accountId || previous.schoolId !== school.id
  );
  if (!previous || ownerChanged) {
    pendingPrompts.current.clear();
    storeRef.current = {
      uid, accountId, schoolId: school.id, navigation: '', saved: '', retryReadyAt: null,
      epoch: (previous?.epoch ?? -1) + 1, ownerEpoch: (previous?.ownerEpoch ?? -1) + 1, activity, ready,
    };
  } else if (previous.activity !== activity) {
    storeRef.current = { ...previous, epoch: previous.epoch + 1, activity, ready };
  }
  const store = storeRef.current!;
  if (ready && pendingPrompts.current.size) {
    for (const pending of pendingPrompts.current.values()) {
      if (pending.ownerEpoch !== store.ownerEpoch) continue;
      if (!store.navigation) store.navigation = pending.text.slice(0, 240);
      if (!store.saved) store.saved = pending.text.slice(0, 1600);
    }
    pendingPrompts.current.clear();
  }
  const epoch = store.epoch;
  const ownerKey = JSON.stringify([store.uid, store.accountId, store.schoolId, store.ownerEpoch]);
  // Host compares this binding during render, before a stale overlay can expose its prompt.
  aiOverlay.bindScope?.(ownerKey);
  useLayoutEffect(() => { aiOverlay.closeStale?.(ownerKey); }, [ownerKey]);
  const isCurrent = useCallback(() => mounted.current && storeRef.current?.epoch === epoch && storeRef.current.ready, [epoch]);
  const update = useCallback((change: (current: Store) => void) => {
    const current = storeRef.current;
    if (!mounted.current || !current || current.epoch !== epoch || !current.ready) return;
    change(current);
    redraw((value) => value + 1);
  }, [epoch]);
  const setDraft = useCallback((kind: DraftKind, text: string) => {
    update((current) => { current[kind] = text.slice(0, kind === 'navigation' ? 240 : 1600); });
  }, [update]);
  const retainQuota = useCallback((readyAt: number) => {
    if (!Number.isFinite(readyAt) || readyAt <= Date.now()) return;
    update((current) => { current.retryReadyAt = Math.max(current.retryReadyAt ?? 0, readyAt); });
  }, [update]);
  const consumePrompt = useCallback((entry: string | object, prompt: string) => {
    const current = storeRef.current;
    if (!mounted.current || !current || current.epoch !== epoch || entries.current.has(entry)) return;
    entries.current.add(entry);
    if (!current.ready) {
      pendingPrompts.current.set(entry, { ownerEpoch: current.ownerEpoch, text: prompt.slice(0, 1600) });
      return;
    }
    update((active) => {
      // A route suggestion never overwrites text already being edited.
      if (!active.navigation) active.navigation = prompt.slice(0, 240);
      if (!active.saved) active.saved = prompt.slice(0, 1600);
    });
  }, [epoch, update]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingConfirmation.current?.finish(false);
    };
  }, []);

  useLayoutEffect(() => {
    if (pendingConfirmation.current?.epoch !== epoch) pendingConfirmation.current?.finish(false);
  }, [epoch]);

  useLayoutEffect(() => {
    if (!registerSelectionGuard) return;
    return registerSelectionGuard(() => {
      const current = storeRef.current;
      const hasPendingText = [...pendingPrompts.current.values()].some((pending) => pending.text.trim());
      if (!current || (!current.navigation.trim() && !current.saved.trim() && !hasPendingText)) return true;
      if (!current.ready) return false;
      const expectedEpoch = current.epoch;
      pendingConfirmation.current?.finish(false);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (accepted: boolean) => {
          if (settled) return;
          settled = true;
          if (pendingConfirmation.current?.finish === finish) {
            pendingConfirmation.current = null;
            if (mounted.current) setConfirmation(null);
          }
          resolve(accepted && mounted.current && storeRef.current?.epoch === expectedEpoch && storeRef.current.ready);
        };
        const next = { epoch: expectedEpoch, finish };
        pendingConfirmation.current = next;
        setConfirmation(next);
      });
    }, () => {
      const current = storeRef.current;
      if (!current) return;
      storeRef.current = {
        ...current, navigation: '', saved: '', retryReadyAt: null, epoch: current.epoch + 1,
      };
      redraw((value) => value + 1);
    });
  }, [registerSelectionGuard]);

  return <Context.Provider value={{
    ownerKey, epoch, ready, navigation: ready ? store.navigation : '', saved: ready ? store.saved : '',
    retryReadyAt: store.retryReadyAt, setDraft, retainQuota, consumePrompt, isCurrent,
  }}>
    {children}
    {confirmation && confirmation.epoch === epoch && ready && (
      <Modal
        visible
        title="切換校園？"
        closeOnBackdrop
        onClose={() => confirmation.finish(false)}
        footer={
          <View style={{ flex: 1, gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消"
              onPress={() => confirmation.finish(false)}
              style={{ minHeight: 44, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 16 }}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除草稿並切換"
              onPress={() => confirmation.finish(true)}
              style={{ minHeight: 44, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.danger, borderRadius: theme.radius.md }}
            >
              <Text style={{ color: theme.colors.danger, fontSize: 16 }}>清除草稿並切換</Text>
            </Pressable>
          </View>
        }
      >
        <Text style={{ color: theme.colors.text, fontSize: 15, lineHeight: 23 }}>
          校園助理還有草稿。切換後會清除文字，新的查詢需要重新預覽與確認。你也可以取消，繼續編輯。
        </Text>
      </Modal>
    )}
  </Context.Provider>;
}

export function useOptionalAgentDrafts() { return useContext(Context); }
