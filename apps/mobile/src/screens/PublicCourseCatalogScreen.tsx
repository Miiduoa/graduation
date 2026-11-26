import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { exceedsPublicCourseResponseByteLimit, isPublicCourseResponseUrl } from '@campus/shared/src/publicCourseAssistantClient';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuCourseMeetings, nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import { formatPublicCatalogFetchedAt, isPublicCourseCatalog, type PublicCatalogCourse, type PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { hasPublicCourseFilters, parsePublicCourseFilterParams, parsePublicCourseFilters, publicCourseFilterLabel, type PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { isPublicCourseOperationQuery } from '@campus/shared/src/publicCourseOperations';
import { Button, Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { TextAction } from '../ui/interactive/TextAction';
import { safeNavigate } from '../utils/safeNavigate';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { usePersonalImportScope } from '../state/personalImportScope';
import { personalImportStorageKey } from '../services/personalImports';
import { hasImportReviewDraft, readImportReviewDraft, writeImportReviewDraft } from '../services/personalImportDrafts';
import { hasPersonalImportDraft } from '../services/imports/personalImportDraft';

import { PublicCourseImportAction } from '../components/PublicCourseImportAction';
import { queuePublicCourseClipboardCopy } from '../services/publicCourseClipboardQueue';
import { publicCourseImportSource, type PublicCourseSourceEvidence } from '../services/publicCourseTimetableImport';

type Result = { filters: PublicCourseFilters } & (
  | { status: 'loading' | 'error'; query: string }
  | { status: 'ready'; query: string; data: PublicCourseCatalogResponse }
);

const maxBytes = 512 * 1024;
const publicCatalogEndpoint = 'https://nuni.tw/api/public-course-catalog';
const filterErrorMessage = '請選擇星期一到星期日；學分請輸入 0–40 的數字，最多 2 位小數，留白表示不限。';

// A cross-listed course can share semester, code and section across departments;
// identical official rows can also repeat. Use the complete visible row and
// position to keep FlatList card state/clipboard feedback on the tapped row.
// Including the position is intentional: genuinely identical rows must not
// reuse the same React key, and reordering safely resets per-card feedback.
function publicCourseCardKey(course: PublicCatalogCourse, index: number): string {
  return JSON.stringify([
    course.semester, course.code, course.section, course.department,
    course.title, course.teacher, course.credits, course.time, course.room,
    course.meetings, index,
  ]);
}

type ClipboardFeedback = { csv: string; cardId: string; status: 'copied' | 'manual' };

// Draft read/check/write spans multiple awaits. A per-card busy ref does not
// protect another row (or a remounted list) from observing the same empty draft
// and overwriting it. Lock the exact owner/school draft until the write settles.
const activeCatalogDraftReviews = new Set<string>();

type Props = {
  schoolId: PublicCourseCatalogResponse['schoolId'];
  initialQuery?: string;
  initialFilters?: PublicCourseFilters;
  requestedSemester?: string;
  autoSearch?: boolean;
  currentSchoolName?: string;
  navigation?: Parameters<typeof safeNavigate>[0];
};

// Flat catalog styling: hairline-divided rows, graphite titles, subordinate metadata,
// and forest only for the primary action and selected filters.
const hairline = StyleSheet.hairlineWidth;
const ui = {
  get meta() { return { color: theme.colors.muted, fontSize: 14, lineHeight: 21 }; },
  get detail() { return { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 }; },
  get fieldLabel() { return { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.3 }; },
  get input() {
    return {
      minHeight: 48, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface, color: theme.colors.text, paddingHorizontal: 12,
    };
  },
  get divider() { return { borderTopWidth: hairline, borderTopColor: theme.colors.separator }; },
};


function CourseCard({ course, schoolId, navigation, cardId, rowNumber, copyFeedback, onCopy, sourceEvidence }: Props & {
  course: PublicCatalogCourse;
  cardId: string;
  rowNumber: number;
  copyFeedback: ClipboardFeedback | null;
  onCopy: (csv: string, cardId: string) => void;
  sourceEvidence?: PublicCourseSourceEvidence;
}) {
  const scope = usePersonalImportScope();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  const busy = useRef(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function review(course: PublicCatalogCourse) {
    if (busy.current) return;
    if (!scope || scope.schoolId !== schoolId) {
      setNotice('請先確認目前帳號與所選校園，再帶入課表核對。');
      return;
    }
    const key = `${personalImportStorageKey(scope)}:grid-draft:v1`;
    if (activeCatalogDraftReviews.has(key)) {
      setNotice('另一門課正在建立匯入草稿，請稍後再試。');
      return;
    }
    const current = () => mounted.current && scopeRef.current?.owner === scope.owner && scopeRef.current?.schoolId === scope.schoolId;
    busy.current = true;
    activeCatalogDraftReviews.add(key);
    try {
      const existing = await readImportReviewDraft(key);
      const aiDraft = await hasPersonalImportDraft(scope);
      if (!current()) return;
      if (hasImportReviewDraft(existing) || aiDraft) {
        setNotice('匯入頁已有待核對的草稿，請先前往「匯入我的資料」處理。');
        return;
      }
      const text = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);
      if (!text) return;
      const academicYear = course.semester.slice(0, -1);
      const semester = course.semester.slice(-1);
      const source = publicCourseImportSource(schoolId, course.semester, sourceEvidence);
      const { rows, issues } = parsePersonalImport(text, { kind: 'timetable', schoolId, academicYear, semester, source });
      if (!rows.length || issues.some(issue => issue.severity === 'error')) {
        setNotice('課表資料需要手動核對，請前往匯入我的資料。');
        return;
      }
      await writeImportReviewDraft(key, JSON.stringify({
        version: 1, kind: 'timetable', academicYear, semester, text, source,
        rows, issues, selected: rows.map(row => row.id), editedIds: [], backupPreview: null,
      }));
      if (current()) safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' });
    } catch {
      if (current()) setNotice('無法安全讀寫匯入草稿，請稍後重試。');
    } finally {
      activeCatalogDraftReviews.delete(key);
      busy.current = false;
    }
  }

  const meetings = schoolId === 'nthu'
    ? nthuCourseMeetings(course.meetings ?? [], course.semester)
    : ncnuCourseMeetings(course.time, course.semester)?.map(meeting => ({ ...meeting, room: course.room }));
  const rawMeetings = course.meetings ?? [{ time: course.time, room: course.room }];
  const csv = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);
  // Course codes and titles can repeat across departments and even in the
  // official feed. Include the visible row position so VoiceOver/TalkBack users
  // know which course will be copied or added to their import review.
  const spokenCourse = `第${rowNumber}筆，${course.title}，課號${course.code}，班別${course.section || '未提供'}，${course.department || '未提供系所'}`;
  const body = ui.detail;
  // Show copy feedback only on the last tapped row, even when two cross-listed
  // cards produce identical CSV. Keeping this in the list parent also clears
  // an earlier success as soon as another card starts a copy.
  const copied = copyFeedback?.cardId === cardId && copyFeedback.csv === csv && copyFeedback.status === 'copied';
  const manualCopy = copyFeedback?.cardId === cardId && copyFeedback.csv === csv && copyFeedback.status === 'manual';
  // Keep the title separate: grouping the whole Card as an accessible header
  // prevents VoiceOver from reaching its nested review and copy controls.
  return <View style={{ ...ui.divider, paddingVertical: 16, gap: 4 }}>
    <Text accessibilityRole="header" style={{ ...theme.typography.h3, color: theme.colors.text }}>{course.title}</Text>
    <Text style={ui.meta}>{`課號 ${course.code} · 班別 ${course.section || '未提供'}`}</Text>
    <Text style={body}>{[course.department, course.teacher, course.credits && course.credits + ' 學分'].filter(Boolean).join(' · ')}</Text>
    {meetings ? meetings.map((meeting, index) => <Text key={index} style={body}>
      {meeting.label}{meeting.room ? ' · ' + meeting.room : ''}
    </Text>) : rawMeetings.map((meeting, index) => <Text key={index} style={body}>
      {meeting.time ? '校方節次 ' + meeting.time : '上課時間未提供'}{meeting.room ? ' · ' + meeting.room : ''}
    </Text>)}
    {!meetings && rawMeetings.length === 0 && <Text style={body}>上課時間未提供</Text>}
    <Text style={ui.meta}>{course.semester.replace(/^(\d{3})([12])$/, '$1 學年度第 $2 學期').replace(/^(\d{3})3$/, '$1 學年度暑期')}</Text>
    {!csv && <Text style={ui.meta}>校方課號或上課節次尚無法安全匯入（可能缺漏或重複），請先開啟官方課程目錄核對。</Text>}
    {csv && <View style={{ gap: 4, marginTop: 10 }}>
      <Button text="帶入課表核對" accessibilityLabel={`帶入課表核對：${spokenCourse}`} kind="primary" onPress={() => { void review(course); }} />
      {notice ? <Text accessibilityRole="alert" style={ui.meta}>{notice}</Text> : null}
      <PublicCourseImportAction course={course} schoolId={schoolId} navigation={navigation} evidence={sourceEvidence} />
      <TextAction label="複製課表匯入資料" accessibilityLabel={`複製課表匯入資料：${spokenCourse}`} onPress={() => onCopy(csv, cardId)} />
      {copied && <Text accessibilityLiveRegion="polite" style={ui.meta}>已複製，請到匯入頁貼上並核對上課時間。</Text>}
      {manualCopy && <>
        <Text style={ui.meta}>請選取下方資料複製，再到匯入頁貼上。</Text>
        <Text accessibilityLabel="可複製的課表資料" selectable style={body}>{csv}</Text>
      </>}
      {(copied || manualCopy) && <TextAction label="前往課表匯入" accessibilityLabel={`前往課表匯入：${spokenCourse}`} onPress={() => { safeNavigate(navigation, 'PersonalImport'); }} />}
    </View>}
  </View>;
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
  const [copyFeedback, setCopyFeedback] = useState<ClipboardFeedback | null>(null);
  const copyAttempt = useRef(0);
  useEffect(() => () => { copyAttempt.current += 1; }, []);
  const copyCourse = useCallback(async (csv: string, cardId: string) => {
    const attempt = ++copyAttempt.current;
    setCopyFeedback(null);
    // An OS write cannot be cancelled. The shared queue waits for an older
    // write and suppresses its stale feedback before accepting the latest tap.
    const status = await queuePublicCourseClipboardCopy(
      () => Clipboard.setStringAsync(csv),
      () => attempt === copyAttempt.current,
    );
    if (status !== 'superseded' && attempt === copyAttempt.current) {
      setCopyFeedback({ csv, cardId, status });
    }
  }, []);
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
    copyAttempt.current += 1;
    setCopyFeedback(null);
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
      const lengthHeader = response.headers.get('content-length');
      const declaredBytes = lengthHeader === null ? 0 : Number(lengthHeader);
      const contentType = response.headers.get('content-type');
      if (!response.ok ||
          (response.url && !isPublicCourseResponseUrl(response.url, { schoolId, query: term, filters })) ||
          // A malformed/negative length is not evidence that the body is small.
          (lengthHeader !== null && (!/^\d+$/.test(lengthHeader.trim()) ||
            !Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes)) ||
          // Native fetch may omit this header, but an explicitly non-JSON response
          // must never be passed to the course catalog importer.
          (contentType !== null && !/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim()))) throw new Error();
      const text = await response.text();
      if (!current()) return;
      if (exceedsPublicCourseResponseByteLimit(text)) throw new Error();
      const data: unknown = JSON.parse(text);
      if (!isPublicCourseCatalog(data, schoolId, filters)) throw new Error();
      if (current()) setResult({ status: 'ready', query: term, filters, data });
    } catch {
      if (current()) {
        // Fetch can resolve headers while the response body is still downloading.
        // Stop rejected/oversized/invalid responses instead of leaving that body open.
        controller.abort();
        setResult({ status: 'error', query: term, filters });
      }
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
    copyAttempt.current += 1;
    setCopyFeedback(null);
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
  const fetchedAt = result?.status === 'ready' ? result.data.fetchedAt : undefined;
  // A server fetch timestamp is not a publication or semester verification time.
  // When it is missing or old, students need to confirm current offerings at the school.
  const fetchAgeMs = fetchedAt ? Date.now() - Date.parse(fetchedAt) : null;
  const fetchIsOld = fetchAgeMs !== null && fetchAgeMs > 24 * 60 * 60 * 1000;
  // An impossible future server timestamp cannot establish freshness. Allow a
  // small device clock skew, but direct students to the authoritative catalog.
  const fetchIsFuture = fetchAgeMs !== null && fetchAgeMs < -5 * 60 * 1000;
  const body = ui.meta;
  const weekdays = [undefined, 1, 2, 3, 4, 5, 6, 7];
  return (
    <Screen title={schoolName + '開課查詢'} subtitle={fullSchoolName + ' · 本學期公開課程'}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={result?.status === 'ready' ? result.data.courses : []}
        keyExtractor={publicCourseCardKey}
        extraData={copyFeedback}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={<View style={{ gap: 12, paddingBottom: 16 }}>
          {currentSchoolName && <Text style={body}>正在瀏覽{fullSchoolName}的公開課程；目前選校仍為{currentSchoolName}。</Text>}
          {requestedSemester && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.textSecondary }}>
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
            style={ui.input}
          />
          <Text accessibilityRole="header" style={ui.fieldLabel}>星期</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {weekdays.map(day => {
              const selected = weekday === day;
              return <Pressable
                key={day ?? 'all'} accessibilityRole="button"
                accessibilityLabel={day === undefined ? '星期不限' : '星期' + '一二三四五六日'[day - 1]}
                accessibilityState={{ selected }}
                onPress={() => {
                  if (weekday === day) return;
                  invalidateSearch();
                  setWeekday(day);
                }}
                style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12,
                  borderWidth: 1, borderRadius: theme.radius.sm, borderColor: selected ? theme.colors.accent : theme.colors.border,
                  backgroundColor: selected ? theme.colors.accent : 'transparent' }}>
                <Text style={{ color: selected ? theme.colors.onAccent : theme.colors.text, fontWeight: selected ? '700' : '400' }}>{day === undefined ? '不限' : '週' + '一二三四五六日'[day - 1]}</Text>
              </Pressable>;
            })}
          </View>
          <Text style={body}>星期條件表示當天有課，同一門課也可能在其他天上課。</Text>
          <Text accessibilityRole="header" style={ui.fieldLabel}>學分（完全符合）</Text>
          <TextInput accessibilityLabel="課程學分" value={credits}
            onChangeText={value => { invalidateSearch(); setCredits(value); }}
            keyboardType="decimal-pad" placeholder="不限（0–40，最多 2 位小數）"
            placeholderTextColor={theme.colors.muted} onSubmitEditing={requestedSemester ? undefined : submit}
            style={ui.input} />
          <TextAction label="清除星期與學分" tone="neutral" onPress={() => {
            invalidateSearch();
            setWeekday(undefined);
            setCredits('');
          }} />
          {inputError && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.danger }}>{inputError}</Text>}
          <Button text={requestedSemester ? '查詢最新公開課程' : result?.status === 'error' ? '重新查詢' : '查詢課程'} kind="primary"
            disabled={result?.status === 'loading'} onPress={submit} />
          <View style={{ ...ui.divider, flexDirection: 'row', flexWrap: 'wrap', columnGap: 20 }}>
            <TextAction label={'開啟' + schoolName + '官方課程目錄'} onPress={() => {
              setLinkError(false);
              void Linking.openURL(catalogUrl).catch(() => setLinkError(true));
            }} />
            <TextAction label="查看我的課表" onPress={() => { safeNavigate(navigation, 'PersonalTimetable'); }} />
            <TextAction label="匯入我的資料" onPress={() => { safeNavigate(navigation, 'PersonalImport'); }} />
          </View>
          {linkError && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.danger }}>無法開啟校方網站，請稍後再試。</Text>}
          {filterLabel && <Text style={body}>本次查詢條件：{filterLabel}</Text>}
          {result?.status === 'loading' && <Text accessibilityLiveRegion="polite" style={body}>正在查詢{label}…</Text>}
          {result?.status === 'error' && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.danger }}>暫時無法讀取{schoolName}課程，請重試或查看官方課程目錄。</Text>}
          {result?.status === 'ready' && <Text accessibilityLiveRegion="polite" style={{ ...ui.detail, color: theme.colors.text, fontWeight: '600' }}>
            {result.data.courses.length === 0 ? '找不到' + label + '的開課資料。' :
              result.data.truncated ? '顯示前 50 筆，輸入更明確的關鍵字可縮小範圍。' : '找到 ' + result.data.courses.length + ' 筆' + label + '開課資料。'}
          </Text>}
          {result?.status === 'ready' && fetchedAt && <Text style={body}>
            校方資料擷取：{formatPublicCatalogFetchedAt(fetchedAt)}（台灣時間；非校方更新時間）
          </Text>}
          {result?.status === 'ready' && !fetchedAt && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.warning }}>
            目前沒有校方資料的擷取時間。加入個人課表前，請先至官方課程目錄核對。
          </Text>}
          {result?.status === 'ready' && fetchIsOld && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.warning }}>
            距離伺服器上次取得校方資料已超過 24 小時，課程與教室可能變動。加入前請先查看官方課程目錄。
          </Text>}
          {result?.status === 'ready' && fetchIsFuture && <Text accessibilityRole="alert" style={{ ...body, color: theme.colors.warning }}>
            伺服器提供的擷取時間比此裝置時間晚超過 5 分鐘，無法確認課程資料時效。加入前請先查看官方課程目錄。
          </Text>}
          {result?.status === 'ready' && (result.data.unresolvedCount ?? 0) > 0 && <Text style={body}>
            另有 {result.data.unresolvedCount} 筆課程的篩選資料不足，未列入符合結果。
          </Text>}
        </View>}
        renderItem={({ item, index }) => <CourseCard course={item} schoolId={schoolId} navigation={navigation}
          sourceEvidence={result?.status === 'ready' ? result.data : undefined}
          cardId={publicCourseCardKey(item, index)} rowNumber={index + 1}
          copyFeedback={copyFeedback} onCopy={copyCourse} />}
      />
    </Screen>
  );
}
