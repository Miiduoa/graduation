import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Linking, Text, TextInput, View } from 'react-native';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { ncnuCourseMeetings } from '@campus/shared/src/ncnuCourseSchedule';
import { isNcnuPublicCourseCatalog, type PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { Button, Card, Screen } from '../ui/components';
import { theme } from '../ui/theme';

type Result =
  | { status: 'loading' | 'error'; query: string }
  | { status: 'ready'; query: string; data: PublicCourseCatalogResponse };

const catalogUrl = resolveOfficialCourseQueryLink('ncnu')!.url;
const maxBytes = 512 * 1024;

export function NcnuCourseCatalogScreen({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<Result | null>(null);
  const [linkError, setLinkError] = useState(false);
  const pending = useRef<AbortController | null>(null);

  const search = useCallback(async (keyword: string) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const term = keyword.trim();
    setResult({ status: 'loading', query: term });
    const timer = setTimeout(() => {
      if (pending.current !== controller) return;
      pending.current = null;
      controller.abort();
      setResult({ status: 'error', query: term });
    }, 25_000);
    try {
      const response = await fetch('https://nuni.tw/api/public-course-catalog?schoolId=ncnu&q=' + encodeURIComponent(term), {
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw new Error();
      const text = await response.text();
      if (text.length > maxBytes) throw new Error();
      const data: unknown = JSON.parse(text);
      if (!isNcnuPublicCourseCatalog(data)) throw new Error();
      if (pending.current === controller) setResult({ status: 'ready', query: term, data });
    } catch {
      if (pending.current === controller) setResult({ status: 'error', query: term });
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
    }
  }, []);

  useEffect(() => {
    if (initialQuery) void search(initialQuery);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [initialQuery, search]);

  const label = result?.query ? '「' + result.query + '」' : '';
  const body = { color: theme.colors.textSecondary, lineHeight: 22 };
  return (
    <Screen title="暨大開課查詢" subtitle="國立暨南國際大學 · 本學期公開課程">
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={result?.status === 'ready' ? result.data.courses : []}
        keyExtractor={row => [row.semester, row.code, row.section].join('-')}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        ListHeaderComponent={<View style={{ gap: 10 }}>
          <Text style={body}>依課名、課號、系所或老師搜尋，留白可瀏覽開課清單。</Text>
          <TextInput
            accessibilityLabel="搜尋暨大課程" value={query} onChangeText={setQuery} maxLength={80}
            placeholder="例如：資料庫" placeholderTextColor={theme.colors.muted} returnKeyType="search"
            onSubmitEditing={() => void search(query)}
            style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 12 }}
          />
          <Button text={result?.status === 'error' ? '重新查詢' : '查詢課程'} kind="primary"
            disabled={result?.status === 'loading' && query.trim() === result.query}
            onPress={() => { Keyboard.dismiss(); void search(query); }} />
          <Button text="開啟暨大官方課程目錄" kind="ghost" onPress={() => {
            setLinkError(false);
            void Linking.openURL(catalogUrl).catch(() => setLinkError(true));
          }} />
          {linkError && <Text accessibilityRole="alert" style={body}>無法開啟校方網站，請稍後再試。</Text>}
          {result?.status === 'loading' && <Text accessibilityLiveRegion="polite" style={body}>正在查詢{label}…</Text>}
          {result?.status === 'error' && <Text accessibilityRole="alert" style={body}>暫時無法讀取暨大課程，請重試或查看官方課程目錄。</Text>}
          {result?.status === 'ready' && <Text accessibilityLiveRegion="polite" style={body}>
            {result.data.courses.length === 0 ? '找不到' + label + '的開課資料。' :
              result.data.truncated ? '顯示前 50 筆，輸入更明確的關鍵字可縮小範圍。' : '找到 ' + result.data.courses.length + ' 筆' + label + '開課資料。'}
          </Text>}
        </View>}
        renderItem={({ item }) => {
          const meetings = ncnuCourseMeetings(item.time, item.semester);
          return <Card title={item.title} subtitle={`課號 ${item.code} · 班別 ${item.section || '未提供'}`}>
            <Text style={body}>{[item.department, item.teacher, item.credits && item.credits + ' 學分'].filter(Boolean).join(' · ')}</Text>
            <Text style={body}>{meetings?.map(meeting => meeting.label).join('、') || (item.time ? '校方節次 ' + item.time : '上課時間未提供')}{item.room ? ' · ' + item.room : ''}</Text>
            <Text style={body}>{item.semester.replace(/^(\d{3})([12])$/, '$1 學年度第 $2 學期')}</Text>
          </Card>;
        }}
      />
    </Screen>
  );
}
