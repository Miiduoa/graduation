/* eslint-disable */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CourseSpace } from '../data';
import { useAsyncList } from '../hooks/useAsyncList';
import { useDataSource } from '../hooks/useDataSource';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useSchedule } from '../state/schedule';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';
import { SegmentedControl, Spinner } from '../ui/components';
import { isTeachingRole } from '../utils/campusOs';
import { deriveScheduleDisplayDays } from '../utils/scheduleDisplayDays';
import { SmartCalendarPanel } from './unifiedCalendar/SmartCalendarPanel';
import {
  getAnyCachedCourses,
  getAnyCachedGrades,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  getAnyCachedTCAttendance,
  getAnyCachedTCGrades,
  getAnyCachedTCTodos,
  getCachedCourses,
  getCachedGrades,
  getCachedTCCourses,
  getCachedTCActivities,
  getCachedTCAttendance,
  getCachedTCTodos,
  refreshCourses,
  refreshGrades,
  refreshTCCourses,
  refreshTCActivitiesForCourses,
  refreshTCAttendance,
  refreshTCTodos,
  seedCachedTCGrades,
} from '../services/puDataCache';
import { getPUSession } from '../services/studentIdAuth';
import {
  tcFetchGrades,
  tcLogin,
  refreshTCBackendSession,
  setTCSavedCredentials,
  tcFetchCourseExams,
  tcFetchExamSubmissions,
  tcFetchScoreItems,
  tcBuildScoreUrl,
  type TCCourse,
  type TCActivity,
  type TCAttendance,
  type TCGradeItem,
  type TCExamInfo,
  type TCExamSubmission,
  type TCScoreItem,
} from '../services/tronClassClient';
import type { PUCourse, PUCourseResult, PUGrade, PUGradeResult } from '../services/puDirectScraper';
import { mergeDemoTronClassCoursesIfEmpty } from '../data/demoCoursesAdapter';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

// ─── Types ──────────────────────────────────────────────

type TabKey = 'schedule' | 'courses' | 'homework' | 'grades' | 'calendar';

const TAB_OPTIONS = [
  { key: 'schedule', label: '課表' },
  { key: 'courses', label: '課程' },
  { key: 'homework', label: '作業' },
  { key: 'grades', label: '成績' },
  { key: 'calendar', label: '行事曆' },
];

// ─── Schedule helpers（與統一行事曆課表分頁共用邏輯）─
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
const PERIODS = [
  { period: 1, time: '08:10-09:00' },
  { period: 2, time: '09:10-10:00' },
  { period: 3, time: '10:10-11:00' },
  { period: 4, time: '11:10-12:00' },
  { period: 5, time: '12:10-13:00' },
  { period: 6, time: '13:10-14:00' },
  { period: 7, time: '14:10-15:00' },
  { period: 8, time: '15:10-16:00' },
  { period: 9, time: '16:10-17:00' },
  { period: 10, time: '17:10-18:00' },
  { period: 11, time: '18:30-19:20' },
  { period: 12, time: '19:25-20:15' },
  { period: 13, time: '20:20-21:10' },
];
const COURSE_COLORS = [
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#EF4444',
  '#6366F1',
  '#14B8A6',
];

type CourseSlot = {
  id: string;
  name: string;
  teacher: string;
  location: string;
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  color: string;
  credits?: number;
};

function isTronClassCourse(course: TCCourse): boolean {
  return course.id > 0;
}

function parseNumericScore(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '').trim();
  if (!normalized) return null;
  const score = Number(normalized);
  return Number.isFinite(score) ? score : null;
}

function scoreToGradePoint(score: number): number {
  if (score >= 90) return 4.0;
  if (score >= 85) return 3.7;
  if (score >= 80) return 3.3;
  if (score >= 77) return 3.0;
  if (score >= 73) return 2.7;
  if (score >= 70) return 2.3;
  if (score >= 67) return 2.0;
  if (score >= 63) return 1.7;
  if (score >= 60) return 1.0;
  return 0.0;
}

function convertPUCoursesToTC(puCourses: PUCourse[], semester: string | null): TCCourse[] {
  return puCourses.map((course, index) => ({
    id: -(index + 1),
    name: course.name || course.nameEn || course.code || '未命名課程',
    course_code: course.code || `pu-${index + 1}`,
    department: null,
    instructors: course.teacherName ? [{ id: 0, name: course.teacherName }] : [],
    credit: typeof course.credits === 'number' ? course.credits : null,
    semester: semester ? { code: semester, id: 0, name: semester } : null,
    klass: course.classOffered ? { id: 0, name: course.classOffered } : null,
    grade: null,
    course_outline: null,
    start_date: null,
    end_date: null,
    status: 'ongoing',
    role: 'student',
    student_count: 0,
    classroom_schedule: course.timePlaceRaw || course.location || null,
  }));
}

function convertPUGradesToTC(puGrades: PUGrade[]): TCGradeItem[] {
  return puGrades.map((grade, index) => {
    const score = parseNumericScore(grade.score);
    return {
      course_id: -(index + 1),
      course_name: grade.courseName || grade.courseNameEn || '未命名課程',
      final_score: score,
      final_grade: null,
      grade_point: score == null ? null : scoreToGradePoint(score),
      credits: typeof grade.credits === 'number' ? grade.credits : 0,
      semester: grade.semester || '',
    };
  });
}

function formatCourseSchedule(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

async function readCachedPUFallbackData(): Promise<{
  courses: TCCourse[];
  grades: TCGradeItem[];
}> {
  const [cachedCourses, cachedGrades] = await Promise.all([
    getCachedCourses().then((data) => data ?? getAnyCachedCourses()),
    getCachedGrades().then((data) => data ?? getAnyCachedGrades()),
  ]);

  return {
    courses: cachedCourses?.courses?.length
      ? convertPUCoursesToTC(cachedCourses.courses, cachedCourses.semester)
      : [],
    grades: cachedGrades?.grades?.length ? convertPUGradesToTC(cachedGrades.grades) : [],
  };
}

async function refreshPUFallbackData(): Promise<{
  courses: TCCourse[];
  grades: TCGradeItem[];
}> {
  const session = getPUSession();
  if (!session) return readCachedPUFallbackData();

  const [courseData, gradeData] = await Promise.all([
    refreshCourses(session).catch(() => null as PUCourseResult | null),
    refreshGrades(session).catch(() => null as PUGradeResult | null),
  ]);
  const cachedFallback =
    !courseData?.courses?.length || !gradeData?.grades?.length
      ? await readCachedPUFallbackData()
      : { courses: [], grades: [] };

  return {
    courses: courseData?.courses?.length
      ? convertPUCoursesToTC(courseData.courses, courseData.semester)
      : cachedFallback.courses,
    grades: gradeData?.grades?.length
      ? convertPUGradesToTC(gradeData.grades)
      : cachedFallback.grades,
  };
}

function timeToperiod(t: string): number {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m;
  for (let i = 0; i < PERIODS.length; i++) {
    const [s] = PERIODS[i].time.split('-');
    const [sh, sm] = s.split(':').map(Number);
    if (Math.abs(total - (sh * 60 + sm)) < 30) return i + 1;
  }
  if (total < 490) return 1;
  if (total > 1260) return 13;
  return Math.floor((total - 480) / 60) + 1;
}

function getCurrentPeriod(): number {
  const now = new Date();
  const time = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < PERIODS.length; i++) {
    const [s] = PERIODS[i].time.split('-');
    const [sh, sm] = s.split(':').map(Number);
    const start = sh * 60 + sm;
    if (time >= start && time < start + 60) return i + 1;
  }
  return 0;
}

// ─── TronClass login section ─────────────────────────────

function TCLoginSection(props: { onSuccess: () => void; profile: any }) {
  const [show, setShow] = useState(false);
  const [account, setAccount] = useState((props.profile as any)?.loginAccount || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    if (!account.trim() || !password) {
      Alert.alert('提示', '請輸入帳號和密碼');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let success = false;
      try {
        const r = await tcLogin(account.trim(), password);
        if (r.success) success = true;
      } catch {}
      if (!success) {
        try {
          const r = await refreshTCBackendSession(account.trim(), password);
          if (r.success) success = true;
        } catch {}
      }
      if (success) {
        await setTCSavedCredentials(account.trim(), password);
        setShow(false);
        setAccount('');
        setPassword('');
        setError(null);
        props.onSuccess();
      } else {
        setError('登入失敗，請檢查帳號密碼');
      }
    } catch {
      setError('連線失敗，請檢查網路');
    } finally {
      setLoading(false);
    }
  }, [account, password, props]);

  if (!show) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 30, gap: 14 }}>
        <Ionicons
          name="school-outline"
          size={44}
          color={theme.colors.accent}
          style={{ opacity: 0.5 }}
        />
        <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
          尚未連線校園系統
        </Text>
        <Text
          style={{ color: theme.colors.muted, textAlign: 'center', lineHeight: 20, fontSize: 13 }}
        >
          連線後即可查看課程、作業、成績等資料
        </Text>
        <Pressable
          onPress={() => setShow(true)}
          style={({ pressed }) => ({
            paddingHorizontal: 28,
            paddingVertical: 12,
            borderRadius: 22,
            backgroundColor: theme.colors.accent,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>連線校園系統</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{
        padding: 16,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 12,
      }}
    >
      <Text style={{ fontWeight: '700', fontSize: 15, color: theme.colors.text }}>
        連線校園系統
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>請輸入 E校園 帳號密碼</Text>
      <TextInput
        placeholder="E校園帳號"
        placeholderTextColor={theme.colors.muted}
        value={account}
        onChangeText={setAccount}
        editable={!loading}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: theme.colors.text,
          backgroundColor: theme.colors.bg,
        }}
      />
      <TextInput
        placeholder="密碼"
        placeholderTextColor={theme.colors.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!loading}
        autoCapitalize="none"
        style={{
          borderWidth: 1,
          borderColor: error ? '#DC2626' : theme.colors.border,
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: theme.colors.text,
          backgroundColor: theme.colors.bg,
        }}
      />
      {error ? <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
        <Pressable
          onPress={() => {
            setShow(false);
            setError(null);
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 15, paddingVertical: 8 }}>取消</Text>
        </Pressable>
        <Pressable
          onPress={handleLogin}
          disabled={loading}
          style={({ pressed }) => ({
            paddingHorizontal: 24,
            paddingVertical: 10,
            borderRadius: 20,
            backgroundColor: theme.colors.accent,
            opacity: pressed || loading ? 0.7 : 1,
          })}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>連線</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ─── Course Tools Section ────────────────────────────────
// 選課工具：低頻使用，只在「課表」tab 內出現。
// 包含：課綱查詢 / AI 選課助理 / 學分檢核

function CourseToolsSection(props: { nav: any; variant: 'compact' | 'empty' }) {
  const tools = [
    {
      id: 'catalog',
      title: '課綱查詢',
      subtitle: '全校課程搜尋',
      icon: 'library-outline' as const,
      color: '#3B82F6',
      onPress: () => props.nav?.navigate?.('CourseCatalog'),
    },
    {
      id: 'advisor',
      title: 'AI 選課助理',
      subtitle: '依你的資料推薦',
      icon: 'sparkles-outline' as const,
      color: '#FF6B9A',
      onPress: () => props.nav?.navigate?.('AICourseAdvisor'),
    },
    {
      id: 'credit',
      title: '學分檢核',
      subtitle: '畢業進度',
      icon: 'calculator-outline' as const,
      color: theme.colors.accent,
      onPress: () => props.nav?.navigate?.('CreditAuditStack'),
    },
  ];

  return (
    <View
      style={{
        marginTop: props.variant === 'compact' ? 20 : 12,
        gap: 10,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
            選課工具
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            學期初/末查課、找替代方案、評估畢業進度
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {tools.map((t) => (
          <Pressable
            key={t.id}
            onPress={t.onPress}
            style={({ pressed }) => ({
              flex: 1,
              padding: 12,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
              gap: 8,
              minHeight: 96,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: `${t.color}1A`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={t.icon} size={18} color={t.color} />
            </View>
            <Text
              style={{
                color: theme.colors.text,
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              {t.title}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 14 }}>
              {t.subtitle}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Mini Schedule View ──────────────────────────────────

function MiniScheduleView(props: {
  courses: CourseSlot[];
  onCoursePress: (c: CourseSlot) => void;
}) {
  const today = new Date().getDay();
  const currentPeriod = getCurrentPeriod();
  const displayDays = deriveScheduleDisplayDays(props.courses);
  const displayPeriods = PERIODS.slice(0, 10);

  return (
    <View style={{ gap: 12 }}>
      {/* 今日提醒 */}
      {(() => {
        const todayCourses = props.courses
          .filter((c) => c.dayOfWeek === today)
          .sort((a, b) => a.startPeriod - b.startPeriod);
        const next = todayCourses.find((c) => c.startPeriod > currentPeriod);
        if (!next) return null;
        return (
          <Pressable
            onPress={() => props.onCoursePress(next)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 14,
              borderRadius: 14,
              backgroundColor: `${next.color}12`,
              borderWidth: 1,
              borderColor: `${next.color}30`,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: next.color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
                {next.startPeriod}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
                下一堂：{next.name}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                {next.location} · {next.teacher} ·{' '}
                {PERIODS[next.startPeriod - 1]?.time.split('-')[0]}
              </Text>
            </View>
          </Pressable>
        );
      })()}

      {/* 統計 */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          {
            label: '課程數',
            value: new Set(props.courses.map((c) => c.name)).size,
            color: theme.colors.accent,
          },
          {
            label: '總學分',
            value: props.courses.reduce((s, c) => s + (c.credits ?? 0), 0),
            color: theme.colors.success,
          },
          {
            label: '今日',
            value: props.courses.filter((c) => c.dayOfWeek === today).length,
            color: '#F59E0B',
          },
        ].map((s) => (
          <View
            key={s.label}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: s.color, fontWeight: '900', fontSize: 22 }}>{s.value}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 週課表 grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 44, height: 36, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>節次</Text>
            </View>
            {displayDays.map((day) => (
              <View
                key={day}
                style={{
                  width: 60,
                  height: 36,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: day === today ? theme.colors.accentSoft : 'transparent',
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    color: day === today ? theme.colors.accent : theme.colors.text,
                    fontWeight: day === today ? '700' : '500',
                    fontSize: 13,
                  }}
                >
                  {WEEKDAYS_SHORT[day]}
                </Text>
              </View>
            ))}
          </View>
          {displayPeriods.map((p) => (
            <View key={p.period} style={{ flexDirection: 'row', height: 46 }}>
              <View
                style={{
                  width: 44,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor:
                    p.period === currentPeriod ? `${theme.colors.accent}20` : 'transparent',
                  borderRadius: 6,
                }}
              >
                <Text
                  style={{
                    color: p.period === currentPeriod ? theme.colors.accent : theme.colors.muted,
                    fontSize: 11,
                    fontWeight: p.period === currentPeriod ? '700' : '500',
                  }}
                >
                  {p.period}
                </Text>
              </View>
              {displayDays.map((day) => {
                const course = props.courses.find(
                  (c) =>
                    c.dayOfWeek === day && p.period >= c.startPeriod && p.period <= c.endPeriod,
                );
                const isStart = course?.startPeriod === p.period;
                if (course && isStart) {
                  const height = (course.endPeriod - course.startPeriod + 1) * 46 - 4;
                  return (
                    <Pressable
                      key={`${day}-${p.period}`}
                      onPress={() => props.onCoursePress(course)}
                      style={{
                        width: 58,
                        height,
                        marginHorizontal: 1,
                        padding: 3,
                        borderRadius: 6,
                        backgroundColor: course.color,
                        overflow: 'hidden',
                      }}
                    >
                      <Text
                        style={{ color: '#fff', fontWeight: '700', fontSize: 9 }}
                        numberOfLines={2}
                      >
                        {course.name}
                      </Text>
                      <Text
                        style={{ color: 'rgba(255,255,255,0.8)', fontSize: 8, marginTop: 1 }}
                        numberOfLines={1}
                      >
                        {course.location}
                      </Text>
                    </Pressable>
                  );
                } else if (course) {
                  return <View key={`${day}-${p.period}`} style={{ width: 60 }} />;
                }
                return (
                  <View
                    key={`${day}-${p.period}`}
                    style={{
                      width: 58,
                      height: 42,
                      marginHorizontal: 1,
                      marginVertical: 2,
                      borderRadius: 6,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderStyle: 'dashed',
                    }}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Shared: 課程卡 chip ────────────────────────────────

function CourseChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: `${props.color}14`,
        borderWidth: 1,
        borderColor: `${props.color}22`,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={props.icon} size={12} color={props.color} />
      <Text style={{ color: props.color, fontSize: 11, fontWeight: '700' }}>{props.label}</Text>
    </Pressable>
  );
}

// ─── 本週需注意（Risk + 待繳 + 待測驗）橫條 ────────────────

// ── 駕駛艙 + What-if + 錯題本 一排捷徑（差異化亮點，TronClass 沒有） ──
function CockpitQuickRow(props: { nav: any; roleGroup?: string | null }) {
  const studentItems = [
    { route: 'TodayCockpit', emoji: '🚀', label: '今日駕駛艙', color: '#1F4E78' },
    { route: 'GradeWhatIf', emoji: '📊', label: '成績試算', color: '#7C3AED' },
    { route: 'MistakeRepertoire', emoji: '🧠', label: '錯題本', color: '#EC4899' },
  ];
  const teacherItems = [
    { route: 'TodayCockpit', emoji: '🚀', label: '今日總覽', color: '#1F4E78' },
    { route: 'TeacherCockpit', emoji: '👨‍🏫', label: '教師駕駛艙', color: '#0EA5E9' },
    { route: 'GradeWhatIf', emoji: '📊', label: '成績試算', color: '#7C3AED' },
  ];
  const isTeacher = props.roleGroup === 'teacher' || props.roleGroup === 'staff' || props.roleGroup === 'admin';
  const items = isTeacher ? teacherItems : studentItems;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        marginHorizontal: 16,
        marginTop: 12,
      }}
    >
      {items.map((it) => (
        <Pressable
          key={it.route}
          onPress={() => props.nav?.navigate?.(it.route)}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: 'center',
            backgroundColor: `${it.color}14`,
            borderWidth: 1,
            borderColor: `${it.color}33`,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 24 }}>{it.emoji}</Text>
          <Text style={{ color: it.color, fontSize: 11, fontWeight: '700', marginTop: 4 }}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function WeeklyFocusBanner(props: {
  courses: TCCourse[];
  todos: TCActivity[];
  nav: any;
}) {
  const todoByCourse = new Map<number, TCActivity[]>();
  for (const t of props.todos) {
    const arr = todoByCourse.get(t.course_id) ?? [];
    arr.push(t);
    todoByCourse.set(t.course_id, arr);
  }
  // 找出待辦最多的課（如果有）
  let mostUrgentCourse: TCCourse | null = null;
  let maxTodos = 0;
  for (const c of props.courses) {
    const n = todoByCourse.get(c.id)?.length ?? 0;
    if (n > maxTodos) {
      maxTodos = n;
      mostUrgentCourse = c;
    }
  }

  if (!mostUrgentCourse && props.todos.length === 0) {
    return (
      <Pressable
        onPress={() => props.nav?.navigate?.('Companion')}
        style={{
          marginHorizontal: 16,
          marginVertical: 12,
          padding: 14,
          borderRadius: 14,
          backgroundColor: '#1F4E7814',
          borderWidth: 1,
          borderColor: '#1F4E7822',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 28 }}>🌱</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#1F4E78', fontSize: 14, fontWeight: '700' }}>
            這週課業很平穩 ✨
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            點開校園精靈，看牠長到哪了
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#1F4E78" />
      </Pressable>
    );
  }

  const totalUrgent = props.todos.length;
  return (
    <Pressable
      onPress={() => props.nav?.navigate?.('LearningAnalytics')}
      style={{
        marginHorizontal: 16,
        marginVertical: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: totalUrgent > 3 ? '#DC262614' : '#F59E0B14',
        borderWidth: 1,
        borderColor: totalUrgent > 3 ? '#DC262622' : '#F59E0B22',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 28 }}>{totalUrgent > 3 ? '🔥' : '⚠️'}</Text>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: totalUrgent > 3 ? '#991B1B' : '#92400E',
            fontSize: 14,
            fontWeight: '700',
          }}
        >
          本週需注意：{totalUrgent} 件待辦
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          壓力最大的是「{mostUrgentCourse?.name ?? props.todos[0]?.title}」• 點開學習風險雷達
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={totalUrgent > 3 ? '#991B1B' : '#92400E'} />
    </Pressable>
  );
}

// ─── Course List Tab ─────────────────────────────────────

function CourseListView(props: { courses: TCCourse[]; nav: any; onRefresh: () => void }) {
  if (props.courses.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
        <Ionicons
          name="book-outline"
          size={40}
          color={theme.colors.muted}
          style={{ opacity: 0.5 }}
        />
        <Text style={{ color: theme.colors.muted, fontSize: 14 }}>尚無課程資料</Text>
        <Pressable
          onPress={props.onRefresh}
          style={({ pressed }) => ({
            paddingHorizontal: 20,
            paddingVertical: 8,
            borderRadius: 16,
            backgroundColor: theme.colors.accent,
            opacity: pressed ? 0.8 : 1,
            marginTop: 6,
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>重新載入</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {props.courses.map((course, idx) => {
        const instructor = course.instructors?.[0]?.name ?? '未知';
        const semester = course.semester?.name ?? '';
        const fromTronClass = isTronClassCourse(course);
        const scheduleText = formatCourseSchedule(course.classroom_schedule);
        return (
          <Pressable
            key={course.id}
            onPress={() => {
              if (fromTronClass) {
                props.nav?.navigate?.('CourseHub', {
                  groupId: String(course.id),
                  groupName: course.name,
                });
              } else {
                props.nav?.navigate?.('CourseSchedule');
              }
            }}
            style={({ pressed }) => ({
              padding: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderLeftWidth: 4,
              borderLeftColor: COURSE_COLORS[idx % COURSE_COLORS.length],
              opacity: pressed ? 0.8 : 1,
              gap: 6,
            })}
          >
            <Text
              style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}
              numberOfLines={2}
            >
              {course.name}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="person-outline" size={12} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{instructor}</Text>
              </View>
              {course.credit != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="school-outline" size={12} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    {course.credit} 學分
                  </Text>
                </View>
              )}
              {semester ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="calendar-outline" size={12} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{semester}</Text>
                </View>
              ) : null}
              {!fromTronClass ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="cloud-offline-outline" size={12} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>E 校園</Text>
                </View>
              ) : null}
            </View>
            {fromTronClass ? (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <CourseChip
                  icon="albums-outline"
                  label="教材"
                  color="#2563EB"
                  onPress={() =>
                    props.nav?.navigate?.('CourseModules', {
                      groupId: String(course.id),
                      groupName: course.name,
                    })
                  }
                />
                <CourseChip
                  icon="help-circle-outline"
                  label="測驗"
                  color={theme.colors.info}
                  onPress={() =>
                    props.nav?.navigate?.('QuizCenter', {
                      groupId: String(course.id),
                      groupName: course.name,
                    })
                  }
                />
                <CourseChip
                  icon="stats-chart-outline"
                  label="成績"
                  color="#0EA5E9"
                  onPress={() =>
                    props.nav?.navigate?.('CourseScores', {
                      groupId: String(course.id),
                      groupName: course.name,
                    })
                  }
                />
                <CourseChip
                  icon="checkmark-circle-outline"
                  label="點名"
                  color="#10B981"
                  onPress={() =>
                    props.nav?.navigate?.('AttendanceMultiMethod', {
                      courseId: String(course.id),
                      sessionId: `demo-${course.id}`,
                    })
                  }
                />
                <CourseChip
                  icon="chatbubbles-outline"
                  label="討論"
                  color="#8B5CF6"
                  onPress={() =>
                    props.nav?.navigate?.('CourseDiscussion', {
                      groupId: String(course.id),
                      groupName: course.name,
                    })
                  }
                />
                <CourseChip
                  icon="sparkles-outline"
                  label="AI 學伴"
                  color="#F59E0B"
                  onPress={() =>
                    props.nav?.navigate?.('AICourseAdvisor', {
                      groupId: String(course.id),
                      groupName: course.name,
                    })
                  }
                />
                <CourseChip
                  icon="create-outline"
                  label="筆記"
                  color="#06B6D4"
                  onPress={() =>
                    props.nav?.navigate?.('CourseNotes', {
                      courseId: String(course.id),
                      courseName: course.name,
                    })
                  }
                />
                <CourseChip
                  icon="people-outline"
                  label="互評"
                  color="#EC4899"
                  onPress={() =>
                    props.nav?.navigate?.('PeerReviewSubmit', {
                      courseId: String(course.id),
                      assignmentTitle: `${course.name} 同儕互評`,
                    })
                  }
                />
              </View>
            ) : scheduleText ? (
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                {scheduleText}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Homework Tab ────────────────────────────────────────

function HomeworkView(props: {
  activities: Record<number, TCActivity[]>;
  courses: TCCourse[];
  todos: TCActivity[];
  nav: any;
}) {
  // Flatten all homework-type activities across courses
  const allHomework = useMemo(() => {
    const items: Array<TCActivity & { courseName: string }> = [];

    // From activities (per-course)
    for (const course of props.courses) {
      const acts = props.activities[course.id] ?? [];
      for (const a of acts) {
        if (a.type === 'homework' || a.type === 'assignment' || a.type === 'offline_homework') {
          items.push({ ...a, courseName: course.name });
        }
      }
    }

    // From todos (cross-course)
    for (const todo of props.todos) {
      if (!items.some((i) => i.id === todo.id)) {
        const course = props.courses.find((c) => c.id === todo.course_id);
        items.push({ ...todo, courseName: course?.name ?? '未知課程' });
      }
    }

    // Sort by end_time (due date) desc, null at end
    items.sort((a, b) => {
      if (!a.end_time && !b.end_time) return 0;
      if (!a.end_time) return 1;
      if (!b.end_time) return -1;
      return new Date(b.end_time).getTime() - new Date(a.end_time).getTime();
    });

    return items;
  }, [props.activities, props.courses, props.todos]);

  if (allHomework.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
        <Ionicons
          name="document-text-outline"
          size={40}
          color={theme.colors.muted}
          style={{ opacity: 0.5 }}
        />
        <Text style={{ color: theme.colors.muted, fontSize: 14 }}>目前沒有作業</Text>
      </View>
    );
  }

  const now = new Date();

  // Split into pending/upcoming and past
  const pending = allHomework.filter((h) => {
    if (!h.end_time) return true;
    return new Date(h.end_time).getTime() > now.getTime() - 24 * 60 * 60 * 1000;
  });
  const past = allHomework.filter((h) => {
    if (!h.end_time) return false;
    return new Date(h.end_time).getTime() <= now.getTime() - 24 * 60 * 60 * 1000;
  });

  const renderItem = (item: (typeof allHomework)[number]) => {
    const isOverdue = item.end_time && new Date(item.end_time) < now;
    const isSubmitted = item.status === 'submitted' || item.status === 'graded';
    const isGraded = item.status === 'graded';
    const dueDate = item.end_time ? new Date(item.end_time) : null;

    let statusColor = theme.colors.muted;
    let statusText = '待處理';
    let statusIcon: keyof typeof Ionicons.glyphMap = 'time-outline';

    if (isGraded) {
      statusColor = theme.colors.success;
      statusText = item.score != null ? `${item.score}/${item.total_score ?? 100}` : '已批改';
      statusIcon = 'checkmark-circle';
    } else if (isSubmitted) {
      statusColor = '#2563EB';
      statusText = '已繳交';
      statusIcon = 'checkmark-done-outline';
    } else if (isOverdue) {
      statusColor = '#DC2626';
      statusText = '已逾期';
      statusIcon = 'alert-circle';
    } else if (dueDate) {
      const diffHours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        statusColor = '#F59E0B';
        statusText = `${Math.max(0, Math.floor(diffHours))} 小時後截止`;
        statusIcon = 'warning-outline';
      } else if (diffHours < 72) {
        statusColor = '#F59E0B';
        statusText = `${Math.floor(diffHours / 24)} 天後截止`;
        statusIcon = 'time-outline';
      } else {
        statusText = `${Math.floor(diffHours / 24)} 天後截止`;
      }
    }

    return (
      <Pressable
        key={`${item.course_id}-${item.id}`}
        onPress={() =>
          isSubmitted
            ? props.nav?.navigate?.('CourseModules', {
                groupId: String(item.course_id),
                groupName: item.courseName,
              })
            : props.nav?.navigate?.('HomeworkSubmit', {
                courseId: String(item.course_id),
                hwId: String(item.id),
                hwTitle: item.title,
                dueAt: item.end_time ?? undefined,
                description: item.description,
              })
        }
        style={({ pressed }) => ({
          padding: 14,
          borderRadius: 14,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: isOverdue && !isSubmitted ? '#DC262630' : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
          gap: 8,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: `${statusColor}14`,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 2,
            }}
          >
            <Ionicons name={statusIcon} size={18} color={statusColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              {item.courseName}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: statusColor, fontWeight: '700', fontSize: 12 }}>
              {statusText}
            </Text>
            {dueDate && (
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                {dueDate.getMonth() + 1}/{dueDate.getDate()}{' '}
                {String(dueDate.getHours()).padStart(2, '0')}:
                {String(dueDate.getMinutes()).padStart(2, '0')}
              </Text>
            )}
          </View>
        </View>
        {item.weight != null && item.weight > 0 && (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginLeft: 46 }}>
            佔總成績 {item.weight}%
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: 14 }}>
      {pending.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
            待完成 ({pending.length})
          </Text>
          {pending.map(renderItem)}
        </View>
      )}
      {past.length > 0 && (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Text style={{ color: theme.colors.muted, fontWeight: '700', fontSize: 14 }}>
            已過期 ({past.length})
          </Text>
          {past.slice(0, 10).map(renderItem)}
          {past.length > 10 && (
            <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: 'center' }}>
              還有 {past.length - 10} 項...
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Grades Tab ──────────────────────────────────────────

type ExamScoreRow = TCExamInfo & {
  submission?: TCExamSubmission | null;
  courseName: string;
  courseId: number;
  percentage: number;
};
type CourseScoreSummary = {
  courseId: number;
  courseName: string;
  scoreItems: TCScoreItem[];
  examRows: ExamScoreRow[];
  estimatedFinal: number | null;
};

function GradesView(props: {
  grades: TCGradeItem[];
  attendance: TCAttendance[];
  courses: TCCourse[];
}) {
  const [examScores, setExamScores] = useState<ExamScoreRow[]>([]);
  const [courseSummaries, setCourseSummaries] = useState<CourseScoreSummary[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const tronClassCourses = useMemo(() => props.courses.filter(isTronClassCourse), [props.courses]);

  // 載入各門課的小考/測驗分數 + score-items 百分比
  useEffect(() => {
    if (tronClassCourses.length === 0) {
      setExamScores([]);
      setCourseSummaries([]);
      setLoadingExams(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingExams(true);
      try {
        const allRows: ExamScoreRow[] = [];
        const summaries: CourseScoreSummary[] = [];

        for (const course of tronClassCourses) {
          try {
            const [exams, scoreItems] = await Promise.all([
              tcFetchCourseExams(course.id).catch(() => [] as TCExamInfo[]),
              tcFetchScoreItems(course.id).catch(() => [] as TCScoreItem[]),
            ]);

            const courseExamRows: ExamScoreRow[] = [];
            for (const exam of exams) {
              try {
                const sub = await tcFetchExamSubmissions(exam.id);
                // 找到對應 score-item 的 percentage
                const si = scoreItems.find(
                  (s) => s.name === exam.title || (s as any).referrer_id === exam.id,
                );
                const pct = si?.percentage ?? 0;
                const row: ExamScoreRow = {
                  ...exam,
                  submission: sub,
                  courseName: course.name,
                  courseId: course.id,
                  percentage: pct,
                };
                if (sub && typeof sub.exam_score === 'number') {
                  courseExamRows.push(row);
                  allRows.push(row);
                }
              } catch {}
            }

            // 計算最終成績估算
            let estimatedFinal: number | null = null;
            const allScored = courseExamRows.filter(
              (e) => typeof e.submission?.exam_score === 'number',
            );
            if (allScored.length > 0) {
              // 檢查是否有設定百分比權重
              const hasWeights = allScored.some((e) => e.percentage > 0);
              if (hasWeights) {
                // 加權計算：按百分比權重
                const weighted = allScored.filter((e) => e.percentage > 0);
                const totalPct = weighted.reduce((s, e) => s + e.percentage, 0);
                const weightedSum = weighted.reduce(
                  (s, e) => s + (e.submission?.exam_score ?? 0) * e.percentage,
                  0,
                );
                estimatedFinal =
                  totalPct > 0 ? Math.round((weightedSum / totalPct) * 10) / 10 : null;
              } else {
                // 無權重：計算簡單平均
                const totalScore = allScored.reduce(
                  (s, e) => s + (e.submission?.exam_score ?? 0),
                  0,
                );
                estimatedFinal = Math.round((totalScore / allScored.length) * 10) / 10;
              }
            }

            if (courseExamRows.length > 0) {
              summaries.push({
                courseId: course.id,
                courseName: course.name,
                scoreItems,
                examRows: courseExamRows,
                estimatedFinal,
              });
            }
          } catch {}
        }
        if (!cancelled) {
          setExamScores(allRows);
          setCourseSummaries(summaries);
        }
      } finally {
        if (!cancelled) setLoadingExams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tronClassCourses]);

  const totalCredits = props.grades.reduce((s, g) => s + (g.credits ?? 0), 0);
  const gpa =
    props.grades.length > 0
      ? props.grades.reduce((s, g) => s + (g.grade_point ?? 0) * (g.credits ?? 0), 0) /
        Math.max(totalCredits, 1)
      : null;

  // 按課程分組考試分數（必須在所有 early return 之前呼叫 useMemo）
  const examsByCourse = useMemo(() => {
    const map: Record<number, ExamScoreRow[]> = {};
    for (const e of examScores) {
      if (!map[e.courseId]) map[e.courseId] = [];
      map[e.courseId].push(e);
    }
    return map;
  }, [examScores]);

  if (
    props.grades.length === 0 &&
    props.attendance.length === 0 &&
    examScores.length === 0 &&
    !loadingExams
  ) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
        <Ionicons
          name="stats-chart-outline"
          size={40}
          color={theme.colors.muted}
          style={{ opacity: 0.5 }}
        />
        <Text style={{ color: theme.colors.muted, fontSize: 14 }}>尚無成績資料</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {/* GPA summary */}
      {gpa != null && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '900', fontSize: 24 }}>
              {gpa.toFixed(2)}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>GPA</Text>
          </View>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.success, fontWeight: '900', fontSize: 24 }}>
              {totalCredits}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已修學分</Text>
          </View>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 24 }}>
              {props.grades.length}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>科目數</Text>
          </View>
        </View>
      )}

      {/* TronClass 小考/測驗分數 + 加權成績 */}
      {(courseSummaries.length > 0 || loadingExams) && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
            小考 / 測驗成績
          </Text>
          {loadingExams && courseSummaries.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }}>
                載入測驗成績中...
              </Text>
            </View>
          )}
          {courseSummaries.map((cs) => {
            const finalColor =
              cs.estimatedFinal != null
                ? cs.estimatedFinal >= 80
                  ? theme.colors.success
                  : cs.estimatedFinal >= 60
                    ? '#F59E0B'
                    : '#DC2626'
                : theme.colors.muted;
            return (
              <View
                key={`course-exams-${cs.courseId}`}
                style={{
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  gap: 10,
                }}
              >
                {/* 課程標題 + 預估成績 */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}
                    numberOfLines={1}
                  >
                    {cs.courseName}
                  </Text>
                  <Pressable
                    onPress={() =>
                      void linkingOpenWithPuTronClassGate(tcBuildScoreUrl(cs.courseId))
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="open-outline" size={14} color={theme.colors.accent} />
                  </Pressable>
                </View>

                {/* 預估成績 */}
                {cs.estimatedFinal != null && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: `${finalColor}10`,
                      borderWidth: 1,
                      borderColor: `${finalColor}30`,
                    }}
                  >
                    <View>
                      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                        {cs.examRows.some((e) => e.percentage > 0) ? '加權預估成績' : '平均分數'}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                        {cs.examRows.length} 項測驗
                      </Text>
                    </View>
                    <Text style={{ color: finalColor, fontWeight: '900', fontSize: 22 }}>
                      {cs.estimatedFinal}
                    </Text>
                  </View>
                )}

                {/* 各項分數 */}
                {cs.examRows.map((exam) => {
                  const score = exam.submission?.exam_score ?? 0;
                  const scoreColor =
                    score >= 80 ? theme.colors.success : score >= 60 ? '#F59E0B' : '#DC2626';
                  return (
                    <View
                      key={exam.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 4,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Ionicons name="checkbox-outline" size={14} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>
                          {exam.title}
                        </Text>
                        {exam.percentage > 0 && (
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                            ({exam.percentage}%)
                          </Text>
                        )}
                      </View>
                      <Text style={{ color: scoreColor, fontWeight: '700', fontSize: 16 }}>
                        {score}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}

      {/* Grade list */}
      {props.grades.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
            成績列表
          </Text>
          {props.grades.map((g, idx) => {
            const scoreColor =
              (g.final_score ?? 0) >= 80
                ? theme.colors.success
                : (g.final_score ?? 0) >= 60
                  ? '#F59E0B'
                  : '#DC2626';
            return (
              <View
                key={`${g.course_id}-${idx}`}
                style={{
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}
                    numberOfLines={1}
                  >
                    {g.course_name}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {g.semester} · {g.credits} 學分
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {g.final_score != null && (
                    <Text style={{ color: scoreColor, fontWeight: '900', fontSize: 20 }}>
                      {g.final_score}
                    </Text>
                  )}
                  {g.final_grade && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{g.final_grade}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Attendance */}
      {props.attendance.length > 0 && (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
            出勤記錄
          </Text>
          {props.attendance.map((a, idx) => (
            <View
              key={`att-${idx}`}
              style={{
                padding: 14,
                borderRadius: 14,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                gap: 6,
              }}
            >
              <Text
                style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}
                numberOfLines={1}
              >
                {a.course_name}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={{ color: theme.colors.success, fontSize: 12 }}>出席 {a.attended}</Text>
                <Text style={{ color: '#DC2626', fontSize: 12 }}>缺席 {a.absent}</Text>
                <Text style={{ color: '#F59E0B', fontSize: 12 }}>遲到 {a.late}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>請假 {a.leave}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: theme.colors.surface2,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${a.rate}%`,
                      height: '100%',
                      borderRadius: 2,
                      backgroundColor:
                        a.rate >= 80 ? theme.colors.success : a.rate >= 60 ? '#F59E0B' : '#DC2626',
                    }}
                  />
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '600' }}>
                  {a.rate}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────

export function CoursesHomeScreen(props: any) {
  const nav = props?.navigation;
  const initialTab = (props?.route?.params?.initialTab as TabKey) ?? 'schedule';
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const schedule = useSchedule();

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [refreshing, setRefreshing] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  // TronClass data
  const [tcCourses, setTcCourses] = useState<TCCourse[]>([]);
  const [tcActivities, setTcActivities] = useState<Record<number, TCActivity[]>>({});
  const [tcAttendance, setTcAttendance] = useState<TCAttendance[]>([]);
  const [tcTodos, setTcTodos] = useState<TCActivity[]>([]);
  const [tcGrades, setTcGrades] = useState<TCGradeItem[]>([]);

  const applyPUFallback = useCallback(async () => {
    const fallback = await refreshPUFallbackData();
    setTcCourses((current) => {
      const base = current.some(isTronClassCourse) ? current : fallback.courses;
      return mergeDemoTronClassCoursesIfEmpty(base);
    });
    if (fallback.grades.length > 0) {
      setTcGrades((current) =>
        current.some((grade) => grade.course_id > 0) ? current : fallback.grades,
      );
    }
  }, []);

  // Load all cached data on mount — stale-while-revalidate
  const loadAllData = useCallback(async () => {
    setDataLoading(true);
    try {
      // 1. 先用 getAnyCached*（不管 TTL）立即顯示
      const [courses, activities, attendance, todos, cachedGrades, puFallback] = await Promise.all([
        getAnyCachedTCCourses(),
        getAnyCachedTCActivities(),
        getAnyCachedTCAttendance(),
        getAnyCachedTCTodos(),
        getAnyCachedTCGrades(),
        readCachedPUFallbackData().catch(() => ({ courses: [], grades: [] })),
      ]);
      const rawCourses =
        courses?.length ? courses : puFallback.courses.length > 0 ? puFallback.courses : [];
      setTcCourses(mergeDemoTronClassCoursesIfEmpty(rawCourses));
      if (activities) setTcActivities(activities);
      if (attendance) setTcAttendance(attendance);
      if (todos) setTcTodos(todos);
      const tcCachedGrades = Array.isArray(cachedGrades) ? (cachedGrades as TCGradeItem[]) : [];
      if (tcCachedGrades.length > 0) {
        setTcGrades(tcCachedGrades);
      } else if (puFallback.grades.length > 0) {
        setTcGrades(puFallback.grades);
      }

      // 2. 背景檢查 TTL，過期則靜默刷新
      const [freshCourses, freshActivities, freshAttendance, freshTodos] = await Promise.all([
        getCachedTCCourses(),
        getCachedTCActivities(),
        getCachedTCAttendance(),
        getCachedTCTodos(),
      ]);
      // 如果任一過期（返回 null），觸發背景刷新
      if (!freshCourses || !freshActivities || !freshAttendance || !freshTodos) {
        refreshTCCourses().then((rc) => {
          if (rc?.length) {
            setTcCourses(mergeDemoTronClassCoursesIfEmpty(rc));
            const ids = rc.map((c) => c.id);
            Promise.allSettled([
              !freshActivities ? refreshTCActivitiesForCourses(ids).then((a) => setTcActivities(a)) : Promise.resolve(),
              !freshAttendance ? refreshTCAttendance().then((a) => { if (a) setTcAttendance(a); }) : Promise.resolve(),
              !freshTodos ? refreshTCTodos().then((t) => { if (t) setTcTodos(t); }) : Promise.resolve(),
            ]);
          } else {
            applyPUFallback().catch(() => {});
          }
        }).catch(() => {
          applyPUFallback().catch(() => {});
        });
      }

      // 3. Grades — 取得後寫入快取
      try {
        const grades = await tcFetchGrades();
        // 寫入快取供其他引擎使用
        if (grades.length > 0) {
          setTcGrades(grades);
          seedCachedTCGrades(grades).catch(() => {});
        } else if (puFallback.grades.length > 0) {
          setTcGrades(puFallback.grades);
        }
      } catch {
        if (puFallback.grades.length > 0) setTcGrades(puFallback.grades);
      }
    } catch {
      await applyPUFallback().catch(() => {});
    } finally {
      setDataLoading(false);
    }
  }, [applyPUFallback]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Full refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const courses = await refreshTCCourses();
      if (courses?.length) {
        setTcCourses(mergeDemoTronClassCoursesIfEmpty(courses));
        const courseIds = courses.map((c) => c.id);
        const [activities, attendance, todos] = await Promise.all([
          refreshTCActivitiesForCourses(courseIds),
          refreshTCAttendance(),
          refreshTCTodos(),
        ]);
        setTcActivities(activities);
        if (attendance) setTcAttendance(attendance);
        if (todos) setTcTodos(todos);
        try {
          const grades = await tcFetchGrades();
          if (grades.length > 0) {
            setTcGrades(grades);
            seedCachedTCGrades(grades).catch(() => {});
          } else {
            await applyPUFallback();
          }
        } catch {
          await applyPUFallback().catch(() => {});
        }
      } else {
        await applyPUFallback();
      }
      // Also refresh schedule
      try {
        await schedule.refreshSchedule();
      } catch {}
    } catch {
      await applyPUFallback().catch(() => {});
    }
    setRefreshing(false);
  }, [applyPUFallback, schedule]);

  // Schedule courses
  const courseSlots = useMemo((): CourseSlot[] => {
    if (schedule.courses.length === 0) return [];
    return schedule.courses.flatMap((course, ci) =>
      course.schedule.map((sched, si) => ({
        id: `${course.id}_${si}`,
        name: course.name,
        teacher: course.instructor,
        location: sched.location || '待定',
        dayOfWeek: sched.dayOfWeek,
        startPeriod: timeToperiod(sched.startTime),
        endPeriod: timeToperiod(sched.endTime),
        color: COURSE_COLORS[ci % COURSE_COLORS.length],
        credits: course.credits,
      })),
    );
  }, [schedule.courses]);

  const handleCoursePress = useCallback(
    (course: CourseSlot) => {
      const rootNav = nav?.getParent?.();
      Alert.alert(
        course.name,
        `教師：${course.teacher}\n地點：${course.location}\n時間：${WEEKDAYS_SHORT[course.dayOfWeek]} 第 ${course.startPeriod}-${course.endPeriod} 節\n學分：${course.credits ?? '-'}`,
        [
          { text: '關閉', style: 'cancel' },
          {
            text: '校園地圖',
            onPress: () => {
              rootNav?.navigate?.('校園', { screen: 'MapV2' });
            },
          },
        ],
      );
    },
    [nav],
  );

  const handleLoginSuccess = useCallback(() => {
    loadAllData();
  }, [loadAllData]);

  const hasCourseData = tcCourses.length > 0;
  const hasTronClassData = tcCourses.some(isTronClassCourse);
  const hasHomeworkData =
    hasTronClassData ||
    tcTodos.length > 0 ||
    Object.values(tcActivities).some((items) => items.length > 0);
  const hasGradeData = tcGrades.length > 0 || tcAttendance.length > 0 || hasCourseData;

  // 行事曆 tab 使用 SmartCalendarPanel（自帶 ScrollView），其他 tab 用外層 ScrollView
  if (tab === 'calendar') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {/* Header + Tabs — 固定在頂部 */}
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, gap: 14, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              <HeaderAvatarButton />
              <View style={{ gap: 2, flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>學習</Text>
                <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>我的課程</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => nav?.navigate?.('CreditAuditStack')} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="calculator-outline" size={18} color={theme.colors.accent} />
              </Pressable>
            </View>
          </View>
          <SegmentedControl options={TAB_OPTIONS} selected={tab} onChange={(k: any) => setTab(k as TabKey)} />
        </View>
        {/* SmartCalendarPanel 佔滿剩餘空間（嵌入模式隱藏標題） */}
        <SmartCalendarPanel embedded onJumpToScheduleTab={() => setTab('schedule')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 14,
        }}
      >
        {/* Header */}
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <HeaderAvatarButton />
            <View style={{ gap: 2, flex: 1 }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                學習
              </Text>
              <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>
                我的課程
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => nav?.navigate?.('CreditAuditStack')}
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="calculator-outline" size={18} color={theme.colors.accent} />
            </Pressable>
          </View>
        </View>

        {/* Tabs */}
        <SegmentedControl
          options={TAB_OPTIONS}
          selected={tab}
          onChange={(k: any) => setTab(k as TabKey)}
        />

        {/* Loading state */}
        {dataLoading && tab !== 'schedule' && (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
            <Text style={{ color: theme.colors.muted, marginTop: 10, fontSize: 13 }}>
              載入資料中...
            </Text>
          </View>
        )}

        {/* Schedule tab */}
        {tab === 'schedule' &&
          (schedule.loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, marginTop: 10, fontSize: 13 }}>
                載入課表中...
              </Text>
            </View>
          ) : courseSlots.length > 0 ? (
            <>
              <MiniScheduleView courses={courseSlots} onCoursePress={handleCoursePress} />
              <CourseToolsSection nav={nav} variant="compact" />
            </>
          ) : (
            <>
              <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
                <Ionicons
                  name="calendar-outline"
                  size={40}
                  color={theme.colors.muted}
                  style={{ opacity: 0.5 }}
                />
                <Text style={{ color: theme.colors.muted, fontSize: 14 }}>尚無課表資料</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  請先連線校園系統 或手動新增課程
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Pressable
                    onPress={() => nav?.navigate?.('CourseSchedule')}
                    style={({ pressed }) => ({
                      paddingHorizontal: 18,
                      paddingVertical: 8,
                      borderRadius: 16,
                      backgroundColor: theme.colors.accent,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>完整課表</Text>
                  </Pressable>
                </View>
              </View>
              <CourseToolsSection nav={nav} variant="empty" />
            </>
          ))}

        {/* Courses tab */}
        {tab === 'courses' &&
          !dataLoading &&
          (hasCourseData ? (
            <>
              <CockpitQuickRow nav={nav} roleGroup={auth.profile?.roleGroup ?? null} />
              <WeeklyFocusBanner courses={tcCourses} todos={tcTodos} nav={nav} />
              <CourseListView courses={tcCourses} nav={nav} onRefresh={handleRefresh} />
            </>
          ) : (
            <TCLoginSection onSuccess={handleLoginSuccess} profile={auth.profile} />
          ))}

        {/* Homework tab */}
        {tab === 'homework' &&
          !dataLoading &&
          (hasHomeworkData ? (
            <HomeworkView activities={tcActivities} courses={tcCourses} todos={tcTodos} nav={nav} />
          ) : (
            <TCLoginSection onSuccess={handleLoginSuccess} profile={auth.profile} />
          ))}

        {/* Grades tab */}
        {tab === 'grades' &&
          !dataLoading &&
          (hasGradeData ? (
            <GradesView grades={tcGrades} attendance={tcAttendance} courses={tcCourses} />
          ) : (
            <TCLoginSection onSuccess={handleLoginSuccess} profile={auth.profile} />
          ))}

        {/* Smart Attendance Entry — 智慧點名入口 */}
        <Pressable
          onPress={() => nav?.navigate?.('Attendance')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            marginTop: 6,
            borderRadius: 16,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.accent + '40',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="qr-code-outline" size={24} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
              智慧點名
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              7 種點名模式 · 動態 QR · 反作弊驗證 · AI 分析
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
        </Pressable>

        {/* Quick links at bottom */}
        <View style={{ gap: 8, marginTop: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => nav?.navigate?.('CourseSchedule')}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 14,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="calendar-outline" size={16} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                完整課表
              </Text>
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.('AICourseAdvisor')}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 14,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="school-outline" size={16} color="#8B5CF6" />
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                選課助理
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
