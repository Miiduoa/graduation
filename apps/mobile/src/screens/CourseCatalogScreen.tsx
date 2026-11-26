/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 課綱查詢系統 — 完整查詢畫面
 *
 * 來源：https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  resolveCourseCatalogCapability,
  resolveOfficialCourseQueryLink,
  unsupportedCourseCatalogMessage,
  type School,
} from '@campus/shared/src';

import {
  isPuEcampusDataFetchEnabled,
  PU_ECAMPUS_DATA_PAUSED_MESSAGE,
} from '@campus/shared/src/puEcampusDataPolicy';
import { formatDateTime } from '../utils/format';
import { Screen, Button } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { TextAction } from '../ui/interactive/TextAction';
import { useAuth } from '../state/auth';
import { useSchedule } from '../state/schedule';
import { useSchool } from '../state/school';
import { PublicCourseCatalogScreen } from './PublicCourseCatalogScreen';
import { parsePublicCourseFilters, type PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { isPublicCourseOperationQuery } from '@campus/shared/src/publicCourseOperations';
import { safeNavigate } from '../utils/safeNavigate';

import {
  buildCatalogSemesters,
  CATALOG_WEEKDAYS,
  CATALOG_PERIODS,
  CATALOG_BUILDINGS,
  CATALOG_COURSE_TYPES,
  CATALOG_COURSE_CATEGORIES,
  CATALOG_LANGUAGES,
  CATALOG_COLLEGES,
  getDefaultCatalogFilter,
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

// ─── 子元件：單選 chip（森林綠 = 選取；未選取只有細框） ───────

const hairline = StyleSheet.hairlineWidth;

function ChoiceChip(props: { label: string; selected: boolean; onPress: () => void; bold?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={{
        paddingHorizontal: 14,
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: props.selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: props.selected ? theme.colors.accent : 'transparent',
      }}
    >
      <Text
        style={{
          color: props.selected ? theme.colors.onAccent : theme.colors.text,
          fontSize: 14,
          fontWeight: props.selected || props.bold ? '700' : '400',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}


// ─── 子元件：橫向 chip 列 ─────────────────────────────────

function ChipRow<T extends string | number>(props: {
  items: { value: T; label: string }[];
  selected: T | undefined;
  onSelect: (v: T | undefined) => void;
}) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2, paddingRight: 16 }}>
        <ChoiceChip label="不限" selected={!props.selected} onPress={() => props.onSelect(undefined)} />
        {props.items.map((it) => {
          const active = props.selected === it.value;
          return (
            <ChoiceChip
              key={String(it.value)}
              label={it.label}
              selected={active}
              onPress={() => props.onSelect(active ? undefined : it.value)}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── 子元件：篩選面板 ─────────────────────────────────────

const Section = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text
        accessibilityRole="header"
        style={{ fontWeight: '600', fontSize: 13, letterSpacing: 0.3, color: theme.colors.textSecondary }}
      >
        {title}
      </Text>
      {hint ? <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
    {children}
  </View>
);

function FilterPanel(props: {
  filter: CatalogFilter;
  onChange: (patch: Partial<CatalogFilter>) => void;
  onReset: () => void;
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

  return (
    <View style={{ gap: 20, paddingBottom: 24 }}>
      <Section title="學期">
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingRight: 16 }}>
            {buildCatalogSemesters().slice(0, 12).map((s) => (
              <ChoiceChip
                key={s.code}
                label={s.label}
                selected={filter.semester === s.code}
                onPress={() => props.onChange({ semester: s.code })}
              />
            ))}
          </View>
        </ScrollView>
      </Section>

      <Section title="課名 / 教師 / 代號" hint="任一關鍵字">
        <TextInput
          accessibilityLabel="篩選課程關鍵字"
          placeholder="例：演算法、王老師、IM3201"
          placeholderTextColor={theme.colors.muted}
          value={filter.keyword ?? ''}
          onChangeText={(t) => props.onChange({ keyword: t })}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
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

      <TextAction label="重設篩選條件" onPress={props.onReset} />
    </View>
  );
}

// ─── 子元件：課程結果卡 ───────────────────────────────────

function CourseCard(props: {
  course: CatalogCourse;
  canAddToSchedule: boolean;
  added: boolean;
  onAdd: () => Promise<void>;
  onSyllabus?: () => void;
  conflict?: string | null;
  showRemain: boolean;
}) {
  const c = props.course;
  const [adding, setAdding] = useState(false);
  const tags = [
    c.tags.includes('co_teaching') ? '合授' : null,
    c.tags.includes('practice') ? '實習' : null,
    c.tags.includes('emi') ? 'EMI' : null,
    c.tags.includes('micro_credit') ? '微學分' : null,
  ].filter(Boolean);
  const facts = [c.teacher || '—', `${c.credits} 學分`, c.courseType, c.classOffered].filter(Boolean);
  const metaStyle = { color: theme.colors.muted, fontSize: 13, lineHeight: 19 } as const;

  return (
    <View
      style={{
        paddingVertical: 16,
        paddingLeft: props.conflict ? 12 : 0,
        gap: 4,
        borderTopWidth: hairline,
        borderTopColor: theme.colors.separator,
        borderLeftWidth: props.conflict ? 2 : 0,
        borderLeftColor: theme.colors.danger,
      }}
    >
      <Text
        style={{ fontWeight: '700', fontSize: 17, lineHeight: 24, color: theme.colors.text }}
        numberOfLines={2}
      >
        {c.name || '未命名課程'}
      </Text>
      {c.nameEn ? <Text style={metaStyle}>{c.nameEn}</Text> : null}

      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
        {facts.join(' · ')}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
        {c.timePlaceRaw || '時間未公告'}
      </Text>
      <Text style={metaStyle}>
        選課代號 {c.code}
        {props.showRemain && c.remaining != null && c.capacity != null
          ? ` · 餘額 ${c.remaining}/${c.capacity}`
          : c.capacity != null
            ? ` · 容量 ${c.capacity}`
            : ''}
      </Text>
      {tags.length ? <Text style={metaStyle}>{tags.join(' · ')}</Text> : null}

      {c.notes ? <Text style={{ ...metaStyle, fontSize: 12, lineHeight: 17 }}>備註：{c.notes}</Text> : null}

      {props.conflict ? (
        <Text style={{ color: theme.colors.danger, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
          ⚠️ 與已選課衝堂：{props.conflict}
        </Text>
      ) : null}

      {(props.onSyllabus && c.syllabusUrl) || props.canAddToSchedule ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 }}>
          {props.canAddToSchedule ? (
            props.added ? (
              <Pressable
                disabled
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ color: theme.colors.success, fontSize: 14, fontWeight: '600' }}>
                  已在本機課程清單
                </Text>
              </Pressable>
            ) : (
              <Pressable
                disabled={adding}
                accessibilityRole="button"
                accessibilityState={{ disabled: adding, busy: adding }}
                onPress={async () => {
                  setAdding(true);
                  try {
                    await props.onAdd();
                  } finally {
                    setAdding(false);
                  }
                }}
                style={{
                  paddingHorizontal: 16,
                  borderRadius: theme.radius.sm,
                  minHeight: 44,
                  justifyContent: 'center',
                  backgroundColor: theme.colors.accent,
                  opacity: adding ? 0.7 : 1,
                }}
              >
                <Text style={{ color: theme.colors.onAccent, fontSize: 14, fontWeight: '700' }}>
                  {adding ? '加入中…' : '加入本機課程清單'}
                </Text>
              </Pressable>
            )
          ) : null}
          {props.onSyllabus && c.syllabusUrl ? (
            <TextAction label="查看課綱" accessibilityRole="link" onPress={props.onSyllabus} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── 主畫面（依選校能力閘道） ─────────────────────────────

type CatalogScreenProps = { navigation?: any; route?: any };
type ActiveScope = React.MutableRefObject<string>;

function UnsupportedCourseCatalogScreen(props: {
  school: School;
  navigation?: any;
}) {
  const official = resolveOfficialCourseQueryLink(props.school.id);
  const [linkError, setLinkError] = useState('');
  return (
    <Screen title="課綱查詢" subtitle={`${props.school.name} · 尚未接入內建課綱`}>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={{ ...theme.typography.h3, color: theme.colors.text }}>
          這所學校尚未接入課綱查詢
        </Text>
        <Text style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
          {unsupportedCourseCatalogMessage(props.school.id, props.school.name)}
        </Text>
        <View style={{ gap: 4, marginTop: 12 }}>
          {official ? (
            <Button
              text={`開啟${official.label}`}
              kind="primary"
              onPress={() => {
                void Linking.openURL(official.url).catch(() => {
                  setLinkError('無法開啟校方課程查詢頁，請稍後再試。');
                });
              }}
            />
          ) : null}
          <View
            style={{
              marginTop: 8,
              borderTopWidth: hairline,
              borderTopColor: theme.colors.separator,
              flexDirection: 'row',
              flexWrap: 'wrap',
              columnGap: 20,
            }}
          >
            <TextAction
              label="查看我的課表"
              onPress={() => {
                safeNavigate(props.navigation, 'PersonalTimetable');
              }}
            />
            <TextAction
              label="匯入我的資料"
              onPress={() => {
                safeNavigate(props.navigation, 'PersonalImport');
              }}
            />
          </View>
          {linkError ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger, fontSize: 13 }}>
              {linkError}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

function publicCatalogEntry(value: unknown): { keyword: string; filters: PublicCourseFilters; requestedSemester?: string } | null {
  if (value === undefined) return { keyword: '', filters: {} };
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    let keyword = '';
    let requestedSemester: string | undefined;
    const filterValues: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'keyword' && key !== 'weekday' && key !== 'credits' && key !== 'semester') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return null;
      if (key === 'keyword') {
        if (!isPublicCourseOperationQuery(descriptor.value)) return null;
        keyword = descriptor.value;
      } else if (key === 'semester') {
        if (typeof descriptor.value !== 'string' || !/^\d{3}[12]$/.test(descriptor.value)) return null;
        requestedSemester = descriptor.value;
      } else filterValues[key] = descriptor.value;
    }
    const filters = parsePublicCourseFilters(filterValues);
    return filters ? { keyword, filters, ...(requestedSemester ? { requestedSemester } : {}) } : null;
  } catch {
    return null;
  }
}

export function CourseCatalogScreen(props: CatalogScreenProps) {
  const { school } = useSchool();
  const auth = useAuth();
  const requestedPublicSchool = props.route?.params?.publicSchoolId;
  const publicSchoolId = requestedPublicSchool === 'ncnu' || requestedPublicSchool === 'nthu'
    ? requestedPublicSchool : null;
  const capability = resolveCourseCatalogCapability(publicSchoolId ?? school.id);
  const isPublicCatalog = capability?.providerId === 'ncnu-public' || capability?.providerId === 'nthu-public';
  const entry = isPublicCatalog ? publicCatalogEntry(props.route?.params?.filter) : null;
  const scopeKey = JSON.stringify({
    schoolId: school.id,
    publicSchoolId,
    uid: auth.user?.uid ?? auth.profile?.uid ?? null,
    entryFilter: isPublicCatalog ? entry ?? 'invalid-public-filter' : props.route?.params?.filter ?? null,
    autoSearch: props.route?.params?.autoSearch === true,
  });
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;

  // A public handoff may browse another campus, but never changes the selected
  // school or the account used by the existing personal-import review.
  if (requestedPublicSchool !== undefined && !publicSchoolId) {
    return <Screen title="公開開課查詢" subtitle="查課連結無法確認">
      <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
        這個公開查課連結的學校無法確認，請回到助理重新查詢。
      </Text>
    </Screen>;
  }

  if (capability?.providerId === 'ncnu-public' || capability?.providerId === 'nthu-public') {
    if (!entry) return <Screen title="公開開課查詢" subtitle="查課條件無法確認">
      <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
        這個公開查課連結的星期、學分或搜尋條件無法確認，請回到助理重新查詢。
      </Text>
    </Screen>;
    const schoolId = capability.providerId === 'nthu-public' ? 'nthu' : 'ncnu';
    return <PublicCourseCatalogScreen key={scopeKey} schoolId={schoolId} navigation={props.navigation}
      initialQuery={entry.keyword} initialFilters={entry.filters} requestedSemester={entry.requestedSemester}
      autoSearch={props.route?.params?.autoSearch === true}
      currentSchoolName={publicSchoolId && publicSchoolId !== school.id ? school.name : undefined} />;
  }

  if (!capability) {
    return (
      <UnsupportedCourseCatalogScreen
        key={scopeKey}
        school={school}
        navigation={props.navigation}
      />
    );
  }

  return (
    <ProvidenceCourseCatalogScreen
      key={scopeKey}
      {...props}
      school={school}
      scopeKey={scopeKey}
      activeScope={activeScope}
    />
  );
}

function ProvidenceCourseCatalogScreen(props: CatalogScreenProps & {
  school: School;
  scopeKey: string;
  activeScope: ActiveScope;
}) {
  const auth = useAuth();
  const schedule = useSchedule();
  const { school, scopeKey, activeScope } = props;
  const mounted = useRef(true);
  const isCurrent = useCallback(
    () => mounted.current && activeScope.current === scopeKey,
    [activeScope, scopeKey],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const initialFilter: CatalogFilter = {
    ...getDefaultCatalogFilter(),
    ...(props.route?.params?.filter ?? {}),
  };

  const role: ExtendedRole = (auth.profile?.role as ExtendedRole) ?? 'visitor';
  const roleConfig = getCatalogRoleConfig(role);

  const [filter, setFilter] = useState<CatalogFilter>(initialFilter);
  const [pendingKeyword, setPendingKeyword] = useState(initialFilter.keyword ?? '');
  const [draftFilter, setDraftFilter] = useState<CatalogFilter | null>(null);
  const querySequence = useRef(0);
  const [loading, setLoading] = useState(true); // 進畫面立刻 loading，避免閃白
  const [result, setResult] = useState<CatalogQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRunOnce, setHasRunOnce] = useState(false);

  const runQuery = useCallback(
    async (force = false, overrideFilter?: CatalogFilter) => {
      if (!isCurrent()) return;
      const f = overrideFilter ?? filter;
      const sequence = ++querySequence.current;
      const isLatest = () => isCurrent() && querySequence.current === sequence;
      setLoading(true);
      setError(null);
      try {
        const r = await queryCatalog(f, {
          forceRefresh: force,
          limit: 300,
          schoolId: school.id,
        });
        if (!isLatest()) return;
        setResult(r);
        if (r.error) setError(r.error);
        analytics.logEvent?.('catalog_query', {
          semester: f.semester,
          college: f.college ?? null,
          department: f.department ?? null,
          keyword: f.keyword ?? null,
          count: r.courses.length,
          role,
          schoolId: school.id,
        });
      } catch (err) {
        if (!isLatest()) return;
        setError(err instanceof Error ? err.message : '查詢失敗，請稍後再試');
      } finally {
        if (isLatest()) {
          setLoading(false);
          setHasRunOnce(true);
        }
      }
    },
    [filter, role, school.id, isCurrent],
  );

  // 首次進入：自動觸發一次合理的預設查詢，避免空狀態
  useEffect(() => {
    const initial: CatalogFilter = { ...filter };
    // 從搜尋或其他頁面帶入的條件直接沿用；一般入口才套用角色預設。
    if (!props.route?.params?.filter) {
      if (auth.profile?.department && roleConfig.role === 'student') {
        initial.department = auth.profile.department;
      } else if (!auth.profile?.department) {
        initial.courseType = 'general';
      }
    }
    setFilter(initial);
    void runQuery(false, initial);
    // Remounted whenever school, account, or incoming search conditions change.
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
    async (course: CatalogCourse) => {
      if (!isCurrent()) {
        Alert.alert('學校已切換', '目前選校已變更，請重新查詢後再加入課表。');
        return;
      }
      const draft = toPersonalCourseDraft(course);
      if (!draft.schedule.length) {
        Alert.alert('時間未定', '此課程未提供上課時段，無法直接加入課表。');
        return;
      }
      try {
        await schedule.addCourse({
          id: `catalog-${course.code}-${course.semester}`,
          code: course.code,
          name: course.name,
          instructor: course.teacher,
          credits: course.credits,
          semester: course.semester,
          schedule: draft.schedule,
          schoolId: school.id,
        });
        if (!isCurrent()) return;
        Alert.alert('已加入本機課程清單', course.name);
        analytics.logEvent?.('catalog_add_to_schedule', {
          code: course.code,
          schoolId: school.id,
        });
      } catch (err) {
        if (!isCurrent()) return;
        Alert.alert('加入失敗', err instanceof Error ? err.message : '請稍後再試');
      }
    },
    [schedule, school.id, isCurrent],
  );

  const applyFilter = (next: CatalogFilter) => {
    Keyboard.dismiss();
    setDraftFilter(null);
    const applied = { ...next };
    if (applied.keyword?.trim()) applied.keyword = applied.keyword.trim();
    else delete applied.keyword;
    setFilter(applied);
    setPendingKeyword(applied.keyword ?? '');
    setResult(null);
    void runQuery(true, applied);
  };
  const openFilter = () => {
    Keyboard.dismiss();
    setDraftFilter({ ...filter, keyword: pendingKeyword.trim() });
  };

  const fetchingPaused = !isPuEcampusDataFetchEnabled();
  const pausedResult = error === PU_ECAMPUS_DATA_PAUSED_MESSAGE;
  const currentSemLabel =
    buildCatalogSemesters().find((s) => s.code === filter.semester)?.label ??
    getCurrentCatalogSemester().label;

  // ─── 渲染 ──────────────────────────────────────────────

  const renderHeader = () => (
    <View style={{ paddingTop: 8, paddingBottom: 12, gap: 12 }}>
      {/* 搜尋列 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
        }}
      >
        <Ionicons name="search" size={18} color={theme.colors.muted} />
        <TextInput
          value={pendingKeyword}
          onChangeText={setPendingKeyword}
          placeholder={`搜尋 ${currentSemLabel} 課程、教師、代號`}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="search"
          accessibilityLabel="搜尋課程、教師或代號"
          onSubmitEditing={() => applyFilter({ ...filter, keyword: pendingKeyword.trim() })}
          style={{ flex: 1, minHeight: 48, color: theme.colors.text, fontSize: 14, padding: 0 }}
        />
        {pendingKeyword || filter.keyword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除搜尋關鍵字"
            onPress={() => {
              if (filter.keyword) applyFilter({ ...filter, keyword: '' });
              else setPendingKeyword('');
            }}
            style={iconControl}
          >
            <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="開啟篩選條件"
          onPress={openFilter}
          style={iconControl}
        >
          <Ionicons name="options-outline" size={20} color={theme.colors.accent} />
        </Pressable>
      </View>

      {/* 角色快捷 */}
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
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
              <ChoiceChip
                key={qa.id}
                label={qa.label}
                selected={active}
                onPress={() => applyFilter({ semester: filter.semester, ...qa.defaultFilter })}
              />
            );
          })}
        </View>
      </ScrollView>

      {/* 狀態列 */}
      {result && (!error || (pausedResult && result.source === 'cache')) ? (
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19 }}>
          {currentSemLabel} · {filter.keyword ? `「${filter.keyword}」 · ` : ''}{result.courses.length} 筆
          {result.source === 'cache' ? ` · 本機紀錄 ${formatDateTime(result.fetchedAt)}` : ''}
        </Text>
      ) : null}

      {pausedResult ? (
        <View
          style={{
            paddingTop: 12,
            gap: 6,
            borderTopWidth: hairline,
            borderTopColor: theme.colors.separator,
          }}
        >
          <Text accessibilityRole="header" style={{ color: theme.colors.text, fontWeight: '700' }}>
            校方課綱更新已暫停
          </Text>
          <Text style={{ color: theme.colors.textSecondary, lineHeight: 21 }}>
            {result?.source === 'cache'
              ? '下方是這台裝置先前儲存的課程資料。'
              : '這台裝置沒有儲存這組條件的課程資料。可以改用其他條件，或查看自己的課表。'}
          </Text>
          {result?.source !== 'cache' ? (
            <TextAction
              label="查看我的課表"
              onPress={() => {
                safeNavigate(props.navigation, 'PersonalTimetable');
              }}
            />
          ) : null}
        </View>
      ) : error ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Ionicons name="alert-circle" size={16} color={theme.colors.danger} style={{ marginTop: 2 }} />
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger, fontSize: 14, lineHeight: 20, flex: 1 }}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderOnboarding = () => (
    <View style={{ paddingVertical: 24, gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontWeight: '700', fontSize: 18 }}>
        靜宜大學 課綱查詢
      </Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
        即時查詢校方公開的「{currentSemLabel}」開課資料，包含選課代號、時間地點、選課人數與教師。
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
        試試上方搜尋框，或選一個快捷篩選 →
      </Text>
      <View style={{ marginTop: 8 }}>
        {[
          { label: '熱門：演算法', kw: '演算法' },
          { label: '熱門：經濟學', kw: '經濟學' },
          { label: '熱門：英文', kw: '英文' },
        ].map((s) => (
          <Pressable
            key={s.kw}
            accessibilityRole="button"
            onPress={() => applyFilter({ ...filter, keyword: s.kw })}
            style={{
              minHeight: 48,
              justifyContent: 'center',
              borderTopWidth: hairline,
              borderTopColor: theme.colors.separator,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 15, fontWeight: '600' }}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={{ paddingVertical: 24, gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>查無符合條件的課程</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 14, lineHeight: 21 }}>
        系統使用了你目前的篩選條件。試著放寬條件、改變學期，或檢查是否拼錯字。
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={openFilter}
        style={{
          marginTop: 8,
          alignSelf: 'flex-start',
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 18,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.accent,
        }}
      >
        <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>調整條件</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen
      title="課綱查詢"
      subtitle={`${roleConfig.zhName} · ${fetchingPaused ? '查詢本機留存的靜宜課綱' : '資料來自靜宜大學課綱查詢系統'}`}
      noPadding
    >
      <FlatList
        data={result?.courses ?? []}
        keyExtractor={(c, idx) => `${c.code}-${idx}`}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={renderHeader()}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 24,
          paddingTop: 4,
        }}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={{ marginTop: 10, color: theme.colors.muted, fontSize: 12 }}>
                {fetchingPaused ? '正在讀取本機課綱紀錄…' : '正在連線校方系統…'}
              </Text>
            </View>
          ) : error ? null : hasRunOnce ? (
            renderEmpty()
          ) : (
            renderOnboarding()
          )
        }
        onRefresh={() => runQuery(true)}
        refreshing={loading && (result?.courses?.length ?? 0) > 0}
        renderItem={({ item }) => {
          const added = schedule.courses.some((course) => course.id === `catalog-${item.code}-${item.semester}`);
          const conflicts = roleConfig.canAddToSchedule && !added
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
              added={added}
              onAdd={() => handleAddToSchedule(item)}
              onSyllabus={fetchingPaused ? undefined : () => {
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
        visible={draftFilter !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDraftFilter(null)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 16,
              borderBottomWidth: hairline,
              borderBottomColor: theme.colors.separator,
            }}
          >
            <Pressable accessibilityRole="button" onPress={() => setDraftFilter(null)} style={iconControl}>
              <Text style={{ color: theme.colors.accent, fontSize: 16 }}>取消</Text>
            </Pressable>
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
              完整查詢條件
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => draftFilter && applyFilter(draftFilter)}
              style={iconControl}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '700' }}>套用</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            {draftFilter ? (
              <FilterPanel
                filter={draftFilter}
                onChange={(patch) => setDraftFilter((draft) => draft && { ...draft, ...patch })}
                onReset={() => setDraftFilter(getDefaultCatalogFilter())}
              />
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

const iconControl = { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' } as const;

export default CourseCatalogScreen;
