import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import {
  savedAssignmentReminderPreferences,
  cancelSubmittedAssignmentReminder,
} from '../services/submittedAssignmentReminders';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import {
  adoptCampusReminderSnapshot,
  unlinkedLegacyReminders,
  clearUnlinkedLegacyReminders,
} from '../services/campusAssignmentReminders';

export function LegacyAssignmentReminders({
  uid,
  schoolId,
  snapshot,
  isCurrent,
}: {
  uid: string;
  schoolId: string;
  snapshot: CampusSenseSnapshot | null;
  isCurrent: () => boolean;
}) {
  useThemeVersion();
  const [preferences, setPreferences] = useState<
    Awaited<ReturnType<typeof savedAssignmentReminderPreferences>>
  >([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef({ isCurrent, snapshot, uid, schoolId });
  latest.current = { isCurrent, snapshot, uid, schoolId };
  const checkedAt = snapshot?.checkedAt;
  useEffect(() => {
    let active = true;
    const current = () =>
      active &&
      latest.current.uid === uid &&
      latest.current.schoolId === schoolId &&
      latest.current.isCurrent();
    if (!uid || !schoolId) return;
    void (async () => {
      await adoptCampusReminderSnapshot({
        scope: { uid, schoolId },
        snapshot: latest.current.snapshot,
        isCurrent: current,
      });
      const rows = await unlinkedLegacyReminders();
      const saved = await savedAssignmentReminderPreferences({ uid, schoolId }, current);
      if (current()) {
        setCount(rows.length);
        setPreferences(saved);
        setError('');
      }
    })().catch(() => {
      if (current()) setError('無法核對舊版提醒，請重新開啟此頁重試。');
    });
    return () => {
      active = false;
    };
  }, [uid, schoolId, checkedAt]);
  const clear = async () => {
    if (busy || !isCurrent()) return;
    setBusy(true);
    setError('');
    try {
      await clearUnlinkedLegacyReminders({ scope: { uid, schoolId }, isCurrent });
      if (isCurrent()) setCount(0);
    } catch {
      if (isCurrent()) setError('尚未確認取消成功，請重試。');
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const unsubscribe = async (row: (typeof preferences)[number]) => {
    if (busy || !isCurrent()) return;
    setBusy(true);
    setError('');
    try {
      const matching = preferences.filter(
        (other) => other.groupId === row.groupId && other.assignmentId === row.assignmentId,
      );
      for (const preference of matching)
        await cancelSubmittedAssignmentReminder({
          scope: { uid, schoolId },
          source: preference,
          leadMinutes: preference.leadMinutes,
          isCurrent,
        });
      if (isCurrent())
        setPreferences(await savedAssignmentReminderPreferences({ uid, schoolId }, isCurrent));
    } catch {
      if (isCurrent()) setError('尚未確認退訂成功，請重試。');
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const assignments = preferences.filter(
    (row, index) =>
      preferences.findIndex(
        (other) => other.groupId === row.groupId && other.assignmentId === row.assignmentId,
      ) === index,
  );
  if (!count && !error && !preferences.length) return null;
  const clearDisabled = busy || !count;
  return (
    <View
      accessibilityLabel="舊版作業提醒管理"
      style={{
        marginHorizontal: theme.layout.screenHorizontalPadding,
        marginVertical: theme.space.sm,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: theme.space.sm,
      }}
    >
      {count ? (
        <View style={{ gap: theme.space.sm }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 13,
              lineHeight: 20,
            }}
          >
            這台手機有 {count}{' '}
            筆尚未辨識的舊版作業提醒。請先同步校園資料以配對；名稱或截止時間改變後無法還原作業來源，仍可能響鈴。新增提醒前，請取消這些舊提醒，再為需要的作業重新設定。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: clearDisabled, busy }}
            disabled={clearDisabled}
            onPress={() => void clear()}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: theme.space.md,
              paddingVertical: 10,
              borderRadius: theme.radius.md,
              backgroundColor: clearDisabled ? theme.colors.disabledBg : theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed && !clearDisabled ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                color: clearDisabled ? theme.colors.disabledText : theme.colors.onAccent,
                fontSize: 14,
                fontWeight: '600',
              }}
            >
              {busy ? '正在取消舊提醒…' : '取消所有未辨識的舊版作業提醒'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {assignments.length ? (
        <View
          style={{
            borderTopWidth: count ? StyleSheet.hairlineWidth : 0,
            borderTopColor: theme.colors.separator,
            paddingTop: count ? theme.space.sm : 0,
          }}
        >
          {assignments.map((row, index) => (
            <View
              key={row.identifier}
              style={{
                paddingVertical: 10,
                gap: 6,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.separator,
              }}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 14,
                  fontWeight: '600',
                  lineHeight: 20,
                }}
              >
                {row.title || '已保存的作業提醒'}：
                {row.scheduled ? '已設定通知' : '已保留偏好，目前暫停'}
              </Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 12,
                  lineHeight: 18,
                }}
              >
                {row.lastDueAt
                  ? `截止：${new Date(row.lastDueAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
                  : '截止時間待核對'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy, busy }}
                disabled={busy}
                onPress={() => void unsubscribe(row)}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start',
                  minHeight: 44,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: theme.radius.md,
                  backgroundColor: busy ? theme.colors.disabledBg : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  justifyContent: 'center',
                  opacity: pressed && !busy ? 0.8 : 1,
                })}
              >
                <Text
                  style={{
                    color: busy ? theme.colors.disabledText : theme.colors.text,
                    fontSize: 13,
                    fontWeight: '600',
                  }}
                >
                  {`退訂${row.title || '這份作業'}的所有提醒`}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {preferences.length ? (
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          暫停偏好每 15 分鐘核對，截止後 7 天或暫停滿 30 天清理；退訂後不再自動恢復。
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: theme.colors.danger,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
