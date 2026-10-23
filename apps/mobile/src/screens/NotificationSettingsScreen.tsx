import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  type NotificationPreferences,
  type NotificationPreferenceState,
  type PushRegistrationResult,
  loadNotificationPreferencesState,
  saveNotificationPreferences,
  enablePushNotificationsForUser,
  openNotificationSettings,
  isNotificationTime,
} from '../services/notifications';

type BooleanKey = Exclude<keyof NotificationPreferences, 'quietHoursStart' | 'quietHoursEnd'>;
const categories: Array<{ key: BooleanKey; label: string }> = [
  { key: 'announcements', label: '公告通知' },
  { key: 'events', label: '活動通知' },
  { key: 'groups', label: '群組通知' },
  { key: 'assignments', label: '作業通知' },
  { key: 'grades', label: '成績通知' },
  { key: 'messages', label: '私訊通知' },
];
const pushMessages: Record<PushRegistrationResult['status'], string> = {
  enabled: '這台裝置已完成推播註冊。',
  denied: '系統通知權限已關閉，請到裝置設定開啟。',
  unsupported: '此裝置目前不支援推播註冊，請使用手機上的正式版本。',
  unconfigured: '此版本尚未完成推播服務設定，請待更新後重試。',
  unavailable: '暫時無法完成推播註冊，請確認網路後重試。',
};

type Props = { navigation?: { goBack?: () => void } };

export function NotificationSettingsScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const active = useRef(scope);
  active.current = scope;
  if (!user)
    return (
      <AIDetailScreen title="通知設定" onBack={() => navigation?.goBack?.()}>
        <AICard title="請先登入">
          <Text style={{ color: aiTokens.muted }}>登入後即可調整通知設定。</Text>
        </AICard>
      </AIDetailScreen>
    );
  return (
    <NotificationEditor
      key={scope}
      navigation={navigation}
      uid={user.uid}
      schoolId={school.id}
      isScopeCurrent={() => active.current === scope}
    />
  );
}

function NotificationEditor({
  navigation,
  uid,
  schoolId,
  isScopeCurrent,
}: {
  navigation?: Props['navigation'];
  uid: string;
  schoolId: string;
  isScopeCurrent: () => boolean;
}) {
  const [state, setState] = useState<NotificationPreferenceState | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'push' | null>('load');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<'server' | 'local' | null>(null);
  const [push, setPush] = useState<PushRegistrationResult['status'] | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const current = () => mounted.current && isScopeCurrent();
  const scope = { schoolId, isCurrent: current };
  const load = async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy('load');
    setError('');
    try {
      const result = await loadNotificationPreferencesState(uid, scope);
      if (current()) {
        setState(result);
        setDirty(false);
        setSaved(null);
      }
    } catch {
      if (current()) setError('無法讀取通知設定，請確認網路後重試。');
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
    // A new keyed editor owns each account and school context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const update = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => {
    if (lock.current || !current() || !state || state.source === 'unavailable') return;
    setState({ ...state, preferences: { ...state.preferences, [key]: value } });
    setDirty(true);
    setSaved(null);
    setError('');
  };
  const save = async () => {
    if (lock.current || !current() || !state || state.source === 'unavailable') return;
    if (
      !isNotificationTime(state.preferences.quietHoursStart) ||
      !isNotificationTime(state.preferences.quietHoursEnd)
    ) {
      setError('免打擾時間請使用 24 小時制，例如 22:30。');
      return;
    }
    lock.current = true;
    setBusy('save');
    setError('');
    setSaved(null);
    try {
      const result = await saveNotificationPreferences(uid, state.preferences, scope);
      if (current()) {
        setSaved(result.status);
        setState({ ...state, source: result.status });
        setDirty(false);
      }
    } catch {
      if (current()) setError('尚未確認設定已儲存，變更已保留在此頁。請重試儲存。');
    } finally {
      lock.current = false;
      if (current()) setBusy(null);
    }
  };
  const enablePush = async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy('push');
    setPush(null);
    try {
      const result = await enablePushNotificationsForUser(uid, current);
      if (current()) setPush(result.status);
    } catch {
      if (current()) setPush('unavailable');
    } finally {
      lock.current = false;
      if (current()) setBusy(null);
    }
  };
  const prefs = state?.preferences;
  const disabled = !!busy || !prefs || state?.source === 'unavailable';
  const toggle = (key: BooleanKey, label: string, dependent = false) => (
    <View
      key={key}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: aiTokens.text, flex: 1 }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={prefs?.[key] ?? false}
        disabled={disabled || (dependent && !prefs?.enabled)}
        onValueChange={(value) => update(key, value)}
        trackColor={{ false: aiTokens.border, true: aiTokens.ai }}
      />
    </View>
  );
  return (
    <AIDetailScreen title="通知設定" onBack={() => navigation?.goBack?.()}>
      <AICard title="通知設定">
        <View style={{ gap: 12 }}>
          <Text style={{ color: aiTokens.muted }}>
            設定適用此帳號。系統通知權限需在每台裝置分別開啟。
          </Text>
          {busy === 'load' ? <Text style={{ color: aiTokens.muted }}>正在讀取設定…</Text> : null}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
              {error}
            </Text>
          ) : null}
          {(!state || state.source === 'unavailable') && !busy ? (
            <>
              <Text style={{ color: aiTokens.muted }}>
                尚未取得帳號的通知設定。連線後讀取，才能繼續修改。
              </Text>
              <AIButton label="重新讀取" onPress={() => void load()} />
            </>
          ) : null}
          {state?.source === 'cache' && !dirty ? (
            <Text style={{ color: aiTokens.muted }}>
              目前顯示此裝置保留的設定，尚未確認伺服器的最新內容。
            </Text>
          ) : null}
          {(state?.source === 'local' || saved === 'local') && !dirty ? (
            <Text style={{ color: aiTokens.muted }}>
              設定已保留在這台裝置，尚未確認伺服器已儲存。請連線後重試儲存。
            </Text>
          ) : null}
          {saved === 'server' && !dirty ? (
            <Text style={{ color: aiTokens.ai }}>設定已儲存至帳號。</Text>
          ) : null}
          {dirty ? <Text style={{ color: aiTokens.muted }}>有尚未儲存的變更。</Text> : null}
          {prefs ? toggle('enabled', '通知總開關') : null}
        </View>
      </AICard>
      {prefs && state?.source !== 'unavailable' ? (
        <>
          <AICard title="通知類型">
            {categories.map(({ key, label }) => toggle(key, label, true))}
          </AICard>
          <AICard title="免打擾">
            <View style={{ gap: 12 }}>
              {toggle('quietHoursEnabled', '啟用免打擾', true)}
              <Text style={{ color: aiTokens.muted }}>使用 24 小時制設定時段。</Text>
              {(['quietHoursStart', 'quietHoursEnd'] as const).map((key, index) => (
                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ color: aiTokens.text }}>{index === 0 ? '開始' : '結束'}</Text>
                  <TextInput
                    accessibilityLabel={index === 0 ? '免打擾開始時間' : '免打擾結束時間'}
                    value={prefs[key]}
                    editable={!disabled && prefs.enabled && prefs.quietHoursEnabled}
                    onChangeText={(value) => update(key, value)}
                    placeholder="22:30"
                    placeholderTextColor={aiTokens.muted}
                    maxLength={5}
                    style={{
                      color: aiTokens.text,
                      borderColor: aiTokens.border,
                      borderWidth: 1,
                      borderRadius: 12,
                      padding: 12,
                      minWidth: 100,
                    }}
                  />
                </View>
              ))}
            </View>
          </AICard>
          <View style={{ marginHorizontal: aiTokens.space.md, marginBottom: aiTokens.space.md }}>
            <AIButton
              label={
                busy === 'save'
                  ? '正在儲存…'
                  : error || state.source === 'local'
                    ? '重試儲存'
                    : '儲存設定'
              }
              disabled={disabled}
              onPress={() => void save()}
            />
          </View>
        </>
      ) : null}
      <AICard title="這台裝置的推播">
        <View style={{ gap: 12 }}>
          {push ? (
            <Text style={{ color: push === 'enabled' ? aiTokens.ai : aiTokens.muted }}>
              {pushMessages[push]}
            </Text>
          ) : (
            <Text style={{ color: aiTokens.muted }}>
              開啟系統權限並註冊這台裝置，才能接收推播。
            </Text>
          )}
          <AIButton
            label={busy === 'push' ? '正在設定…' : push ? '重新檢查推播' : '啟用推播通知'}
            disabled={!!busy}
            onPress={() => void enablePush()}
          />
          {push === 'denied' ? (
            <AIButton
              label="開啟系統設定"
              variant="ghost"
              disabled={!!busy}
              onPress={openNotificationSettings}
            />
          ) : null}
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
