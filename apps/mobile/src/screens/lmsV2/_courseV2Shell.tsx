/**
 * 共用底層:LMS v2 Course Screen 殼層元件
 * ──────────────────────────────────────────────
 * 提供 13 個 Course*V2Screen 共用的 header / loading / empty / error state,
 * 以及 useCourseRouteParams() 抓 courseId,讓每個 V2 Screen 只專注 fetch + render。
 */
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
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
  const styles = useThemeStyleSheet(createStyles);
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {rightAction ? (
        <Pressable accessibilityRole="button" style={styles.headerBtn} onPress={rightAction.onPress}>
          <Text style={styles.headerBtnLabel}>{rightAction.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CourseV2Loading({ label = '載入中…' }: { label?: string }) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <View style={styles.center}>
      <ActivityIndicator />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function CourseV2Empty({ label = '目前沒有資料' }: { label?: string }) {
  const styles = useThemeStyleSheet(createStyles);
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
  const styles = useThemeStyleSheet(createStyles);
  return (
    <View style={styles.center}>
      <Text style={styles.error}>{error}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" style={styles.btn} onPress={onRetry}>
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

function useResolvedLoadableScope(extraScope?: string): string {
  const params = useCourseV2Params();
  return JSON.stringify([
    params.courseId ?? '',
    params.assignmentId ?? '',
    params.quizId ?? '',
    params.attemptId ?? '',
    params.topicId ?? '',
    params.sessionId ?? '',
    extraScope ?? '',
  ]);
}

/** extraScope must include every non-route value that changes which records the query can read. */
export function useLoadable<T>(fn: () => Promise<T>, extraScope?: string): Loadable<T> {
  const scopeKey = useResolvedLoadableScope(extraScope);
  const [state, setState] = useState<{
    scopeKey: string;
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({ scopeKey, data: null, loading: true, error: null });
  const latest = useRef({ fn, scopeKey });
  const mounted = useRef(false);
  const sequence = useRef(0);

  // Publish only committed queries; refresh also works when its caller kept an older reference.
  useLayoutEffect(() => {
    latest.current = { fn, scopeKey };
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, [scopeKey]);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const query = latest.current;
    const request = ++sequence.current;
    const isCurrent = () => mounted.current && sequence.current === request;
    setState(previous => ({
      scopeKey: query.scopeKey,
      data: previous.scopeKey === query.scopeKey ? previous.data : null,
      loading: true,
      error: null,
    }));
    try {
      const data = await query.fn();
      if (isCurrent()) setState({ scopeKey: query.scopeKey, data, loading: false, error: null });
    } catch (e: any) {
      if (isCurrent()) {
        setState(previous => ({ ...previous, loading: false, error: e?.message ?? String(e) }));
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, scopeKey]);

  // Mask the previous scope during render, before effects start the next request.
  if (state.scopeKey !== scopeKey) return { data: null, loading: true, error: null, refresh };
  return { data: state.data, loading: state.loading, error: state.error, refresh };
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
  const styles = useThemeStyleSheet(createStyles);
  if (loadable.loading && !loadable.data) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const items = loadable.data ?? [];
  if (items.length === 0) return <CourseV2Empty label={emptyLabel} />;
  return (
    <ScrollView
      style={styles.list}
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
  const styles = useThemeStyleSheet(createStyles);
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} style={styles.card} onPress={onPress} disabled={!onPress}>
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

const createStyles = () => StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  headerSubtitle: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  headerBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.colors.accent,
  },
  headerBtnLabel: { color: theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
  center: {
    backgroundColor: theme.colors.bg,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  muted: { color: theme.colors.muted, fontSize: 14 },
  error: { color: theme.colors.danger, fontSize: 14, textAlign: 'center' },
  btn: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
  },
  btnLabel: { color: theme.colors.onAccent, fontWeight: '600' },
  card: {
    marginHorizontal: theme.layout.screenPadding,
    marginVertical: 6,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  cardSubtitle: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 6,
  },
  badgeLabel: { fontSize: 11, color: theme.colors.accent, fontWeight: '600' },
});
