import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import { validCampusSenseSnapshot, CAMPUS_SENSE_MAX_AGE_MS, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { assignmentDeadlineLabel, queryCampusAssignments, type CampusAssignmentFilter, type CampusAssignmentSort } from '../services/campusAssignmentQuery';
import { CampusAssignmentOpenButton } from './CampusAssignmentOpenButton';

const FILTERS: ReadonlyArray<{ value: CampusAssignmentFilter; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'today', label: '今天截止' },
  { value: 'seven-days', label: '未來七天' }, { value: 'overdue', label: '已逾期' },
  { value: 'undated', label: '未提供日期' },
];

export interface CampusAssignmentWorkbenchContext {
  userId: string;
  schoolId: string;
  isCurrent: () => boolean;
  navigation?: Parameters<typeof safeNavigate>[0];
}

export function CampusAssignmentWorkbench({ snapshot, context, disabled }: {
  snapshot: CampusSenseSnapshot;
  context: CampusAssignmentWorkbenchContext;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CampusAssignmentFilter>('all');
  const [sort, setSort] = useState<CampusAssignmentSort>('deadline');
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(Date.now);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 30_000);
    const expiry = setTimeout(tick, Math.max(0,
      Date.parse(snapshot.checkedAt) + CAMPUS_SENSE_MAX_AGE_MS - Date.now()) + 1);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      alive.current = false;
      clearInterval(interval);
      clearTimeout(expiry);
      subscription.remove();
    };
  }, [snapshot.checkedAt]);

  const scope = { uid: context.userId, schoolId: context.schoolId };
  const current = () => alive.current && context.isCurrent() &&
    Boolean(validCampusSenseSnapshot(snapshot, scope));
  const verified = context.isCurrent() ? validCampusSenseSnapshot(snapshot, scope, now) : null;
  if (!verified || verified.assignments.status !== 'available') {
    return <Text accessibilityRole="alert" style={{ color: aiTokens.muted, lineHeight: 21 }}>
      作業資料已失效或目前無法取得，請重新同步後再查看。
    </Text>;
  }
  const result = queryCampusAssignments({ items: verified.assignments.items, query, filter, sort, page, now });
  const missing = Math.max(0, (verified.assignments.count ?? result.loaded) - result.loaded);
  const partial = missing > 0 || verified.assignments.coverage?.complete === false;
  const reset = () => { setQuery(''); setFilter('all'); setSort('deadline'); setPage(0); };
  const reminderContext = {
    userId: context.userId, schoolId: context.schoolId,
    snapshot: verified, isCurrent: current,
  };

  return (
    <View style={{ gap: 12, paddingTop: 8 }}>
      <Text accessibilityRole="header" style={{ color: aiTokens.text, fontSize: 17, fontWeight: '700' }}>
        作業工作台
      </Text>
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
        只搜尋這次已同步的清單，在手機內篩選，不呼叫模型，也不新增校園網路查詢。
      </Text>
      <TextInput
        accessibilityLabel="搜尋已同步作業"
        placeholder="搜尋作業或課程，例如：資料庫 報告"
        placeholderTextColor={aiTokens.muted}
        value={query}
        onChangeText={(text) => { setQuery(text); setPage(0); }}
        maxLength={160}
        editable={!disabled}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={{ color: aiTokens.text, backgroundColor: aiTokens.panel, borderColor: aiTokens.border,
          borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, minHeight: 46 }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map((item) => (
          <Pressable key={item.value} accessibilityRole="button"
            accessibilityLabel={'篩選作業：' + item.label}
            accessibilityState={{ selected: filter === item.value, disabled }}
            disabled={disabled}
            onPress={() => { setFilter(item.value); setPage(0); }}
            style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12,
              borderWidth: 1, borderColor: filter === item.value ? aiTokens.ai : aiTokens.border,
              backgroundColor: aiTokens.panel, opacity: disabled ? 0.5 : 1 }}>
            <Text style={{ color: filter === item.value ? aiTokens.ai : aiTokens.text, fontWeight: '600' }}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['deadline', 'course'] as const).map((value) => (
          <Pressable key={value} accessibilityRole="button"
            accessibilityLabel={value === 'deadline' ? '依截止時間排序' : '依課程排序'}
            accessibilityState={{ selected: sort === value, disabled }} disabled={disabled}
            onPress={() => { setSort(value); setPage(0); }}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, opacity: disabled ? 0.5 : 1 }}>
            <Text style={{ color: sort === value ? aiTokens.ai : aiTokens.muted }}>
              {sort === value ? '✓ ' : ''}{value === 'deadline' ? '期限優先' : '課程排序'}
            </Text>
          </Pressable>
        ))}
        <AIButton label="重設作業篩選" size="sm" variant="ghost" disabled={disabled} onPress={reset} />
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, fontWeight: '600' }}>
        符合條件 {result.matched} 筆 · 已同步 {result.loaded} 筆
      </Text>
      {partial ? <Text style={{ color: aiTokens.warning, fontSize: 12, lineHeight: 20 }}>
        {missing > 0 ? '另有 ' + missing + ' 筆尚未同步，未納入搜尋。' : '目前是部分來源資料。'}沒有搜尋結果不代表沒有其他作業。
      </Text> : null}
      {result.rows.length === 0 ? (
        <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
          {query.trim() || filter !== 'all' ? '已同步清單沒有符合條件的作業。可重設篩選，或到課程頁核對。'
            : '已接通來源這次未列出待交作業；不代表所有校方系統都沒有作業。'}
        </Text>
      ) : result.rows.map(({ key, assignment, overdue }) => (
        <View key={key} style={{ backgroundColor: aiTokens.panel, borderRadius: 12,
          borderColor: aiTokens.border, borderWidth: 1, padding: 13, gap: 7 }}>
          <Text style={{ color: aiTokens.muted, fontSize: 12 }}>{assignment.groupName || '課程名稱未提供'}</Text>
          <Text style={{ color: aiTokens.text, fontSize: 15, fontWeight: '600', lineHeight: 23 }}>{assignment.title}</Text>
          <Text style={{ color: overdue ? aiTokens.warning : aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
            {assignmentDeadlineLabel(assignment, now)}
          </Text>
          <CampusAssignmentOpenButton assignment={assignment} context={reminderContext}
            navigation={context.navigation} disabled={disabled} />
        </View>
      ))}
      {result.pageCount > 1 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
            顯示第 {result.start}–{result.end} 筆，共 {result.matched} 筆
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AIButton label="上一頁作業" size="sm" variant="ghost" style={{ flex: 1 }}
              disabled={disabled || result.page === 0} onPress={() => setPage(result.page - 1)} />
            <AIButton label="下一頁作業" size="sm" variant="ghost" style={{ flex: 1 }}
              disabled={disabled || result.page >= result.pageCount - 1} onPress={() => setPage(result.page + 1)} />
          </View>
        </View>
      ) : null}
      {typeof context.navigation?.navigate === 'function' ? (
        <AIButton label="到課程總覽核對" variant="ghost" size="sm" disabled={disabled}
          onPress={() => { if (current()) safeNavigate(context.navigation, 'CoursesHome'); }} />
      ) : null}
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
        期限已過不代表一定未繳交；繳交狀態仍以作業頁重新查詢的結果為準。
      </Text>
    </View>
  );
}
