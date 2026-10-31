import React, { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Switch, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { theme } from '../ui/theme';
import { nextClassWriter } from './nextClassBridge';

type Status = { supported: boolean; allowed: boolean; enabled: boolean };
const native = requireOptionalNativeModule<{
  liveActivityStatus(): Promise<Status>;
  setLiveActivityEnabled(enabled: boolean): Promise<void>;
}>('CampusNextClass');

export function liveActivityHint(status: Status): string {
  if (!status.allowed)
    return '即時動態被關掉了，下一堂課還是可以在 App 的課表裡查看。想放回鎖定畫面，可到系統設定開啟。';
  return status.enabled
    ? '上課前一小時，幫你把課名和教室放到鎖定畫面。開過 App 才會開始，之後沒開 App 的日子不一定會出現。'
    : '出門前少找一次課表。開啟後，鎖定畫面也能看到近期下一堂課。';
}
export function NextClassLiveActivitySetting() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !native?.liveActivityStatus) return;
    let mounted = true;
    const refresh = () =>
      native
        .liveActivityStatus()
        .then((value) => {
          if (mounted) setStatus(value);
        })
        .catch(() => {
          if (mounted) setError(true);
        });
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  if (Platform.OS !== 'ios' || !status?.supported) return null;
  const change = async (enabled: boolean) => {
    if (busy || (enabled && !status.allowed)) return;
    setBusy(true);
    setError(false);
    try {
      await native!.setLiveActivityEnabled(enabled);
      await nextClassWriter.refreshActivity();
      setStatus(await native!.liveActivityStatus());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ padding: 16, gap: 10, backgroundColor: theme.colors.surface, borderRadius: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', color: theme.colors.text }}>
        下一堂課即時動態
      </Text>
      <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>{liveActivityHint(status)}</Text>
      <Switch
        accessibilityLabel="下一堂課即時動態"
        value={status.enabled}
        disabled={busy || (!status.allowed && !status.enabled)}
        onValueChange={(value) => void change(value)}
      />
      {!status.allowed ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openSettings().catch(() => setError(true))}
        >
          <Text style={{ color: theme.colors.accent }}>前往系統設定</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.text }}>
          這次沒設定成功，請再試一次。課表仍然可以照常查看。
        </Text>
      ) : null}
    </View>
  );
}
