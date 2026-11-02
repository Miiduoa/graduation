import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { createNuniClasses, type NuniWorkspace } from '@campus/shared/src/nuni';
import { Button, Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { useNuniSession } from '../state/nuniSession';
import { safeNavigate } from '../utils/safeNavigate';
import {
  classroomQueryMatchKind,
  courseSearchKey,
  filterCoursesByClassroomQuery,
} from '../hooks/timetableClassroomNav';

type Props = {
  query: string;
  navigation: { navigate?: (name: string, params?: unknown) => void };
};

/**
 * Timetable fallback when a course has no linkedCourseId:
 * land on Classroom with q and prefilter the nuni course list (no auto-link writes).
 */
export function ClassroomCourseSearch({ query, navigation }: Props) {
  const auth = useNuniSession();
  const [rows, setRows] = useState<NuniWorkspace[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeQuery, setActiveQuery] = useState(query.trim().slice(0, 120));
  const generation = useRef(0);

  const load = useCallback(async () => {
    const run = ++generation.current;
    if (!auth.session || auth.loading || auth.pendingLogout) {
      if (run === generation.current) {
        setRows(null);
        setLoading(false);
        setError(auth.loading ? '正在確認登入…' : '請先登入平台帳號後再尋找課程。');
      }
      return;
    }
    setLoading(true);
    setError('');
    try {
      const list = await createNuniClasses(
        (path, input) => auth.request(path, auth.session!.context, input),
        auth.session.platformAccountId,
      ).list();
      if (run !== generation.current) return;
      setRows(list.filter((item) => item.state === 'active'));
    } catch {
      if (run === generation.current) {
        setRows(null);
        setError('課程暫時讀不到，請稍後重試。');
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const matched = useMemo(
    () => filterCoursesByClassroomQuery(rows ?? [], activeQuery),
    [rows, activeQuery],
  );
  const matchKind = classroomQueryMatchKind(matched.length, Boolean(courseSearchKey(activeQuery)));

  const openCourse = (courseId: string) => {
    void safeNavigate(navigation, 'CourseHub', { courseId });
  };
  const clearQuery = () => setActiveQuery('');

  return (
    <Screen title="課程空間" subtitle="依課表條件尋找作業與教材">
      <View style={{ padding: 16, gap: 12 }} testID="classroom-course-search">
        {activeQuery ? (
          <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
            課表搜尋：{activeQuery}
          </Text>
        ) : (
          <Text style={{ color: theme.colors.muted }}>顯示全部進行中課程</Text>
        )}
        {loading ? <Text style={{ color: theme.colors.muted }}>正在讀取課程…</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {error}
          </Text>
        ) : null}
        {!loading && rows ? (
          matchKind === 'none' ? (
            <View style={{ gap: 10 }} testID="classroom-query-none">
              <Text style={{ color: theme.colors.text }}>
                找不到「{activeQuery}」。課表上的這門課尚未對應到課程空間。
              </Text>
              <Button text="全部課程" onPress={clearQuery} />
              <Button
                text="加入課程"
                kind="primary"
                onPress={() => {
                  void safeNavigate(navigation, 'NuniWorkspace', { tab: 'courses' });
                }}
              />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text
                style={{ color: theme.colors.muted }}
                testID={`classroom-query-status-${matchKind}`}
              >
                {matchKind === 'unique'
                  ? `剛好找到「${activeQuery}」這門課`
                  : activeQuery
                    ? `「${activeQuery}」找到 ${matched.length} 門課程`
                    : `全部課程 · ${matched.length} 門`}
              </Text>
              {activeQuery ? <Button text="全部課程" onPress={clearQuery} /> : null}
              {matched.map((course) => (
                <Pressable
                  key={course.id}
                  accessibilityRole="button"
                  accessibilityLabel={course.title}
                  testID={matchKind === 'unique' ? 'classroom-query-unique' : undefined}
                  onPress={() => openCourse(course.id)}
                  style={({ pressed }) => ({
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor:
                      matchKind === 'unique' ? theme.colors.accent : theme.colors.border,
                    borderRadius: 10,
                    backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                    gap: 4,
                  })}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    {course.title}
                    {matchKind === 'unique' ? ' · 課表對應' : ''}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                    開啟作業與教材
                  </Text>
                </Pressable>
              ))}
            </View>
          )
        ) : null}
        {!loading && !error && !auth.session ? (
          <Button
            text="前往登入與加入課程"
            kind="primary"
            onPress={() => {
              void safeNavigate(navigation, 'NuniWorkspace');
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}
