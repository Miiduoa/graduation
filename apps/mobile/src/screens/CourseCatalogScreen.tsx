/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 課綱查詢系統 — 完整查詢畫面
 *
 * 來源：https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Screen, Pill, Button } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchedule } from '../state/schedule';

import {
  CATALOG_SEMESTERS,
  CATALOG_WEEKDAYS,
  CATALOG_PERIODS,
  CATALOG_BUILDINGS,
  CATALOG_COURSE_TYPES,
  CATALOG_COURSE_CATEGORIES,
  CATALOG_LANGUAGES,
  CATALOG_COLLEGES,
  CATALOG_DEFAULT_FILTER,
  getCurrentCatalogSemester,
  type CatalogFilter,
} from '../data/courseCatalogConstants';
import {
  queryCatalog,
  toPersonalCourseDraft,
  detectConflicts,
  type CatalogCourse,
  type CatalogQueryResult,
} from '../services/courseCatalogClient';
import { getCatalogRoleConfig, type ExtendedRole } from '../services/courseCatalogRoleMapping';
import { analytics } from '../services/analytics';
import { isTronClassPuHostedUrl } from '../services/tronClassDataEnabled';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

// ─── 子元件：橫向 chip 列 ─────────────────────────────────

function ChipRow<T extends string | number>(props: {
  items: { value: T; label: string }[];
  selected: T | undefined;
  onSelect: (v: T | undefined) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2, paddingRight: 16 }}>
        <Pressable
          onPress={() => props.onSelect(undefined)}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: !props.selected ? theme.colors.accent : theme.colors.border,
            backgroundColor: !props.selected ? theme.colors.accent + '1F' : theme.colors.surface,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 13 }}>不限</Text>
        </Pressable>
        {props.items.map((it) => {
          const active = props.selected === it.value;
          return (
            <Pressable
              key={String(it.value)}
              onPress={() => props.onSelect(active ? undefined : it.value)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: active ? theme.colors.accent : theme.colors.border,
                backgroundColor: active ? theme.colors.accent + '1F' : theme.colors.surface,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 13 }}>{it.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── 子元件：篩選面板 ─────────────────────────────────────

function FilterPanel(props: {
  filter: CatalogFilter;
  onChange: (patch: Partial<CatalogFilter>) => void;
  onReset: () => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const { filter } = props;

  const collegeOptions = useMemo(
    () => CATALOG_COLLEGES.map((c) => ({ value: c.zh, label: c.zh })),
    [],
  );
  const departmentOptions = useMemo(() => {
    const c = CATALOG_COLLEGES.find((x) => x.zh === filter.college);
    if (!c) return [];
    return c.departments.map((d) => ({ value: d.value, label: d.label }));
  }, [filter.college]);

  const Section = ({
    title,
    hint,
    children,
  }: {
    title: string;
    hint?: string;
    children: React.ReactNode;
  }) => (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', fontSize: 14, color: theme.colors.text }}>{title}</Text>
        {hint ? <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );

  return (
    <View style={{ gap: 16, paddingBottom: 24 }}>
      <Section title="學期">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
            {CATALOG_SEMESTERS.slice(0, 12).map((s) => {
              const active = filter.semester === s.code;
              return (
                <Pressable
                  key={s.code}
                  onPress={() => props.onChange({ semester: s.code })}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                    backgroundColor: active ? theme.colors.accent + '1F' : theme.colors.surface,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Section>

      <Section title="課名 / 教師 / 代號" hint="任一關鍵字">
        <TextInput
          placeholder="例：演算法、王老師、IM3201"
          placeholderTextColor={theme.colors.muted}
          value={filter.keyword ?? ''}
          onChangeText={(t) => props.onChange({ keyword: t })}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
          }}
        />
      </Section>

      <Section title="星期">
        <ChipRow
          items={CATALOG_WEEKDAYS.filter((d) => d.value !== 0).map((d) => ({
            value: d.value,
            label: `週${['', '一', '二', '三', '四', '五', '六', '日'][d.value]}`,
          }))}
          selected={filter.weekday}
          onSelect={(v) => props.onChange({ weekday: v ?? 0 })}
        />
      </Section>

      <Section title="節次">
        <ChipRow
          items={CATALOG_PERIODS.filter((p) => p.teaching).map((p) => ({
            value: p.value,
            label: `${p.value}節`,
          }))}
          selected={filter.period}
          onSelect={(v) => props.onChange({ period: v ?? 0 })}
        />
      </Section>

      <Section title="大樓">
        <ChipRow
          items={CATALOG_BUILDINGS.map((b) => ({ value: b.code, label: `${b.code} ${b.zh}` }))}
          selected={filter.building}
          onSelect={(v) => props.onChange({ building: v ?? undefined })}
        />
      </Section>

      <Section title="修別">
        <ChipRow
          items={CATALOG_COURSE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          selected={filter.courseType as any}
          onSelect={(v) => props.onChange({ courseType: v as any })}
        />
      </Section>

      <Section title="學院">
        <ChipRow
          items={collegeOptions}
          selected={filter.college}
          onSelect={(v) => props.onChange({ college: v, department: undefined })}
        />
      </Section>

      {departmentOptions.length > 0 && (
        <Section title="系所 / 中心">
          <ChipRow
            items={departmentOptions}
            selected={filter.department}
            onSelect={(v) => props.onChange({ department: v })}
          />
        </Section>
      )}

      <Section title="課程種類">
        <ChipRow
          items={CATALOG_COURSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          selected={filter.category as any}
          onSelect={(v) => props.onChange({ category: v as any })}
        />
      </Section>

      <Section title="授課語言">
        <ChipRow
          items={CATALOG_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
          selected={filter.language as any}
          onSelect={(v) => props.onChange({ language: v as any })}
        />
      </Section>

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <Button text="重設" kind="ghost" onPress={props.onReset} style={{ flex: 1 }} />
        <Button
          text={props.loading ? '查詢中…' : '送出查詢'}
          onPress={props.onSubmit}
          loading={props.loading}
          kind="primary"
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

// ─── 子元件：課程結果卡 ───────────────────────────────────

function CourseCard(props: {
  course: CatalogCourse;
  canAddToSchedule: boolean;
  onAdd: () => void;
  onSyllabus: () => void;
  conflict?: string | null;
  showRemain: boolean;
}) {
  const c = props.course;
  const typeTone =
    c.courseTypeKey === 'required'
      ? 'danger'
      : c.courseTypeKey === 'general'
        ? 'success'
        : c.courseTypeKey === 'elective'
          ? 'accent'
          : 'default';

  return (
    <View
      style={{
        padding: 14,
        marginBottom: 10,
        gap: 10,
        borderRadius: 14,
        borderWidth: 1,
        backgroundColor: theme.colors.surface,
        borderColor: props.conflict ? '#D7001540' : theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontWeight: '800', fontSize: 16, color: theme.colors.text }}
            numberOfLines={2}
          >
            {c.name || '未命名課程'}
          </Text>
          {c.nameEn ? (
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              {c.nameEn}
            </Text>
          ) : null}
        </View>
        <Pill text={`${c.credits} 學分`} kind="accent" size="sm" />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {c.courseType ? <Pill text={c.courseType} kind={typeTone as any} size="sm" /> : null}
        {c.classOffered ? <Pill text={c.classOffered} kind="muted" size="sm" /> : null}
        {c.tags.includes('co_teaching') ? <Pill text="合授" kind="warning" size="sm" /> : null}
        {c.tags.includes('practice') ? <Pill text="實習" kind="warning" size="sm" /> : null}
        {c.tags.includes('emi') ? <Pill text="EMI" kind="accent" size="sm" /> : null}
        {c.tags.includes('micro_credit') ? <Pill text="微學分" kind="warning" size="sm" /> : null}
      </View>

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="person-outline" size={13} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.text, fontSize: 13 }}>{c.teacher || '—'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Ionicons
            name="time-outline"
            size={13}
            color={theme.colors.muted}
            style={{ marginTop: 2 }}
          />
          <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
            {c.timePlaceRaw || '時間未公告'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="barcode-outline" size={13} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            選課代號 {c.code}
            {props.showRemain && c.remaining != null && c.capacity != null
              ? ` · 餘額 ${c.remaining}/${c.capacity}`
              : c.capacity != null
                ? ` · 容量 ${c.capacity}`
                : ''}
          </Text>
        </View>
      </View>

      {c.notes ? (
        <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}>
          備註：{c.notes}
        </Text>
      ) : null}

      {props.conflict ? (
        <View
          style={{
            padding: 8,
            borderRadius: 8,
            backgroundColor: '#D7001511',
            borderWidth: 1,
            borderColor: '#D7001540',
          }}
        >
          <Text style={{ color: '#D70015', fontSize: 12 }}>⚠️ 與已選課衝堂：{props.conflict}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
        {c.syllabusUrl ? (
          <Pressable
            onPress={props.onSyllabus}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 13 }}>查看課綱</Text>
          </Pressable>
        ) : null}
        {props.canAddToSchedule ? (
          <Pressable
            onPress={props.onAdd}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>加入我的課表</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ─── 主畫面 ──────────────────────────────────────────────

export function CourseCatalogScreen(props: { navigation?: any; route?: any }) {
  const auth = useAuth();
  const schedule = useSchedule();

  const initialFilter: CatalogFilter = {
    ...CATALOG_DEFAULT_FILTER,
    ...(props.route?.params?.filter ?? {}),
  };

  const role: ExtendedRole = (auth.profile?.role as ExtendedRole) ?? 'visitor';
  const roleConfig = getCatalogRoleConfig(role);

  const [filter, setFilter] = useState<CatalogFilter>(initialFilter);
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [loading, setLoading] = useState(true); // 進畫面立刻 loading，避免閃白
  const [result, setResult] = useState<CatalogQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRunOnce, setHasRunOnce] = useState(false);

  const runQuery = useCallback(
    async (force = false, overrideFilter?: CatalogFilter) => {
      const f = overrideFilter ?? filter;
      setLoading(true);
      setError(null);
      try {
        const r = await queryCatalog(f, { forceRefresh: force, limit: 300 });
        setResult(r);
        if (r.error) setError(r.error);
        analytics.logEvent?.('catalog_query', {
          semester: f.semester,
          college: f.college ?? null,
          department: f.department ?? null,
          keyword: f.keyword ?? null,
          count: r.courses.length,
          role,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '查詢失敗，請稍後再試');
      } finally {
        setLoading(false);
        setShowFilter(false);
        setHasRunOnce(true);
      }
    },
    [filter, role],
  );

  // 首次進入：自動觸發一次合理的預設查詢，避免空狀態
  useEffect(() => {
    const initial: CatalogFilter = { ...filter };
    // 學生 → 預設抓本系；其餘 → 抓本學期通識，避免列表過大
    if (auth.profile?.department && roleConfig.role === 'student') {
      initial.department = auth.profile.department;
    } else if (!auth.profile?.department) {
      initial.courseType = 'general';
    }
    setFilter(initial);
    void runQuery(false, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingScheduleCourses = useMemo(() => {
    return (schedule.courses ?? []).flatMap((c: any) =>
      (c.schedule ?? []).map((s: any) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        name: c.name,
      })),
    );
  }, [schedule.courses]);

  const handleAddToSchedule = useCallback(
    (course: CatalogCourse) => {
      const draft = toPersonalCourseDraft(course);
      if (!draft.schedule.length) {
        Alert.alert('時間未定', '此課程未提供上課時段，無法直接加入課表。');
        return;
      }
      try {
        (schedule.addCourse as any)?.({
          id: `catalog-${course.code}-${course.semester}`,
          code: course.code,
          name: course.name,
          instructor: course.teacher,
          credits: course.credits,
          semester: course.semester,
          schedule: draft.schedule,
        });
        Alert.alert('已加入課表', `${course.name} 已加入我的課表`);
        analytics.logEvent?.('catalog_add_to_schedule', { code: course.code });
      } catch (err) {
        Alert.alert('加入失敗', err instanceof Error ? err.message : '請稍後再試');
      }
    },
    [schedule],
  );

  const currentSemLabel =
    CATALOG_SEMESTERS.find((s) => s.code === filter.semester)?.label ??
    getCurrentCatalogSemester().label;

  // ─── 渲染 ──────────────────────────────────────────────

  const renderHeader = () => (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 12 }}>
      {/* 搜尋列 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Ionicons name="search" size={18} color={theme.colors.muted} />
        <TextInput
          value={pendingKeyword}
          onChangeText={setPendingKeyword}
          placeholder={`搜尋 ${currentSemLabel} 課程、教師、代號`}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="search"
          onSubmitEditing={() => {
            const f = { ...filter, keyword: pendingKeyword.trim() };
            setFilter(f);
            void runQuery(true, f);
          }}
          style={{ flex: 1, color: theme.colors.text, fontSize: 14, padding: 0 }}
        />
        {pendingKeyword ? (
          <Pressable onPress={() => setPendingKeyword('')}>
            <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => setShowFilter(true)} hitSlop={8}>
          <Ionicons name="options-outline" size={20} color={theme.colors.accent} />
        </Pressable>
      </View>

      {/* 角色快捷 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
          {roleConfig.quickActions.map((qa) => {
            const active =
              filter.courseType ===
                (qa.defaultFilter?.courseType ?? '___no_match___') ||
              filter.category ===
                (qa.defaultFilter?.category ?? '___no_match___') ||
              (qa.id === 'this_semester' &&
                !filter.courseType &&
                !filter.category &&
                !filter.keyword);
            return (
              <Pressable
                key={qa.id}
                onPress={() => {
                  setPendingKeyword('');
                  const f: CatalogFilter = {
                    semester: filter.semester,
                    ...(qa.defaultFilter ?? {}),
                  };
                  setFilter(f);
                  void runQuery(true, f);
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: active
                    ? theme.colors.accent
                    : theme.colors.accent + '40',
                  backgroundColor: active
                    ? theme.colors.accent + '22'
                    : theme.colors.surface,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.accent,
                    fontSize: 13,
                    fontWeight: active ? '800' : '600',
                  }}
                >
                  {qa.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* 狀態列 */}
      {result ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pill
            text={currentSemLabel}
            kind="muted"
            size="sm"
            icon="calendar"
          />
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {result.courses.length} 筆
            {result.source === 'cache' ? '（快取）' : ''}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View
          style={{
            padding: 10,
            borderRadius: 10,
            backgroundColor: '#D7001511',
            borderWidth: 1,
            borderColor: '#D7001540',
            flexDirection: 'row',
            gap: 8,
          }}
        >
          <Ionicons name="alert-circle" size={16} color="#D70015" />
          <Text style={{ color: '#D70015', fontSize: 12, flex: 1 }}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderOnboarding = () => (
    <View style={{ padding: 24, alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: theme.colors.accent + '1A',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="library-outline" size={32} color={theme.colors.accent} />
      </View>
      <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 18 }}>
        靜宜大學 課綱查詢
      </Text>
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
          maxWidth: 280,
        }}
      >
        即時查詢校方公開的「{currentSemLabel}」開課資料，包含選課代號、時間地點、選課人數與教師。
      </Text>
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: 12,
          textAlign: 'center',
          marginTop: 4,
        }}
      >
        試試上方搜尋框，或選一個快捷篩選 →
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { label: '熱門：演算法', kw: '演算法' },
          { label: '熱門：經濟學', kw: '經濟學' },
          { label: '熱門：英文', kw: '英文' },
        ].map((s) => (
          <Pressable
            key={s.kw}
            onPress={() => {
              setPendingKeyword(s.kw);
              const f = { ...filter, keyword: s.kw };
              setFilter(f);
              void runQuery(true, f);
            }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 13 }}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
      <Ionicons
        name="search-outline"
        size={44}
        color={theme.colors.muted}
        style={{ opacity: 0.4 }}
      />
      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>查無符合條件的課程</Text>
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: 12,
          textAlign: 'center',
          maxWidth: 260,
          lineHeight: 18,
        }}
      >
        系統使用了你目前的篩選條件。試著放寬條件、改變學期，或檢查是否拼錯字。
      </Text>
      <Pressable
        onPress={() => setShowFilter(true)}
        style={{
          marginTop: 6,
          paddingHorizontal: 18,
          paddingVertical: 9,
          borderRadius: 18,
          backgroundColor: theme.colors.accent,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>調整條件</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen
      title="課綱查詢"
      subtitle={`${roleConfig.zhName} · 資料來自靜宜大學課綱查詢系統`}
      noPadding
    >
      <FlatList
        data={result?.courses ?? []}
        keyExtractor={(c, idx) => `${c.code}-${idx}`}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 24,
          paddingTop: 4,
        }}
        ListEmptyComponent={
          loading ? (
            <View style={{ padding: 30, alignItems: 'center' }}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={{ marginTop: 10, color: theme.colors.muted, fontSize: 12 }}>
                正在連線校方系統…
              </Text>
            </View>
          ) : hasRunOnce ? (
            renderEmpty()
          ) : (
            renderOnboarding()
          )
        }
        onRefresh={() => runQuery(true)}
        refreshing={loading && (result?.courses?.length ?? 0) > 0}
        renderItem={({ item }) => {
          const conflicts = roleConfig.canAddToSchedule
            ? detectConflicts(item, existingScheduleCourses)
            : [];
          const conflictText = conflicts.length
            ? conflicts.map((c) => `週${c.day} ${c.overlap} (${c.withName})`).join('、')
            : null;
          return (
            <CourseCard
              course={item}
              canAddToSchedule={roleConfig.canAddToSchedule}
              showRemain={result?.showRemain ?? false}
              conflict={conflictText}
              onAdd={() => handleAddToSchedule(item)}
              onSyllabus={() => {
                const u = item.syllabusUrl;
                if (!u) return;
                void linkingOpenWithPuTronClassGate(u).then((ok) => {
                  if (!ok && !isTronClassPuHostedUrl(u)) {
                    Alert.alert('無法開啟連結', u);
                  }
                });
              }}
            />
          );
        }}
      />

      {/* 進階篩選 Modal */}
      <Modal
        visible={showFilter}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilter(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={() => setShowFilter(false)} hitSlop={8}>
              <Text style={{ color: theme.colors.accent, fontSize: 16 }}>取消</Text>
            </Pressable>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
              完整查詢條件
            </Text>
            <Pressable onPress={() => setFilter(CATALOG_DEFAULT_FILTER)} hitSlop={8}>
              <Text style={{ color: theme.colors.muted, fontSize: 14 }}>清除</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <FilterPanel
              filter={filter}
              onChange={(patch) => setFilter((f) => ({ ...f, ...patch }))}
              onReset={() => setFilter(CATALOG_DEFAULT_FILTER)}
              onSubmit={() => runQuery(true)}
              loading={loading}
            />
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

export default CourseCatalogScreen;
