import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { classRemindersEnabled, setClassRemindersEnabled } from '../services/classReminders';
import { notifyTimetableChanged } from '../widgets/timetableChanges';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';

export function ClassReminderToggle({ scope }: { scope: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    classRemindersEnabled(scope)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) setError('提醒設定暫時讀不到，請重新開啟課表。');
      });
    return () => {
      active = false;
    };
  }, [scope]);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.muted }}>
        課前 10
        分鐘提醒會套用停課與補課。每次開啟或修改課表後更新未來七天；離線期間無法得知其他裝置的新安排。
      </Text>
      <Button
        text={enabled ? '關閉課前提醒' : '開啟課前提醒'}
        disabled={busy || enabled === null}
        onPress={async () => {
          setBusy(true);
          setError('');
          try {
            await setClassRemindersEnabled(scope, !enabled);
            setEnabled(!enabled);
            notifyTimetableChanged();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '尚未變更提醒設定。');
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
