import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { materialFailureMessage } from '@campus/shared/src/materialAccess';
import { useTheme } from '../../state/theme';
import { materialMatchesQuery } from './materialDiscovery';
import {
  crossCourseSearchCopy,
  readSearchRound,
  startMaterialSearch,
  type MaterialSearchClient,
  type SearchCourse,
} from './crossCourseMaterials';

export function useCourseSearchState() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [courses, setCourses] = useState<SearchCourse[] | null>(null);
  return { query, setQuery, submitted, setSubmitted, courses, setCourses };
}

export function CrossCourseMaterialSearch({
  classes,
  open,
  active = true,
  state,
  join,
}: {
  active?: boolean;
  state?: ReturnType<typeof useCourseSearchState>;
  join?(): void;
  classes: MaterialSearchClient;
  open(courseId: string, materialId: string): void;
}) {
  const theme = useTheme();
  const localState = useCourseSearchState();
  const { query, setQuery, submitted, setSubmitted, courses, setCourses } = state ?? localState;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const locked = useRef(false);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  const latest = useRef(courses);
  latest.current = courses;
  useEffect(() => {
    if (active && latest.current) void search(true, undefined, true);
    return () => {
      epoch.current += 1;
      locked.current = false;
      setBusy(false);
    };
    // 搜尋恢復時重新驗權，輸入與進度變動不重啟請求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  async function search(more = false, onlyCourseId?: string, validateOnly = false) {
    if (!active || locked.current || (!more && !query.trim())) return;
    locked.current = true;
    const run = ++epoch.current;
    const cancelled = () => run !== epoch.current;
    const publish = (next: SearchCourse[]) => {
      if (!cancelled()) setCourses(next);
    };
    setBusy(true);
    setError('');
    if (!more) {
      setSubmitted(query.trim());
      setCourses(null);
    }
    try {
      const result =
        more && courses
          ? await readSearchRound(classes, courses, cancelled, publish, onlyCourseId, validateOnly)
          : await startMaterialSearch(classes, cancelled, publish);
      if (!cancelled()) setCourses(result);
    } catch (failure) {
      if (!cancelled()) setError(materialFailureMessage(failure));
    } finally {
      if (!cancelled()) {
        setBusy(false);
        locked.current = false;
      }
    }
  }
  const hits = (courses ?? []).flatMap((course) =>
    course.items
      .filter((item) =>
        materialMatchesQuery({ ...item, body: `${course.title}\n${item.body}` }, submitted),
      )
      .map((item) => ({ course, item })),
  );
  const copy = { color: theme.colors.text, fontSize: 15, lineHeight: 24 };
  const button = (label: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={action}
      style={{ padding: 12, borderWidth: 1, borderRadius: 10, borderColor: theme.colors.border }}
    >
      <Text style={{ ...copy, color: theme.colors.accent }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ ...copy, fontSize: 20, fontWeight: '600' }}>
        跨課找教材
      </Text>
      <Text style={copy}>輸入教材、單元或課名，再按搜尋。只搜尋你已加入的未封存課程。</Text>
      <TextInput
        accessibilityLabel="跨課教材關鍵字"
        placeholder="例如：期中複習"
        placeholderTextColor={theme.colors.muted}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        onSubmitEditing={() => void search()}
        style={{
          ...copy,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          padding: 12,
        }}
      />
      {button('搜尋教材', () => void search())}
      {submitted ? <Text style={copy}>目前搜尋：{submitted}</Text> : null}
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={copy}>
          正在搜尋，結果還沒搜完…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={copy}>
          {error} 請再按搜尋試一次。
        </Text>
      ) : null}
      {courses ? (
        <>
          <Text accessibilityLiveRegion="polite" style={copy}>
            完成課數：{courses.filter((course) => course.complete).length}／{courses.length}
          </Text>
          <Text accessibilityLiveRegion="polite" style={copy}>
            {crossCourseSearchCopy(courses, hits.length)}
          </Text>
          {!courses.length && join ? button('加入課程', join) : null}
          {courses
            .filter((course) => course.error)
            .map((course) => (
              <View key={course.id}>
                <Text accessibilityRole="alert" style={copy}>
                  {course.title}：尚未搜完。{course.error}
                </Text>
                {button(`重試${course.title}`, () => void search(true, course.id))}
              </View>
            ))}
          {hits.map(({ course, item }) => (
            <Pressable
              key={`${course.id}:${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}，${course.title}，${item.unitTitle ?? '尚未分類'}`}
              onPress={() => open(course.id, item.id)}
              style={{
                padding: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 10,
              }}
            >
              <Text style={{ ...copy, fontWeight: '600' }}>{item.title}</Text>
              <Text style={copy}>
                {course.title} · {item.unitTitle ?? '尚未分類'}
              </Text>
            </Pressable>
          ))}
          {courses.some((course) => !course.complete)
            ? button('繼續搜尋／重試未完成課程', () => void search(true))
            : null}
        </>
      ) : null}
    </View>
  );
}
