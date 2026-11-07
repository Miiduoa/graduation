import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import type { PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';
import { formatPublicCatalogFetchedAt } from '@campus/shared/src/publicCourseCatalog';
import { AIButton, aiTokens } from '../ui/aiFirst';

/** Only public catalog fields are shown here; adding a class stays on its review page. */
export function PublicCourseAssistantReply({ read, content, disabled = false, onOpenCatalog }: {
  read: PublicCourseAssistantRead;
  content: string;
  disabled?: boolean;
  onOpenCatalog?: () => void;
}) {
  const [linkError, setLinkError] = useState(false);
  const official = resolveOfficialCourseQueryLink(read.schoolId);
  const body = { color: aiTokens.textSecondary, fontSize: 13, lineHeight: 21 };
  const fetchedAt = read.status === 'ready' && read.fetchedAt
    ? formatPublicCatalogFetchedAt(read.fetchedAt) : null;
  const keyword = read.query ? `「${read.query}」` : '';
  const summary = read.status === 'unavailable' ? content : read.matchCount === 0
    ? `這次沒有符合${keyword}的開課資料，可改用課號或老師姓名查詢。`
    : read.truncated ? `符合${keyword}的課程超過 ${read.matchCount} 筆，可輸入更明確的關鍵字縮小範圍。`
      : `找到 ${read.matchCount} 筆${keyword}開課資料。`;
  return <View style={{ gap: 12 }}>
    <Text selectable style={{ color: aiTokens.text, lineHeight: 24 }}>{summary}</Text>
    <Text style={body}>{read.schoolName} · 校方公開開課資料</Text>
    {read.status === 'ready' && read.courses.map((course, index) => (
      <View key={[course.semester, course.code, course.section, index].join(':')}
        style={{ gap: 4, borderTopWidth: 1, borderColor: aiTokens.border, paddingTop: 10 }}>
        <Text selectable style={{ color: aiTokens.text, fontWeight: '600', lineHeight: 23 }}>{course.title}</Text>
        <Text selectable style={body}>{`課號 ${course.code} · 班別 ${course.section || '未提供'}`}</Text>
        <Text selectable style={body}>{`學期 ${course.semester}`}</Text>
        <Text selectable style={body}>{[course.department, course.teacher, course.credits && `${course.credits} 學分`].filter(Boolean).join(' · ')}</Text>
      </View>
    ))}
    {read.status === 'ready' && read.matchCount > read.courses.length && <Text style={body}>
      這裡先列 {read.courses.length} 筆；完整查課頁會保留同一所學校與關鍵字。
    </Text>}
    {fetchedAt && <Text style={body}>校方資料擷取：{fetchedAt}（台灣時間；非校方更新時間）</Text>}
    <Text style={body}>公開課程目錄不代表你已修課、已取得學分或選課成功。</Text>
    {onOpenCatalog && <AIButton label={read.status === 'ready' ? '開啟完整查課結果' : '到查課頁重試'}
      disabled={disabled} onPress={onOpenCatalog} />}
    {official && <AIButton label="查看校方課程目錄" variant="ghost" disabled={disabled} onPress={() => {
      setLinkError(false);
      // Use the registered official destination, never a URL supplied in course text.
      void Linking.openURL(official.url).catch(() => setLinkError(true));
    }} />}
    {linkError && <Text accessibilityRole="alert" style={body}>無法開啟校方網站，請稍後再試。</Text>}
  </View>;
}
