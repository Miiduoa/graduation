import React, { useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { rootNavigateNested } from '../app/rootNavigation';
import { toPublicSchoolId } from '../data/schoolIds';
import {
  getSchoolLoginSyncSnapshot,
  isSchoolLoginSyncOwner,
  setSchoolLoginSyncCollapsed,
  subscribeSchoolLoginSync,
  type SchoolSyncPhase,
} from '../services/schoolLoginSync';
import type { SchoolSyncItem } from '../services/schoolSyncSummary';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

const PHASE_COPY: Record<SchoolSyncPhase, string> = {
  campus: '正在讀取 e 校園課表與成績…',
  learning: '正在同步校務與 WOW Class 課程…',
  finishing: '正在整理本次同步結果…',
};

const DESTINATIONS: Record<SchoolSyncItem['key'], { route: string; label: string }> = {
  timetable: { route: 'PersonalTimetable', label: '查看課表' },
  grades: { route: 'Grades', label: '查看成績' },
  credits: { route: 'CreditAuditStack', label: '查看學分' },
  learning: { route: 'CoursesHome', label: '查看課程' },
};

/** This notice survives the public-login navigation tree being replaced after Firebase sign-in. */
export function SchoolLoginSyncNotice({ inset = false }: { inset?: boolean }) {
  const styles = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { school } = useSchool();
  const value = useSyncExternalStore(
    subscribeSchoolLoginSync,
    getSchoolLoginSyncSnapshot,
    getSchoolLoginSyncSnapshot,
  );
  if (
    !isSchoolLoginSyncOwner(value, auth.user, school.id) ||
    auth.loading ||
    auth.profileLoading ||
    auth.tokenExpired ||
    auth.profile?.uid !== auth.user?.uid ||
    toPublicSchoolId(auth.profile?.schoolId) !== value.attempt.schoolId
  )
    return null;

  const syncing = value.status === 'syncing';
  const incomplete = value.status === 'interrupted' || value.summary?.incomplete;
  const title = syncing ? '本次登入同步中' : incomplete ? '本次登入同步尚有缺項' : '本次登入同步完成';
  const time = new Date(value.completedAt ?? value.startedAt).toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const open = (key: SchoolSyncItem['key']) => rootNavigateNested(
    '學習', DESTINATIONS[key].route, key === 'credits' ? { screen: 'CreditAudit' } : undefined,
  );

  return (
    <View style={[styles.card, inset && styles.inset]} testID="school-login-sync-notice">
      <View style={styles.header}>
        {syncing ? (
          <ActivityIndicator color={theme.colors.accent} accessibilityLabel="同步學校資料" />
        ) : null}
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.note} accessibilityLiveRegion="polite">
            {syncing ? PHASE_COPY[value.phase] : `${time} 登入時的讀取結果`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={value.collapsed ? '展開學校資料同步結果' : '收起學校資料同步結果'}
          accessibilityState={{ expanded: !value.collapsed }}
          onPress={() => setSchoolLoginSyncCollapsed(value.attempt, !value.collapsed)}
          style={styles.toggle}
        >
          <Text style={styles.link}>{value.collapsed ? '展開' : '收起'}</Text>
        </Pressable>
      </View>
      {!value.collapsed ? (
        <View style={styles.detail}>
          {syncing ? (
            <Text style={styles.note}>你可以先使用其他功能，完成後會在這裡顯示各項結果。</Text>
          ) : null}
          {value.summary?.items.map((item) => (
            <View key={item.key} style={styles.row}>
              <View style={styles.heading}>
                <Text style={styles.label}>
                  {item.title} · {item.source}
                </Text>
                <Text style={[styles.note, item.state === 'unavailable' && styles.unavailable]}>
                  {item.detail}
                </Text>
                {item.key === 'credits' ? <Text style={styles.note}>校方學分累計請到學分頁讀取。</Text> : null}
              </View>
              {item.state !== 'disabled' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={DESTINATIONS[item.key].label}
                  onPress={() => open(item.key)}
                  style={styles.action}
                >
                  <Text style={styles.link}>{DESTINATIONS[item.key].label}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {value.status === 'interrupted' ? (
            <>
              <Text style={styles.note}>這次同步未完成，可到各項課務頁重新讀取。</Text>
              <View style={styles.recovery}>
                {(['timetable', 'grades', 'credits', 'learning'] as const).map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    onPress={() => open(key)}
                    style={styles.action}
                  >
                    <Text style={styles.link}>{DESTINATIONS[key].label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {!syncing && (
            <Text style={styles.note}>這是本次登入同步的範圍；各頁另行更新的結果請到該頁查看。學分正式採計仍以校方審核為準。</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    card: {
      marginVertical: 8,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
    },
    inset: { marginHorizontal: 20 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    heading: { flex: 1, minWidth: 0, gap: 4 },
    title: { color: theme.colors.text, fontSize: 16, fontWeight: '700', lineHeight: 23 },
    label: { color: theme.colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21 },
    note: { color: theme.colors.muted, fontSize: 13, lineHeight: 20 },
    unavailable: { color: theme.colors.textSecondary },
    link: { color: theme.colors.accent, fontSize: 14, fontWeight: '600', lineHeight: 21 },
    toggle: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    detail: { marginTop: 8, gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, flexShrink: 0 },
    recovery: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  });
