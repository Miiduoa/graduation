import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Linking, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuCourseMeetings, nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import { isPublicCourseCatalog, type PublicCatalogCourse, type PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { Button, Card, Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';

type Result =
  | { status: 'loading' | 'error'; query: string }
  | { status: 'ready'; query: string; data: PublicCourseCatalogResponse };

const maxBytes = 512 * 1024;

type Props = {
  schoolId: PublicCourseCatalogResponse['schoolId'];
  initialQuery?: string;
  navigation?: Parameters<typeof safeNavigate>[0];
};

function CourseCard({ course, schoolId, navigation }: Props & { course: PublicCatalogCourse }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const meetings = schoolId === 'nthu'
    ? nthuCourseMeetings(course.meetings ?? [], course.semester)
    : ncnuCourseMeetings(course.time, course.semester)?.map(meeting => ({ ...meeting, room: course.room }));
  const rawMeetings = course.meetings ?? [{ time: course.time, room: course.room }];
  const csv = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);
  const body = { color: theme.colors.textSecondary, lineHeight: 22 };
  async function copy() {
    if (!csv) return;
    try {
      const success = await Clipboard.setStringAsync(csv);
      if (!success) throw new Error('Clipboard unavailable');
      setCopied(true);
      setManualCopy(false);
    } catch {
      setManualCopy(true);
    }
  }
  return <Card title={course.title} subtitle={`課號 ${course.code} · 班別 ${course.section || '未提供'}`}>
    <Text style={body}>{[course.department, course.teacher, course.credits && course.credits + ' 學分'].filter(Boolean).join(' · ')}</Text>
    {meetings ? meetings.map((meeting, index) => <Text key={index} style={body}>
      {meeting.label}{meeting.room ? ' · ' + meeting.room : ''}
    </Text>) : rawMeetings.map((meeting, index) => <Text key={index} style={body}>
      {meeting.time ? '校方節次 ' + meeting.time : '上課時間未提供'}{meeting.room ? ' · ' + meeting.room : ''}
    </Text>)}
    {!meetings && rawMeetings.length === 0 && <Text style={body}>上課時間未提供</Text>}
    <Text style={body}>{course.semester.replace(/^(\d{3})([12])$/, '$1 學年度第 $2 學期').replace(/^(\d{3})3$/, '$1 學年度暑期')}</Text>
    {csv && <View style={{ gap: 8, marginTop: 8 }}>
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

export function PublicCourseCatalogScreen({ schoolId, initialQuery = '', navigation }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<Result | null>(null);
  const [linkError, setLinkError] = useState(false);
  const pending = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const schoolName = schoolId === 'nthu' ? '清大' : '暨大';
  const fullSchoolName = schoolId === 'nthu' ? '國立清華大學' : '國立暨南國際大學';
  const catalogUrl = resolveOfficialCourseQueryLink(schoolId)!.url;

  const search = useCallback(async (keyword: string) => {
    if (pending.current) {
      pending.current.controller.abort();
      clearTimeout(pending.current.timer);
    }
    const controller = new AbortController();
    const term = keyword.trim();
    setResult({ status: 'loading', query: term });
    const timer = setTimeout(() => {
      if (pending.current?.controller !== controller) return;
      pending.current = null;
      controller.abort();
      setResult({ status: 'error', query: term });
    }, 25_000);
    pending.current = { controller, timer };
    try {
      const response = await fetch('https://nuni.tw/api/public-course-catalog?schoolId=' + schoolId + '&q=' + encodeURIComponent(term), {
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw new Error();
      const text = await response.text();
      if (text.length > maxBytes) throw new Error();
      const data: unknown = JSON.parse(text);
      if (!isPublicCourseCatalog(data, schoolId)) throw new Error();
      if (pending.current?.controller === controller) setResult({ status: 'ready', query: term, data });
    } catch {
      if (pending.current?.controller === controller) setResult({ status: 'error', query: term });
    } finally {
      clearTimeout(timer);
      if (pending.current?.controller === controller) pending.current = null;
    }
  }, [schoolId]);

  useEffect(() => {
    if (initialQuery) void search(initialQuery);
    return () => {
      if (pending.current) {
        pending.current.controller.abort();
        clearTimeout(pending.current.timer);
      }
      pending.current = null;
    };
  }, [initialQuery, search]);

  const label = result?.query ? '「' + result.query + '」' : '';
  const body = { color: theme.colors.textSecondary, lineHeight: 22 };
  return (
    <Screen title={schoolName + '開課查詢'} subtitle={fullSchoolName + ' · 本學期公開課程'}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={result?.status === 'ready' ? result.data.courses : []}
        keyExtractor={row => [row.semester, row.code, row.section].join('-')}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        ListHeaderComponent={<View style={{ gap: 10 }}>
          <Text style={body}>依課名、課號、系所或老師搜尋，留白可瀏覽開課清單。</Text>
          <TextInput
            accessibilityLabel={'搜尋' + schoolName + '課程'} value={query} onChangeText={setQuery} maxLength={80}
            placeholder="例如：資料庫" placeholderTextColor={theme.colors.muted} returnKeyType="search"
            onSubmitEditing={() => void search(query)}
            style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 12 }}
          />
          <Button text={result?.status === 'error' ? '重新查詢' : '查詢課程'} kind="primary"
            disabled={result?.status === 'loading' && query.trim() === result.query}
            onPress={() => { Keyboard.dismiss(); void search(query); }} />
          <Button text={'開啟' + schoolName + '官方課程目錄'} kind="ghost" onPress={() => {
            setLinkError(false);
            void Linking.openURL(catalogUrl).catch(() => setLinkError(true));
          }} />
          {linkError && <Text accessibilityRole="alert" style={body}>無法開啟校方網站，請稍後再試。</Text>}
          {result?.status === 'loading' && <Text accessibilityLiveRegion="polite" style={body}>正在查詢{label}…</Text>}
          {result?.status === 'error' && <Text accessibilityRole="alert" style={body}>暫時無法讀取{schoolName}課程，請重試或查看官方課程目錄。</Text>}
          {result?.status === 'ready' && <Text accessibilityLiveRegion="polite" style={body}>
            {result.data.courses.length === 0 ? '找不到' + label + '的開課資料。' :
              result.data.truncated ? '顯示前 50 筆，輸入更明確的關鍵字可縮小範圍。' : '找到 ' + result.data.courses.length + ' 筆' + label + '開課資料。'}
          </Text>}
        </View>}
        renderItem={({ item }) => <CourseCard course={item} schoolId={schoolId} navigation={navigation} />}
      />
    </Screen>
  );
}
