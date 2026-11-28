import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, Alert, RefreshControl, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Card,
  Button,
  AnimatedCard,
  SegmentedControl,
  SectionTitle,
  ListItem,
  ProgressRing,
  Spinner,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useTabPanelScroll } from '../hooks/useTabPanelScroll';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../services/demoSession';
import { useSchool } from '../state/school';
import { getDataSource, hasDataSource } from '../data';
import type { Grade as DataGrade } from '../data/types';
import { analytics } from '../services/analytics';
import { PersonalImportSummary } from '../components/PersonalImportSummary';

type Grade = {
  id: string;
  courseCode: string;
  courseName: string;
  credits: number;
  semester: string;
  midterm?: number;
  final?: number;
  grade?: string;
  gpa?: number;
  status: 'completed' | 'in_progress' | 'failed';
  category: 'required' | 'elective' | 'general' | 'english';
  instructor?: string;
  courseId?: string;
  gradeSource?: DataGrade['gradeSource'];
  publishedAt?: string;
};

type Semester = {
  id: string;
  name: string;
  year: number;
  term: number;
  gpa: number | null;
  credits: number;
  courses: Grade[];
};

// 通用示範成績 — 僅在未登入或無法取得真實資料時當後備顯示
// 登入後系統會透過 PUAdapter → Cloud Function → puScraper 抓取該使用者的真實成績
const MOCK_SEMESTERS: Semester[] = [
  {
    id: 'demo-1',
    name: '示範學期（上）',
    year: 0,
    term: 1,
    gpa: 3.6,
    credits: 15,
    courses: [
      {
        id: 'demo-c1',
        courseCode: 'DEMO',
        courseName: '程式設計',
        credits: 3,
        semester: 'demo-1',
        midterm: 85,
        final: 90,
        grade: 'A',
        gpa: 4.0,
        status: 'completed',
        category: 'required',
        instructor: '範例教師',
      },
      {
        id: 'demo-c2',
        courseCode: 'DEMO',
        courseName: '微積分',
        credits: 3,
        semester: 'demo-1',
        midterm: 78,
        final: 82,
        grade: 'B+',
        gpa: 3.5,
        status: 'completed',
        category: 'required',
        instructor: '範例教師',
      },
      {
        id: 'demo-c3',
        courseCode: 'DEMO',
        courseName: '英文',
        credits: 2,
        semester: 'demo-1',
        midterm: 88,
        final: 92,
        grade: 'A',
        gpa: 4.0,
        status: 'completed',
        category: 'english',
        instructor: '範例教師',
      },
      {
        id: 'demo-c4',
        courseCode: 'DEMO',
        courseName: '通識課程',
        credits: 2,
        semester: 'demo-1',
        midterm: 80,
        final: 85,
        grade: 'A-',
        gpa: 3.7,
        status: 'completed',
        category: 'general',
        instructor: '範例教師',
      },
      {
        id: 'demo-c5',
        courseCode: 'DEMO',
        courseName: '體育',
        credits: 0,
        semester: 'demo-1',
        grade: '通過',
        gpa: 0,
        status: 'completed',
        category: 'general',
        instructor: '體育室',
      },
    ],
  },
];

/** 等第色彩：一律取自即時 theme 的語意色，隨亮／暗切換 */
function gradeTone(grade?: string): string {
  if (grade === '通過' || grade === 'Pass' || /^A[+-]?$/.test(grade ?? '')) return theme.colors.success;
  if (/^B[+-]?$/.test(grade ?? '')) return theme.colors.info;
  if (/^C[+-]?$/.test(grade ?? '')) return theme.colors.warning;
  if (grade === 'D' || grade === 'F' || grade === '不通過') return theme.colors.danger;
  return theme.colors.muted;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  required: { label: '必修', icon: 'school-outline' },
  elective: { label: '選修', icon: 'options-outline' },
  general: { label: '通識', icon: 'globe-outline' },
  english: { label: '英文', icon: 'language-outline' },
};

type GradeStyles = ReturnType<typeof createStyles>;

/** 以分隔線區分的數據列（取代彩色數字方塊） */
function StatStrip({
  items,
  styles: s,
}: {
  items: { value: string | number; label: string; color?: string }[];
  styles: GradeStyles;
}) {
  return (
    <View style={s.statStrip}>
      {items.map((item, index) => (
        <View key={item.label} style={[s.statCell, index > 0 && s.statDivider]}>
          <Text style={[s.statValue, item.color ? { color: item.color } : null]}>{item.value}</Text>
          <Text style={s.statLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function GradeRow({ course, first }: { course: Grade; first: boolean }) {
  const s = useThemeStyleSheet(createStyles);
  const categoryInfo = CATEGORY_LABELS[course.category];
  const gradeColor = gradeTone(course.grade);
  const source = course.gradeSource?.startsWith('school-official')
    ? '校方正式'
    : course.gradeSource === 'firebase-course'
      ? 'nuni 課程'
      : '未知';
  const published = (course.publishedAt ? formatTaipeiDateTime(course.publishedAt) : '') || '未知';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint="開啟原始紀錄"
      onPress={() =>
        void Linking.openURL(
          course.gradeSource?.startsWith('school-official')
            ? 'https://ecampus.pu.edu.tw/'
            : `https://nuni.tw/course/${encodeURIComponent(course.courseId || '')}`,
        )
      }
      style={({ pressed }) => [s.row, !first && s.rowDivider, pressed && s.rowPressed]}
    >
      <View style={s.rowTop}>
        <View style={s.rowBody}>
          <Text style={s.rowTitle}>{course.courseName}</Text>
          <Text style={s.rowMeta}>
            {categoryInfo.label} · {course.courseCode ? `${course.courseCode} · ` : ''}
            {course.credits} 學分{course.instructor ? ` · ${course.instructor}` : ''}
          </Text>
          <Text style={s.rowMeta}>
            來源：{source} · 公布時間：{published} · 點選查看原始紀錄
          </Text>
        </View>

        {course.status === 'completed' && course.grade ? (
          <View style={s.gradeBox}>
            <Text style={[s.gradeLetter, { color: gradeColor }]}>{course.grade}</Text>
            {course.gpa !== undefined && (
              <Text style={s.rowMeta}>GPA {course.gpa.toFixed(1)}</Text>
            )}
          </View>
        ) : null}

        {course.status === 'in_progress' ? (
          <View style={s.gradeBox}>
            <Text style={s.progressText}>進行中</Text>
            {course.midterm !== undefined && <Text style={s.rowMeta}>期中 {course.midterm}</Text>}
          </View>
        ) : null}
      </View>

      {course.status === 'completed' &&
        course.midterm !== undefined &&
        course.final !== undefined && (
          <View style={s.scoreLine}>
            <Text style={s.rowMeta}>
              期中 <Text style={s.scoreValue}>{course.midterm}</Text>
            </Text>
            <Text style={s.rowMeta}>
              期末 <Text style={s.scoreValue}>{course.final}</Text>
            </Text>
          </View>
        )}
    </Pressable>
  );
}

function GradeList({ courses, styles: s }: { courses: Grade[]; styles: GradeStyles }) {
  return (
    <View style={s.group}>
      {courses.map((course, index) => (
        <GradeRow key={course.id} course={course} first={index === 0} />
      ))}
    </View>
  );
}

function EmptyNote({ title, text, styles: s }: { title: string; text: string; styles: GradeStyles }) {
  return (
    <View style={s.group}>
      <View style={s.emptyBody}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowMeta}>{text}</Text>
      </View>
    </View>
  );
}

// Infer category from course code patterns
function inferCategory(courseCode?: string, courseName?: string): Grade['category'] {
  if (!courseCode && !courseName) return 'required';
  const code = (courseCode || '').toLowerCase();
  const name = (courseName || '').toLowerCase();
  if (code.startsWith('eng') || name.includes('英文')) return 'english';
  if (code.startsWith('ge')) return 'general';
  if (code.startsWith('pe')) return 'general';
  return 'required';
}

const GRADE_TABS = [
  { id: 'current', label: '本學期' },
  { id: 'history', label: '歷史成績' },
  { id: 'statistics', label: '統計分析' },
] as const;

export function GradesScreen(props: Record<string, unknown>) {
  const s = useThemeStyleSheet(createStyles);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const auth = useAuth();
  const { school } = useSchool();

  const [selectedTab, setSelectedTab] = useState<(typeof GRADE_TABS)[number]['id']>('current');
  const panelScroll = useTabPanelScroll(selectedTab);
  const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serverGrades, setServerGrades] = useState<DataGrade[]>([]);
  const [gpaData, setGpaData] = useState<{
    gpa: number;
    totalCredits: number;
    totalPoints: number;
  } | null>(null);

  useEffect(() => {
    analytics.logScreenView('Grades');
    loadGrades();
  }, [auth.user?.uid]);

  const loadGrades = useCallback(async () => {
    if (!auth.user?.uid || !hasDataSource()) {
      setLoading(false);
      return;
    }

    try {
      const ds = getDataSource();
      const [grades, gpa] = await Promise.all([
        ds.listGrades(auth.user.uid, undefined, school.id),
        ds.getGPA(auth.user.uid, school.id),
      ]);
      setServerGrades(grades);
      setGpaData(gpa);
    } catch (error) {
      console.error('Failed to load grades:', error);
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid, school.id]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGrades();
    setRefreshing(false);
  }, [loadGrades]);

  const semesters = useMemo(() => {
    const semesterMap = new Map<string, Semester>();

    for (const grade of serverGrades) {
      const semId = grade.semester;
      if (!semesterMap.has(semId)) {
        // Support both "114-1" format and "1141" format (PU scraper)
        let yearStr: string, termStr: string;
        if (semId.includes('-')) {
          [yearStr, termStr] = semId.split('-');
        } else if (semId.length === 4) {
          yearStr = semId.substring(0, 3);
          termStr = semId.substring(3);
        } else {
          yearStr = semId;
          termStr = '1';
        }
        semesterMap.set(semId, {
          id: semId,
          name: `${yearStr}學年度第${termStr}學期`,
          year: parseInt(yearStr),
          term: parseInt(termStr),
          gpa: null,
          credits: 0,
          courses: [],
        });
      }

      const sem = semesterMap.get(semId)!;
      sem.courses.push({
        id: grade.id,
        courseCode: grade.courseCode || '',
        courseName: grade.courseName,
        credits: grade.credits,
        semester: grade.semester,
        midterm: grade.midtermScore,
        final: grade.finalScore,
        grade: grade.letterGrade,
        gpa: grade.gradePoints,
        status: grade.letterGrade ? 'completed' : 'in_progress',
        category: inferCategory(grade.courseCode, grade.courseName),
        instructor: grade.instructor,
        courseId: grade.courseId,
        gradeSource: grade.gradeSource,
        publishedAt: grade.publishedAt,
      });
      sem.credits += grade.credits;
    }

    for (const sem of semesterMap.values()) {
      const completedCourses = sem.courses.filter((c) => c.status === 'completed' && typeof c.gpa === 'number' && Number.isFinite(c.gpa) && Number.isFinite(c.credits) && c.credits > 0);
      if (completedCourses.length > 0) {
        const totalPoints = completedCourses.reduce((sum, c) => sum + (c.gpa ?? 0) * c.credits, 0);
        const totalCredits = completedCourses.reduce((sum, c) => sum + c.credits, 0);
        sem.gpa = totalCredits > 0 ? totalPoints / totalCredits : null;
      }
    }

    return Array.from(semesterMap.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.term - a.term;
    });
  }, [serverGrades]);

  useEffect(() => {
    if (selectedSemester === null && semesters.length > 0) {
      setSelectedSemester(semesters[0].id);
    }
  }, [semesters, selectedSemester]);

  const currentSemester = semesters[0];
  const historySemesters = semesters.slice(1);

  const allCourses = useMemo(() => {
    return semesters.flatMap((sem) => sem.courses);
  }, [semesters]);

  const completedCourses = useMemo(() => {
    return allCourses.filter((c) => c.status === 'completed');
  }, [allCourses]);

  const overallGPA = useMemo(() => {
    if (gpaData && gpaData.totalCredits > 0 && Number.isFinite(gpaData.totalCredits) && Number.isFinite(gpaData.gpa)) return gpaData.gpa;
    const numericCourses = completedCourses.filter((c) => typeof c.gpa === 'number' && Number.isFinite(c.gpa) && Number.isFinite(c.credits) && c.credits > 0);
    if (numericCourses.length === 0) return null;
    const totalPoints = numericCourses.reduce((sum, c) => sum + (c.gpa ?? 0) * c.credits, 0);
    const totalCredits = numericCourses.reduce((sum, c) => sum + c.credits, 0);
    return totalCredits > 0 ? totalPoints / totalCredits : null;
  }, [completedCourses, gpaData]);

  const totalCredits = useMemo(() => {
    return completedCourses.reduce((sum, c) => sum + c.credits, 0);
  }, [completedCourses]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, { completed: number; total: number }> = {};
    for (const category of Object.keys(CATEGORY_LABELS)) {
      const categoryCourses = completedCourses.filter((c) => c.category === category);
      stats[category] = {
        completed: categoryCourses.reduce((sum, c) => sum + c.credits, 0),
        total: 0,
      };
    }
    return stats;
  }, [completedCourses]);

  const gradeDistribution = useMemo(() => {
    const dist: Record<string, number> = { A系列: 0, B系列: 0, C系列: 0, 通過: 0, 其他: 0 };
    for (const c of completedCourses) {
      if (!c.grade) continue;
      if (c.grade.startsWith('A')) dist['A系列']++;
      else if (c.grade.startsWith('B')) dist['B系列']++;
      else if (c.grade.startsWith('C')) dist['C系列']++;
      else if (c.grade === '通過' || c.grade === '不通過') dist['通過']++;
      else dist['其他']++;
    }
    // Remove "通過" category if empty
    if (dist['通過'] === 0) delete dist['通過'];
    return dist;
  }, [completedCourses]);

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <Screen>
        <PersonalImportSummary kind="grades" />
        <AnimatedCard title="成績查詢" subtitle="請先登入">
          <Text style={s.noteText}>登入後才能查看成績資料</Text>
          <Button text="前往登入" kind="primary" onPress={() => nav?.navigate?.('MeHome')} />
        </AnimatedCard>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        <PersonalImportSummary kind="grades" />
        <View style={s.loading}>
          <Spinner />
          <Text style={s.noteText}>載入成績中...</Text>
        </View>
      </Screen>
    );
  }

  const completedSemesters = semesters.filter((x) => x.courses.some((c) => c.status === 'completed'));

  return (
    <Screen>
      <PersonalImportSummary kind="grades" />
      <Text style={s.formulaNote}>
        參考 GPA＝已知績點乘學分的總和 ÷ 有績點的學分總和；待評與未取得不當成零分，無可計算資料顯示未知。
      </Text>
      <View style={s.flex}>
        <SegmentedControl options={GRADE_TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView
          ref={panelScroll}
          style={s.scroll}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.accent}
            />
          }
        >
          {selectedTab === 'current' && (
            <View style={s.panel}>
              {currentSemester ? (
                <>
                  <View style={s.section}>
                    <SectionTitle text={currentSemester.name} />
                    <Text style={s.sectionSub}>
                      {currentSemester.courses.some((c) => c.status === 'completed')
                        ? `GPA: ${currentSemester.gpa?.toFixed(2) ?? '未知'}`
                        : '進行中'}
                    </Text>
                    <StatStrip
                      styles={s}
                      items={[
                        { value: currentSemester.credits, label: '修課學分' },
                        { value: currentSemester.courses.length, label: '修課數' },
                        {
                          value: currentSemester.courses.filter((c) => c.midterm !== undefined)
                            .length,
                          label: '已出期中成績',
                        },
                      ]}
                    />
                    {currentSemester.courses.some((c) => c.status === 'in_progress') && (
                      <View style={s.notice}>
                        <Ionicons
                          name="information-circle-outline"
                          size={18}
                          color={theme.colors.info}
                        />
                        <Text style={s.noticeText}>期末成績尚未公布，目前僅顯示期中成績</Text>
                      </View>
                    )}
                  </View>

                  <View style={s.section}>
                    <SectionTitle text="本學期課程" />
                    {currentSemester.courses.length > 0 ? (
                      <GradeList courses={currentSemester.courses} styles={s} />
                    ) : (
                      <EmptyNote title="無課程" text="本學期沒有課程記錄" styles={s} />
                    )}
                  </View>
                </>
              ) : (
                <EmptyNote title="無成績數據" text="未取得成績數據" styles={s} />
              )}
            </View>
          )}

          {selectedTab === 'history' && (
            <View style={s.panel}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.chipRow}>
                  {completedSemesters.map((sem) => {
                    const active = selectedSemester === sem.id;
                    return (
                      <Pressable
                        key={sem.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setSelectedSemester(sem.id)}
                        style={[s.chip, active && s.chipActive]}
                      >
                        <Text style={[s.chipText, active && s.chipTextActive]}>
                          {sem.name.replace('學年度', '').replace('學期', '')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              {(() => {
                const sem = semesters.find((x) => x.id === selectedSemester);
                if (!sem) return null;
                const completedInSem = sem.courses.filter((c) => c.status === 'completed');
                if (completedInSem.length === 0) {
                  return <EmptyNote title={sem.name} text="本學期成績尚未公布" styles={s} />;
                }

                return (
                  <>
                    <View style={s.section}>
                      <SectionTitle text={sem.name} />
                      <StatStrip
                        styles={s}
                        items={[
                          { value: sem.gpa?.toFixed(2) ?? '未知', label: '學期 GPA' },
                          {
                            value: completedInSem.reduce((sum, c) => sum + c.credits, 0),
                            label: '取得學分',
                          },
                          { value: completedInSem.length, label: '修課數' },
                        ]}
                      />
                    </View>

                    <View style={s.section}>
                      <SectionTitle text="課程成績" />
                      <GradeList courses={completedInSem} styles={s} />
                    </View>
                  </>
                );
              })()}
            </View>
          )}

          {selectedTab === 'statistics' && (
            <View style={s.panel}>
              <View style={s.section}>
                <SectionTitle text="成績總覽" />
                <View style={s.group}>
                  <View style={s.overview}>
                    <ProgressRing
                      progress={Math.min(1, (overallGPA ?? 0) / 4.0)}
                      size={88}
                      strokeWidth={9}
                      color={theme.colors.accent}
                    />
                    <View style={s.rowBody}>
                      <Text style={s.rowMeta}>累積 GPA</Text>
                      <Text style={s.overviewValue}>{overallGPA?.toFixed(2) ?? '未知'}</Text>
                      <Text style={s.rowMeta}>滿分 4.0</Text>
                    </View>
                  </View>
                </View>
                <StatStrip
                  styles={s}
                  items={[
                    { value: totalCredits, label: '已修學分' },
                    { value: completedCourses.length, label: '完成課程' },
                    { value: completedSemesters.length, label: '完成學期' },
                  ]}
                />
              </View>

              <View style={s.section}>
                <SectionTitle text="成績分布" />
                <View style={s.group}>
                  {Object.entries(gradeDistribution).map(([label, count], index) => {
                    const total = completedCourses.length || 1;
                    const percent = (count / total) * 100;
                    const color =
                      label === 'A系列'
                        ? theme.colors.success
                        : label === 'B系列'
                          ? theme.colors.info
                          : label === 'C系列'
                            ? theme.colors.warning
                            : theme.colors.muted;

                    return (
                      <View key={label} style={[s.distRow, index > 0 && s.rowDivider]}>
                        <View style={s.distHead}>
                          <Text style={s.distLabel}>{label}</Text>
                          <Text style={s.rowMeta}>
                            {count} 門 ({percent.toFixed(0)}%)
                          </Text>
                        </View>
                        <View style={s.track}>
                          <View
                            style={[s.fill, { width: `${percent}%`, backgroundColor: color }]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={s.section}>
                <SectionTitle text="學分分類" />
                <View style={s.group}>
                  {Object.entries(CATEGORY_LABELS).map(([key, info], index) => (
                    <View key={key} style={[s.catRow, index > 0 && s.rowDivider]}>
                      <Ionicons name={info.icon} size={20} color={theme.colors.textSecondary} />
                      <Text style={s.catLabel}>{info.label}</Text>
                      <Text style={s.catValue}>{categoryStats[key]?.completed ?? 0} 學分</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={s.section}>
                <SectionTitle text="GPA 趨勢" />
                <View style={s.group}>
                  {completedSemesters.map((sem, index) => (
                    <View key={sem.id} style={[s.catRow, index > 0 && s.rowDivider]}>
                      <Text style={s.catLabel}>
                        {sem.name.replace('學年度', '').replace('學期', '')}
                      </Text>
                      <Text style={s.rowMeta}>
                        {sem.courses
                          .filter((c) => c.status === 'completed')
                          .reduce((sum, c) => sum + c.credits, 0)}{' '}
                        學分
                      </Text>
                      <Text style={s.catValue}>{sem.gpa?.toFixed(2) ?? '未知'}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={s.cta}>
                <Button
                  text="前往學分試算"
                  kind="primary"
                  onPress={() => nav?.navigate?.('CreditAuditStack')}
                />
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1 },
    scroll: { flex: 1, marginTop: theme.space.md },
    panel: { gap: theme.layout.sectionGap },
    section: { gap: theme.space.sm },
    sectionSub: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
    loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: theme.space.md },
    noteText: { color: theme.colors.textSecondary, marginBottom: theme.space.md },
    formulaNote: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: theme.space.sm,
    },
    group: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    statStrip: {
      flexDirection: 'row',
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    statCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: theme.space.md,
      paddingHorizontal: theme.space.xs,
    },
    statDivider: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.separator,
    },
    statValue: { color: theme.colors.text, fontWeight: '700', fontSize: 22, lineHeight: 28 },
    statLabel: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      textAlign: 'center',
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      paddingVertical: theme.space.sm,
    },
    noticeText: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
    row: {
      minHeight: 56,
      paddingVertical: theme.layout.listItemVertical,
      paddingHorizontal: theme.space.md,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    rowPressed: { backgroundColor: theme.colors.surfaceInteractive },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm + 4 },
    rowBody: { flex: 1 },
    rowTitle: { color: theme.colors.text, fontWeight: '600', fontSize: 15, lineHeight: 21 },
    rowMeta: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    gradeBox: { alignItems: 'center', minWidth: 52 },
    gradeLetter: { fontWeight: '700', fontSize: 22, lineHeight: 28 },
    progressText: { color: theme.colors.textSecondary, fontWeight: '600', fontSize: 13 },
    scoreLine: { flexDirection: 'row', gap: theme.space.md, marginTop: theme.space.sm },
    scoreValue: { color: theme.colors.text, fontWeight: '600' },
    emptyBody: { padding: theme.space.md, gap: 2 },
    chipRow: { flexDirection: 'row', gap: theme.space.sm },
    chip: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    chipActive: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
    chipText: { color: theme.colors.textSecondary, fontWeight: '600' },
    chipTextActive: { color: theme.colors.text },
    overview: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.lg,
      padding: theme.space.md,
    },
    overviewValue: { color: theme.colors.text, fontWeight: '700', fontSize: 34, lineHeight: 40 },
    distRow: { padding: theme.space.md, gap: theme.space.xs },
    distHead: { flexDirection: 'row', justifyContent: 'space-between' },
    distLabel: { color: theme.colors.text, fontWeight: '600' },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.separator,
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: 3 },
    catRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 48,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm + 4,
    },
    catLabel: { flex: 1, color: theme.colors.text, fontWeight: '600', fontSize: 15 },
    catValue: { color: theme.colors.text, fontWeight: '700', fontSize: 16 },
    cta: { marginTop: theme.space.sm },
  });
