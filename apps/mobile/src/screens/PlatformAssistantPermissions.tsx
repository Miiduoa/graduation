import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { NuniError } from '@campus/shared/src/nuni';
import {
  PLATFORM_ASSISTANT_PERMISSION_DEFINITIONS,
  createDefaultPlatformAssistantPermissions,
  type PlatformAssistantPermissionState,
} from '@campus/shared/src/platformAssistantPermissions';
import type { useOptionalNuniSession } from '../state/nuniSession';
import { AIButton, AICard, aiTokens } from '../ui/aiFirst';
import {
  loadPlatformAssistantPermissions,
  savePlatformAssistantPermissions,
  type PlatformAssistantPermissionScope,
} from '../services/platformAssistantPermissions';

type PlatformAuth = NonNullable<ReturnType<typeof useOptionalNuniSession>>;

export function PlatformAssistantPermissions({ auth }: { auth: PlatformAuth }) {
  const latest = useRef(auth);
  latest.current = auth;
  if (auth.loading)
    return (
      <AICard>
        <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.muted }}>
          正在確認 Google 帳號…
        </Text>
      </AICard>
    );
  if (auth.pendingLogout || auth.error)
    return (
      <AICard title="Google 帳號需要重新確認">
        <Text
          accessibilityRole="alert"
          style={{ color: aiTokens.danger, lineHeight: 22, marginBottom: 12 }}
        >
          {auth.pendingLogout
            ? 'Google 帳號登出尚未完成，暫時無法變更權限。'
            : '目前無法確認 Google 帳號，請重新連線後再試。'}
        </Text>
        <AIButton
          label={auth.pendingLogout ? '重試登出 Google 帳號' : '重新確認 Google 帳號'}
          onPress={() => void (auth.pendingLogout ? auth.logout() : auth.refresh())}
        />
      </AICard>
    );
  if (!auth.session) return null;
  const { platformAccountId: accountId, context } = auth.session;
  const scope: PlatformAssistantPermissionScope = {
    accountId,
    context,
    request: auth.bffRequest,
    isCurrent: () => {
      const active = latest.current;
      return (
        !active.loading &&
        !active.pendingLogout &&
        !active.error &&
        active.session?.platformAccountId === accountId &&
        active.session.context === context &&
        active.isSessionCurrent(accountId, context)
      );
    },
  };
  return <PlatformAssistantPermissionEditor key={`${accountId}:${context}`} scope={scope} />;
}

function PlatformAssistantPermissionEditor({ scope }: { scope: PlatformAssistantPermissionScope }) {
  const latest = useRef(scope);
  latest.current = scope;
  const mounted = useRef(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const [snapshot, setSnapshot] = useState<PlatformAssistantPermissionState | null>(null);
  const [draft, setDraft] = useState(createDefaultPlatformAssistantPermissions);
  const [busy, setBusy] = useState<'load' | 'save' | null>('load');
  const [message, setMessage] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [saved, setSaved] = useState(false);
  const current = useCallback(() => mounted.current && latest.current.isCurrent(), []);

  const load = useCallback(async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    const run = ++generation.current;
    setBusy('load');
    setMessage('');
    setSaved(false);
    try {
      const result = await loadPlatformAssistantPermissions(latest.current);
      if (!current() || run !== generation.current) return;
      setSnapshot(result);
      setDraft(result.permissions);
      setNeedsReload(false);
    } catch {
      if (!current() || run !== generation.current) return;
      setSnapshot(null);
      setDraft(createDefaultPlatformAssistantPermissions());
      setNeedsReload(true);
      setMessage('暫時無法讀取 AI 代辦權限。請重新讀取後再調整。');
    } finally {
      if (run === generation.current) {
        lock.current = false;
        if (current()) setBusy(null);
      }
    }
  }, [current]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      lock.current = false;
    };
  }, [load]);

  const dirty =
    !!snapshot &&
    (draft.createPersonalEvent !== snapshot.permissions.createPersonalEvent ||
      draft.prepareFoodOrder !== snapshot.permissions.prepareFoodOrder);
  const save = async () => {
    if (!snapshot || !dirty || needsReload || lock.current || !current()) return;
    lock.current = true;
    const run = ++generation.current;
    setBusy('save');
    setMessage('');
    setSaved(false);
    try {
      const result = await savePlatformAssistantPermissions(latest.current, snapshot, draft);
      if (!current() || run !== generation.current) return;
      setSnapshot(result);
      setDraft(result.permissions);
      setSaved(true);
    } catch (error) {
      if (!current() || run !== generation.current) return;
      setNeedsReload(true);
      setMessage(
        error instanceof NuniError && error.status === 409
          ? '帳號或權限已變更，這次設定尚未確認。請重新讀取後再調整。'
          : '尚未確認權限已儲存。請重新讀取最新設定後再試。',
      );
    } finally {
      if (run === generation.current) {
        lock.current = false;
        if (current()) setBusy(null);
      }
    }
  };

  const disabled = !!busy || !snapshot || needsReload;
  return (
    <View>
      <AICard title="Google 帳號的代辦動作">
        <Text style={{ color: aiTokens.muted, lineHeight: 22, marginBottom: 12 }}>
          預設開啟，每次執行仍需確認。網頁與手機共用這個 Google 帳號的設定。
        </Text>
        {PLATFORM_ASSISTANT_PERMISSION_DEFINITIONS.map((row) => (
          <View
            key={row.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: aiTokens.border,
            }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: aiTokens.text, fontWeight: '600' }}>{row.label}</Text>
              <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 20 }}>
                {row.description}
              </Text>
            </View>
            <Switch
              accessibilityLabel={row.label}
              accessibilityHint={row.description}
              value={draft[row.key]}
              disabled={disabled}
              onValueChange={(value) => {
                if (disabled || lock.current || !current()) return;
                setDraft((previous) => ({ ...previous, [row.key]: value }));
                setSaved(false);
              }}
            />
          </View>
        ))}
        <Text style={{ color: aiTokens.muted, lineHeight: 20, fontSize: 13, marginTop: 12 }}>
          關閉只影響助理代辦，不會關閉 AI 對話或一般服務。學校帳號的校內權限另行設定。
        </Text>
      </AICard>
      {busy === 'load' && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: aiTokens.muted, textAlign: 'center' }}
        >
          正在讀取 AI 代辦權限…
        </Text>
      )}
      {message && (
        <AICard>
          <Text
            accessibilityRole="alert"
            style={{ color: aiTokens.danger, lineHeight: 22, marginBottom: 12 }}
          >
            {message}
          </Text>
          <AIButton label="重新讀取權限" disabled={busy !== null} onPress={() => void load()} />
        </AICard>
      )}
      {saved && (
        <AICard>
          <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.muted }}>
            AI 代辦權限已儲存。
          </Text>
        </AICard>
      )}
      <View style={{ paddingHorizontal: 16, gap: 12, marginBottom: 20 }}>
        {dirty && <Text style={{ color: aiTokens.muted }}>有尚未儲存的變更。</Text>}
        <AIButton
          label={busy === 'save' ? '儲存中…' : '儲存 AI 代辦權限'}
          disabled={disabled || !dirty}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}
