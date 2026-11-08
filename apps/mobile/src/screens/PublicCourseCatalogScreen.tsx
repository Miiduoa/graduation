import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Linking, Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { exceedsPublicCourseResponseByteLimit, isPublicCourseResponseUrl } from '@campus/shared/src/publicCourseAssistantClient';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuCourseMeetings, nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import { formatPublicCatalogFetchedAt, isPublicCourseCatalog, type PublicCatalogCourse, type PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { hasPublicCourseFilters, parsePublicCourseFilterParams, parsePublicCourseFilters, publicCourseFilterLabel, type PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { isPublicCourseOperationQuery } from '@campus/shared/src/publicCourseOperations';
import { Button, Card, Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';
import { PublicCourseImportAction } from '../components/PublicCourseImportAction';

type Result = { filters: PublicCourseFilters } & (
  | { status: 'loading' | 'error'; query: string }
  | { status: 'ready'; query: string; data: PublicCourseCatalogResponse }
);

const maxBytes = 512 * 1024;
const publicCatalogEndpoint = 'https://nuni.tw/api/public-course-catalog';
const filterErrorMessage = '請選擇星期一到星期日；學分請輸入 0–40 的數字，最多 2 位小數，留白表示不限。';

type Props = {
  schoolId: PublicCourseCatalogResponse['schoolId'];
  initialQuery?: string;
  initialFilters?: PublicCourseFilters;
  requestedSemester?: string;
  autoSearch?: boolean;
  currentSchoolName?: string;
  navigation?: Parameters<typeof safeNavigate>[0];
};

function CourseCard({ course, schoolId, navigation }: Props & { course: PublicCatalogCourse }) {
  const [copyState, setCopyState] = useState<{ csv: string; status: 'copied' | 'manual' } | null>(null);
  const copyAttempt = useRef(0);
  const meetings = schoolId === 'nthu'
    ? nthuCourseMeetings(course.meetings ?? [], course.semester)
    : ncnuCourseMeetings(course.time, course.semester)?.map(meeting => ({ ...meeting, room: course.room }));
  const rawMeetings = course.meetings ?? [{ time: course.time, room: course.room }];
  const csv = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);
  const body = { color: theme.colors.textSecondary, lineHeight: 22 };
  // A second tap or a new course invalidates a pending clipboard result.
  // The displayed feedback must describe the exact CSV currently on screen.
  const copied = copyState?.csv === csv && copyState.status === 'copied';
  const manualCopy = copyState?.csv === csv && copyState.status === 'manual';
  useEffect(() => () => { copyAttempt.current += 1; }, []);
  async function copy() {
    if (!csv) return;
    const attempt = ++copyAttempt.current;
    setCopyState(null);
    try {
      const success = await Clipboard.setStringAsync(csv);
      if (attempt !== copyAttempt.current) return;
      setCopyState({ csv, status: success ? 'copied' : 'manual' });
    } catch {
      if (attempt !== copyAttempt.current) return;
      setCopyState({ csv, status: 'manual' });
    }
  }
  // Keep the title separate: grouping the whole Card as an accessible header
  // prevents VoiceOver from reaching its nested review and copy controls.
  return <Card>
    <Text accessibilityRole="header" style={{ ...theme.typography.h3, color: theme.colors.text }}>{course.title}</Text>
    <Text style={body}>{`課號 ${course.code} · 班別 ${course.section || '未提供'}`}</Text>
    <Text style={body}>{[course.department, course.teacher, course.credits && course.credits + ' 學分'].filter(Boolean).join(' · ')}</Text>
    {meetings ? meetings.map((meeting, index) => <Text key={index} style={body}>
      {meeting.label}{meeting.room ? ' · ' + meeting.room : ''}
    </Text>) : rawMeetings.map((meeting, index) => <Text key={index} style={body}>
      {meeting.time ? '校方節次 ' + meeting.time : '上課時間未提供'}{meeting.room ? ' · ' + meeting.room : ''}
    </Text>)}
    {!meetings && rawMeetings.length === 0 && <Text style={body}>上課時間未提供</Text>}
    <Text style={body}>{course.semester.replace(/^(\d{3})([12])$/, '$1 學年度第 $2 學期').replace(/^(\d{3})3$/, '$1 學年度暑期')}</Text>
    {csv && <View style={{ gap: 8, marginTop: 8 }}>
      <PublicCourseImportAction course={course} schoolId={schoolId} navigation={navigation} />
      <Button text="複製課表匯入資料" kind="ghost" onPress={() => void copy()} />
      {copied && <Text accessibilityLiveRegion="polite" style={body}>已複製，請到匯入頁貼上並核對上課時間。</Text>}
      {manualCopy && <>
        <Text style={body}>請選取下方資料複製，再到匯入頁貼上。</Text>
        <Text accessibilityLabel="可複製的課表資料" selectable style={body}>{csv}</Text>
      </>}
      {(copied || manualCopy) && <Button text="前往課表匯入" kind="primary" onPress={() => { safeNavigate(navigation, 'PersonalImport'); }} />}
    </View>}
  </Card>;
}

export function PublicCourseCatalogScreen(props: Props) {
  return <PublicCourseCatalogForm key={JSON.stringify([
    props.schoolId, props.initialQuery ?? '', props.initialFilters ?? {}, props.requestedSemester ?? null, props.autoSearch ?? false,
  ])} {...props} />;
}

function PublicCourseCatalogForm({ schoolId, initialQuery = '', initialFilters, requestedSemester, autoSearch = false, currentSchoolName, navigation }: Props) {
  const [entryFilters] = useState(() => parsePublicCourseFilters(initialFilters ?? {}));
  const [query, setQuery] = useState(initialQuery);
  const [weekday, setWeekday] = useState(entryFilters?.weekday);
  const [credits, setCredits] = useState(entryFilters?.credits === undefined ? '' : String(entryFilters.credits));
  const [inputError, setInputError] = useState(entryFilters ? '' : filterErrorMessage);
  const [result, setResult] = useState<Result | null>(null);
  const [linkError, setLinkError] = useState(false);
  const pending = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const schoolName = schoolId === 'nthu' ? '清大' : '暨大';
  const fullSchoolName = schoolId === 'nthu' ? '國立清華大學' : '國立暨南國際大學';
  const catalogUrl = resolveOfficialCourseQueryLink(schoolId)!.url;

  const cancelSearch = useCallback(() => {
    if (!pending.current) return;
    pending.current.controller.abort();
    clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);

  const search = useCallback(async (keyword: string, requestedFilters: PublicCourseFilters) => {
    cancelSearch();
    const filters = parsePublicCourseFilters(requestedFilters);
    if (!filters || !isPublicCourseOperationQuery(keyword)) {
      setResult(null);
      setInputError(filters ? '搜尋文字最多 80 個字，請縮短後再查詢。' : filterErrorMessage);
      return;
    }
    setInputError('');
    const controller = new AbortController();
    const term = keyword.trim();
    setResult({ status: 'loading', query: term, filters });
    const timer = setTimeout(() => {
      if (pending.current?.controller !== controller) return;
      pending.current = null;
      controller.abort();
      setResult({ status: 'error', query: term, filters });
    }, 25_000);
    pending.current = { controller, timer };
    const current = () => pending.current?.controller === controller && !controller.signal.aborted;
    try {
      const params = new URLSearchParams({ schoolId, q: term });
      if (filters.weekday !== undefined) params.set('weekday', String(filters.weekday));
      if (filters.credits !== undefined) params.set('credits', String(filters.credits));
      const response = await fetch(publicCatalogEndpoint + '?' + params, {
        // The server sends Cache-Control: no-store. Native whatwg-fetch adds an
        // unsupported `_` query parameter if request.cache is set to no-store.
        credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      // Native fetch may already have followed a redirect. Validate the reported
      // final resource before accepting its body; this is not a transport guard.
      if (!current()) return;
      if (!response.ok || (response.url && !isPublicCourseResponseUrl(response.url, { schoolId, query: term, filters })) ||
          Number(response.headers.get('content-length')) > maxBytes) throw new Error();
      const text = await response.text();
      if (!current()) return;
      if (exceedsPublicCourseResponseByteLimit(text)) throw new Error();
      const data: unknown = JSON.parse(text);
      if (!isPublicCourseCatalog(data, schoolId, filters)) throw new Error();
      if (current()) setResult({ status: 'ready', query: term, filters, data });
    } catch {
      if (current()) setResult({ status: 'error', query: term, filters });
    } finally {
      clearTimeout(timer);
      if (pending.current?.controller === controller) pending.current = null;
    }
  }, [schoolId, cancelSearch]);

  useEffect(() => {
    if (!requestedSemester && entryFilters && (autoSearch || initialQuery || hasPublicCourseFilters(entryFilters))) void search(initialQuery, entryFilters);
    return cancelSearch;
  }, [autoSearch, initialQuery, entryFilters, requestedSemester, search, cancelSearch]);

  function invalidateSearch() {
    cancelSearch();
    setResult(null);
    setInputError('');
  }
  function submit() {
    const params = new URLSearchParams();
    if (weekday !== undefined) params.set('weekday', String(weekday));
    if (credits.trim()) params.set('credits', credits.trim());
    const filters = parsePublicCourseFilterParams(params);
    if (!filters) {
      invalidateSearch();
      setInputError(filterErrorMessage);
      return;
    }
    Keyboard.dismiss();
    void search(query, filters);
  }

  const label = result?.query ? '「' + result.query + '」' : '';
  const filterLabel = publicCourseFilterLabel(result?.filters);
  const body = { color: theme.colors.textSecondary, lineHeight: 22 };
  return (
    <Screen title={schoolName + '開課查詢'} subtitle={fullSchoolName + ' · 本學期公開課程'}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={result?.status === 'ready' ? result.data.courses : []}
        keyExtractor={row => [row.semester, row.code, row.section].join('-')}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        ListHeaderComponent={<View style={{ gap: 10 }}>
          {currentSchoolName && <Text style={body}>正在瀏覽{fullSchoolName}的公開課程；目前選校仍為{currentSchoolName}。</Text>}
          {requestedSemester && <Text accessibilityRole="alert" style={body}>
            連結指定{requestedSemester.slice(0, 3)}學年度第{requestedSemester.slice(-1)}學期，目前僅能查校方最新公開開課，無法按指定學期篩選。
          </Text>}
          <Text style={body}>依課名、課號、系所或老師搜尋，也可加上星期與學分；關鍵字留白可依條件瀏覽。</Text>
          <TextInput
            accessibilityLabel={'搜尋' + schoolName + '課程'} value={query}
            onChangeText={value => {
              const next = Array.from(value).slice(0, 80).join('');
              if (next === query) return;
              invalidateSearch();
              setQuery(next);
            }} maxLength={160}
            placeholder="例如：資料庫" placeholderTextColor={theme.colors.muted} returnKeyType="search"
            onSubmitEditing={requestedSemester ? undefined : submit}
            style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 12 }}
          />
          <Text accessibilityRole="header" style={body}>星期</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[undefined, 1, 2, 3, 4, 5, 6, 7].map(day => <Pressable
              key={day ?? 'all'} accessibilityRole="button"
              accessibilityLabel={day === undefined ? '星期不限' : '星期' + '一二三四五六日'[day - 1]}
              accessibilityState={{ selected: weekday === day }}
              onPress={() => {
                if (weekday === day) return;
                invalidateSearch();
                setWeekday(day);
              }}
              style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12,
                borderWidth: 1, borderRadius: 12, borderColor: weekday === day ? theme.colors.accent : theme.colors.border,
                backgroundColor: weekday === day ? theme.colors.accentSoft : theme.colors.surface }}>
              <Text style={{ color: theme.colors.text }}>{day === undefined ? '不限' : '週' + '一二三四五六日'[day - 1]}</Text>
            </Pressable>)}
          </View>
          <Text style={body}>星期條件表示當天有課，同一門課也可能在其他天上課。</Text>
          <Text accessibilityRole="header" style={body}>學分（完全符合）</Text>
          <TextInput accessibilityLabel="課程學分" value={credits}
            onChangeText={value => { invalidateSearch(); setCredits(value); }}
            keyboardType="decimal-pad" placeholder="不限（0–40，最多 2 位小數）"
            placeholderTextColor={theme.colors.muted} onSubmitEditing={requestedSemester ? undefined : submit}
            style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 12 }} />
          <Button text="清除星期與學分" kind="ghost" onPress={() => {
            invalidateSearch();
            setWeekday(undefined);
            setCredits('');
          }} />
          {inputError && <Text accessibilityRole="alert" style={body}>{inputError}</Text>}
          <Button text={requestedSemester ? '查詢最新公開課程' : result?.status === 'error' ? '重新查詢' : '查詢課程'} kind="primary"
            disabled={result?.status === 'loading'} onPress={submit} />
          <Button text={'開啟' + schoolName + '官方課程目錄'} kind="ghost" onPress={() => {
            setLinkError(false);
            void Linking.openURL(catalogUrl).catch(() => setLinkError(true));
          }} />
          {linkError && <Text accessibilityRole="alert" style={body}>無法開啟校方網站，請稍後再試。</Text>}
          {filterLabel && <Text style={body}>本次查詢條件：{filterLabel}</Text>}
          {result?.status === 'loading' && <Text accessibilityLiveRegion="polite" style={body}>正在查詢{label}…</Text>}
          {result?.status === 'error' && <Text accessibilityRole="alert" style={body}>暫時無法讀取{schoolName}課程，請重試或查看官方課程目錄。</Text>}
          {result?.status === 'ready' && <Text accessibilityLiveRegion="polite" style={body}>
            {result.data.courses.length === 0 ? '找不到' + label + '的開課資料。' :
              result.data.truncated ? '顯示前 50 筆，輸入更明確的關鍵字可縮小範圍。' : '找到 ' + result.data.courses.length + ' 筆' + label + '開課資料。'}
          </Text>}
          {result?.status === 'ready' && result.data.fetchedAt && <Text style={body}>
            校方資料擷取：{formatPublicCatalogFetchedAt(result.data.fetchedAt)}（台灣時間；非校方更新時間）
          </Text>}
          {result?.status === 'ready' && (result.data.unresolvedCount ?? 0) > 0 && <Text style={body}>
            另有 {result.data.unresolvedCount} 筆課程的篩選資料不足，未列入符合結果。
          </Text>}
        </View>}
        renderItem={({ item }) => <CourseCard course={item} schoolId={schoolId} navigation={navigation} />}
      />
    </Screen>
  );
}
