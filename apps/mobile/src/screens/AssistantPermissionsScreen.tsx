import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Switch, Text, View } from 'react-native';
import {
  ASSISTANT_WRITE_PERMISSION_DEFINITIONS,
  type AssistantWritePermissionKey,
  type AssistantWritePermissions,
} from '@campus/shared/src/assistantPermissions';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import {
  loadAssistantWritePermissionsState,
  saveAssistantWritePermissions,
  type AssistantPermissionState,
} from '../services/assistantPermissions';

type Props = { navigation?: { goBack?: () => void } };

export function AssistantPermissionsScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const scope = user?.uid ?? '';
  const active = useRef(scope);
  active.current = scope;
  if (!user) {
    return (
      <AIDetailScreen title="助理權限" onBack={() => navigation?.goBack?.()}>
        <AICard title="請先登入">
          <Text style={{ color: aiTokens.muted }}>登入後即可調整助理可執行的寫入動作。</Text>
        </AICard>
      </AIDetailScreen>
    );
  }
  return (
    <AssistantPermissionsEditor
      key={scope}
      navigation={navigation}
      uid={user.uid}
      isScopeCurrent={() => active.current === scope}
    />
  );
}

function AssistantPermissionsEditor({
  navigation,
  uid,
  isScopeCurrent,
}: {
  navigation?: Props['navigation'];
  uid: string;
  isScopeCurrent: () => boolean;
}) {
  const [state, setState] = useState<AssistantPermissionState | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | null>('load');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const current = () => mounted.current && isScopeCurrent();

  const load = async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy('load');
    setError('');
    try {
      const result = await loadAssistantWritePermissionsState(uid);
      if (current()) {
        setState(result);
        setDirty(false);
        setSaved(false);
        if (result.source === 'unavailable') {
          setError('無法讀取助理權限，已視為全部關閉。請確認網路後重試。');
        }
      }
    } catch {
      if (current()) setError('無法讀取助理權限，請確認網路後重試。');
    } finally {
      lock.current = false;
      if (current()) setBusy(null);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key: AssistantWritePermissionKey, value: boolean) => {
    if (lock.current || !current() || !state || state.source === 'unavailable') return;
    setState({
      ...state,
      permissions: { ...state.permissions, [key]: value },
    });
    setDirty(true);
    setSaved(false);
    setError('');
  };

  const save = async () => {
    if (lock.current || !current() || !state || state.source === 'unavailable') return;
    lock.current = true;
    setBusy('save');
    setError('');
    setSaved(false);
    try {
      await saveAssistantWritePermissions(uid, state.permissions);
      if (current()) {
        setSaved(true);
        setDirty(false);
        setState({ ...state, source: 'server' });
      }
    } catch {
      if (current()) setError('尚未確認設定已儲存，變更已保留在此頁。請重試儲存。');
    } finally {
      lock.current = false;
      if (current()) setBusy(null);
    }
  };

  const prefs: AssistantWritePermissions | undefined = state?.permissions;
  const disabled = !!busy || !prefs || state?.source === 'unavailable';

  return (
    <AIDetailScreen title="助理權限" onBack={() => navigation?.goBack?.()}>
      <AICard title="寫入動作">
        <Text style={{ color: aiTokens.muted, lineHeight: 22, marginBottom: 8 }}>
          預設全部關閉。開啟後，助理仍須每次請你確認才會執行。涵蓋服務寫入、助理餐廳草稿下單，以及拆待辦／設提醒等個人待辦佇列；學餐頁一般下單不受「餐廳下單」開關影響。網頁與手機共用同一份設定。
        </Text>
        <View style={{ gap: 4 }}>
          {ASSISTANT_WRITE_PERMISSION_DEFINITIONS.map((row) => (
            <View
              key={row.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: aiTokens.border,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: aiTokens.text, fontWeight: '600' }}>{row.label}</Text>
                <Text style={{ color: aiTokens.muted, lineHeight: 20, fontSize: 13 }}>
                  {row.description}
                </Text>
              </View>
              <Switch
                accessibilityLabel={row.label}
                value={prefs?.[row.key] ?? false}
                disabled={disabled}
                onValueChange={(value) => update(row.key, value)}
              />
            </View>
          ))}
        </View>
      </AICard>

      {error ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
            {error}
          </Text>
        </AICard>
      ) : null}
      {saved ? (
        <AICard>
          <Text accessibilityRole="text" style={{ color: aiTokens.muted }}>
            助理權限已儲存。
          </Text>
        </AICard>
      ) : null}

      <AIButton
        label={busy === 'save' ? '儲存中…' : dirty ? '儲存助理權限' : '儲存助理權限'}
        disabled={disabled || !dirty}
        onPress={() => void save()}
      />
      {busy === 'load' ? (
        <Text style={{ color: aiTokens.muted, textAlign: 'center' }}>正在讀取設定…</Text>
      ) : null}
    </AIDetailScreen>
  );
}

export default AssistantPermissionsScreen;
