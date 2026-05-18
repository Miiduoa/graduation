/**
 * 共用底層:LMS v2 Course Screen 殼層元件
 * ──────────────────────────────────────────────
 * 提供 13 個 Course*V2Screen 共用的 header / loading / empty / error state,
 * 以及 useCourseRouteParams() 抓 courseId,讓每個 V2 Screen 只專注 fetch + render。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';

export type CourseV2RouteParams = {
  courseId: string;
  courseName?: string;
  // 其他 detail screen 用的
  assignmentId?: string;
  quizId?: string;
  attemptId?: string;
  topicId?: string;
  sessionId?: string;
};

export function useCourseV2Params(): CourseV2RouteParams {
  const route = useRoute<RouteProp<Record<string, CourseV2RouteParams>, string>>();
  return route.params ?? ({ courseId: '' } as CourseV2RouteParams);
}

export function useCourseV2Nav() {
  return useNavigation<any>();
}

export function CourseV2Header({
  title,
  subtitle,
  rightAction,
}: {
  title: string;
  subtitle?: string;
  rightAction?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {rightAction ? (
        <Pressable style={styles.headerBtn} onPress={rightAction.onPress}>
          <Text style={styles.headerBtnLabel}>{rightAction.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CourseV2Loading({ label = '載入中…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function CourseV2Empty({ label = '目前沒有資料' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function CourseV2Error({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.error}>{error}</Text>
      {onRetry ? (
        <Pressable style={styles.btn} onPress={onRetry}>
          <Text style={styles.btnLabel}>重試</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export type Loadable<T> = {
  loading: boolean;
  error: string | null;
  data: T | null;
  refresh: () => Promise<void>;
};

export function useLoadable<T>(fn: () => Promise<T>): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fn();
      setData(r);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { data, loading, error, refresh };
}

export function CourseV2List<T>({
  loadable,
  renderItem,
  emptyLabel,
}: {
  loadable: Loadable<T[]>;
  renderItem: (item: T, idx: number) => React.ReactNode;
  emptyLabel?: string;
}) {
  if (loadable.loading && !loadable.data) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const items = loadable.data ?? [];
  if (items.length === 0) return <CourseV2Empty label={emptyLabel} />;
  return (
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={<RefreshControl refreshing={loadable.loading} onRefresh={loadable.refresh} />}
    >
      {items.map((it, i) => (
        <View key={i}>{renderItem(it, i)}</View>
      ))}
      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

export function CourseV2Card({
  title,
  subtitle,
  badge,
  onPress,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  headerSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  headerBtnLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  muted: { color: '#8E8E93', fontSize: 14 },
  error: { color: '#D70015', fontSize: 14, textAlign: 'center' },
  btn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  btnLabel: { color: '#FFFFFF', fontWeight: '600' },
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
  },
  badgeLabel: { fontSize: 11, color: '#92400E', fontWeight: '600' },
});
