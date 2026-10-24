import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AuthGuard } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin } from '../services/demoSession';
import { useSchool } from '../state/school';
import type { Grade } from '../data/types';
import {
  type PUCreditCat,
  type DeptGradRequirement,
  PU_CATEGORY_LABELS,
  PU_CATEGORY_COLORS,
  PU_DEFAULT_REQUIREMENT,
  PU_DEPARTMENTS,
  matchDepartment,
  mapCourseTypeDetailed,
} from '../data/puGradRequirements';
import {
  computeCreditTotals,
  isPassed,
  scoreDisplay,
  semesterLabel,
  semesterWeightedAverage,
} from './creditAudit/creditMath';
import { isProvidenceUniversitySchool } from './creditAudit/gradeScope';
import {
  loadCreditRecords,
  type GpaSnapshot,
} from './creditAudit/loadCreditRecords';

type NavigationLike = {
  navigate?: (name: string, params?: unknown) => void;
  goBack?: () => void;
  getParent?: () => { navigate?: (name: string, params?: unknown) => void } | undefined;
};

type Props = {
  navigation?: NavigationLike;
};

const CATEGORY_ORDER: PUCreditCat[] = [
  'required',
  'elective',
  'general',
  'common',
  'pe',
  'service',
  'free',
];

export function CreditAuditScreen(props: Props) {
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid ?? null;
  const schoolId = school.id;
  const isPu = isProvidenceUniversitySchool(schoolId);

  const [grades, setGrades] = useState<Grade[]>([]);
  const [gpaData, setGpaData] = useState<GpaSnapshot | null>(null);
  const [gpaUnavailable, setGpaUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [fromOfflineSchoolCache, setFromOfflineSchoolCache] = useState(false);
  const [expandedSem, setExpandedSem] = useState<string | null>(null);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [manualDeptId, setManualDeptId] = useState<string | null>(null);

  const requestGen = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGen.current += 1;
    };
  }, []);

  const detectedDept = useMemo(() => {
    if (!isPu) return null;
    return matchDepartment(auth.profile?.department);
  }, [auth.profile?.department, isPu]);

  const currentDept: DeptGradRequirement | null = useMemo(() => {
    if (!isPu) return null;
    if (manualDeptId) {
      const found = PU_DEPARTMENTS.find((d) => d.id === manualDeptId);
      if (found) return found;
    }
    return detectedDept ?? PU_DEFAULT_REQUIREMENT;
  }, [manualDeptId, detectedDept, isPu]);

  const deptIsUnknown = Boolean(isPu && currentDept && currentDept.id === 'default' && !manualDeptId);

  const load = useCallback(async () => {
    const gen = ++requestGen.current;
    setLoading(true);

    const result = await loadCreditRecords({ uid, schoolId });

    if (!mountedRef.current || gen !== requestGen.current) return;

    if (result.ok === false) {
      setError(result.errorMessage);
      setGrades([]);
      setGpaData(null);
      setGpaUnavailable(false);
      setReadAt(null);
      setFromOfflineSchoolCache(false);
      setLoading(false);
      return;
    }

    setGrades(result.grades);
    setGpaData(result.gpa);
    setGpaUnavailable(result.gpaUnavailable);
    setReadAt(result.readAt);
    setFromOfflineSchoolCache(result.fromOfflineSchoolCache);
    setError(null);
    setLoading(false);
  }, [uid, schoolId]);

  // 帳號／學校切換：清掉私人資料與手動系所，並以新世代載入
  useEffect(() => {
    setManualDeptId(null);
    setShowDeptPicker(false);
    setExpandedSem(null);
    setGrades([]);
    setGpaData(null);
    setGpaUnavailable(false);
    setReadAt(null);
    setFromOfflineSchoolCache(false);
    setError(null);
    void load();
    return () => {
      requestGen.current += 1;
    };
  }, [load]);

  const creditSummary = useMemo(
    () => computeCreditTotals(grades, currentDept),
    [grades, currentDept],
  );

  const bySemester = useMemo(() => {
    const map = new Map<string, Grade[]>();
    for (const g of grades) {
      const sem = g.semester || 'unknown';
      if (!map.has(sem)) map.set(sem, []);
      map.get(sem)!.push(g);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [grades]);

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <AuthGuard
        user={auth.user}
        onLogin={() => props.navigation?.navigate?.('Me')}
        title="需要登入"
        description="請登入後再查看修課紀錄與學分試算。登入後可看到目前帳號、目前學校的成績明細。"
      >
        <></>
      </AuthGuard>
    );
  }

  if (loading) {
    return <LoadingState title="學分試算" subtitle="載入成績資料中..." rows={3} />;
  }

  if (error) {
    return (
      <ErrorState
        title="學分試算"
        subtitle="讀取失敗"
        hint={error}
        actionText="重試"
        onAction={() => {
          void load();
        }}
        errorType="network"
      />
    );
  }

  if (grades.length === 0) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Card title="學分試算">
            <View style={{ alignItems: 'center', gap: 12, paddingVertical: 20 }}>
              <Ionicons
                name="school-outline"
                size={48}
                color={theme.colors.accent}
                style={{ opacity: 0.5 }}
              />
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
                尚無可用的修課紀錄
              </Text>
              <Text style={{ color: theme.colors.muted, textAlign: 'center', lineHeight: 20 }}>
                目前帳號在「{school.name}」還沒有已發布、可確認範圍的成績。讀取成功後會顯示在這裡；系統不會自動選課，也不會代替學校做正式畢業認定。
              </Text>
              <Button text="重新整理" kind="primary" onPress={() => void load()} />
            </View>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  const { byCategory, totalEarned, totalCourses, passedCount, failedCount, ungradedCount, retakeCollapsed } =
    creditSummary;
  const totalRequired = currentDept?.totalCredits ?? 0;
  const totalPct =
    isPu && totalRequired > 0 ? Math.min(1, totalEarned / totalRequired) : 0;
  const remaining = isPu && totalRequired > 0 ? Math.max(0, totalRequired - totalEarned) : 0;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title="說明">
          <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
            {isPu
              ? '以下依靜宜大學公開修業參考模型粗估學分進度，僅供個人參考。入學年度、重修、抵免與轉學分規則可能與正式審查不同；本畫面不會自動選課，也不代表學校正式畢業資格。'
              : `目前學校為「${school.name}」。這裡只整理你在此校、此帳號的修課紀錄與分類加總，沒有套用靜宜大學畢業門檻，也不推估正式畢業資格。本畫面不會自動選課或核發正式證明。`}
          </Text>
        </Card>

        {isPu && currentDept ? (
          <Card title="參考畢業門檻（靜宜模型）">
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
                    {currentDept.name}
                  </Text>
                  {currentDept.college ? (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      {currentDept.college} · 參考總學分 {totalRequired}
                    </Text>
                  ) : (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      參考總學分 {totalRequired}
                    </Text>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showDeptPicker ? '收合系所清單' : '切換參考系所'}
                  onPress={() => setShowDeptPicker(!showDeptPicker)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    minWidth: 44,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: '700' }}>
                    {showDeptPicker ? '收合' : '切換系所'}
                  </Text>
                </Pressable>
              </View>

              {deptIsUnknown ? (
                <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                  尚未對應到明確系所，以下為一般參考預設，不是自動官方偵測，也不是已驗證門檻。請自行選擇較接近的系所，或以學校正式規定為準。
                </Text>
              ) : detectedDept && detectedDept.id !== 'default' && !manualDeptId ? (
                <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                  依個人資料中的系所字串對應到「{detectedDept.shortName}」參考模型，仍可能因入學年度或轉系而需手動調整。
                </Text>
              ) : null}

              {currentDept.notes ? (
                <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}>
                  {currentDept.notes}
                </Text>
              ) : null}

              {showDeptPicker ? (
                <View style={{ gap: 6, marginTop: 4 }}>
                  {PU_DEPARTMENTS.map((dept) => {
                    const isActive = dept.id === currentDept.id;
                    return (
                      <Pressable
                        key={dept.id}
                        accessibilityRole="button"
                        accessibilityLabel={`選擇參考系所 ${dept.name}`}
                        onPress={() => {
                          setManualDeptId(dept.id);
                          setShowDeptPicker(false);
                        }}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          minHeight: 48,
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor: isActive
                            ? theme.colors.accentSoft
                            : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: isActive ? theme.colors.accent : theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}
                          >
                            {dept.name}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                            {dept.college} · 參考 {dept.totalCredits} 學分
                          </Text>
                        </View>
                        {isActive ? (
                          <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {manualDeptId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="清除手動系所選擇"
                      onPress={() => {
                        setManualDeptId(null);
                        setShowDeptPicker(false);
                      }}
                      style={({ pressed }) => ({
                        minHeight: 44,
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
                        改回資料對應
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        <Card title={isPu ? '參考學分進度' : '修課學分加總'}>
          {isPu && currentDept ? (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  參考門檻 {totalRequired} 學分
                </Text>
                <Pill
                  text={deptIsUnknown ? '門檻未驗證' : remaining <= 0 ? '參考已達標' : '參考未達標'}
                  kind={remaining <= 0 && !deptIsUnknown ? 'accent' : 'default'}
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 40 }}>
                  {totalEarned}
                </Text>
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontWeight: '700',
                    fontSize: 20,
                    marginLeft: 4,
                  }}
                >
                  / {totalRequired}
                </Text>
              </View>
              <View
                style={{
                  marginTop: 10,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: theme.colors.surface2,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: '100%',
                    width: `${Math.round(totalPct * 100)}%`,
                    backgroundColor:
                      remaining <= 0 && !deptIsUnknown ? '#34C759' : theme.colors.accent,
                    borderRadius: 7,
                  }}
                />
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
                {deptIsUnknown
                  ? '系所門檻尚未驗證，數字僅供粗估。'
                  : remaining > 0
                    ? `粗估還差約 ${remaining} 學分（非正式認定）。`
                    : '粗估總學分已達參考門檻，正式結果仍以學校審查為準。'}
              </Text>
            </>
          ) : (
            <>
              <Text style={{ color: theme.colors.muted, fontSize: 13 }}>目前帳號粗估已修學分</Text>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 40, marginTop: 4 }}>
                {totalEarned}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
                僅依通過課程加總，未套用他校畢業門檻，也不代表正式畢業資格。
              </Text>
            </>
          )}
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }}>
            {totalCourses} 門課・通過 {passedCount}・未通過 {failedCount}
            {ungradedCount > 0 ? `・未評分 ${ungradedCount}` : ''}
            {retakeCollapsed > 0 ? `・重複修課合併 ${retakeCollapsed} 筆` : ''}
          </Text>
        </Card>

        {gpaUnavailable ? (
          <Card title="本頁參考 GPA">
            <Text style={{ color: theme.colors.text, fontSize: 15, lineHeight: 22 }}>
              參考 GPA 暫時無法計算
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 6, lineHeight: 18 }}>
              修課紀錄仍可查看。僅在本頁已接受列具有完整績點與可用學分時才計算；不會以 0
              代替，也不會改用未驗證的外部 GPA 快照。
            </Text>
            <Button text="重試讀取" onPress={() => void load()} />
          </Card>
        ) : gpaData && gpaData.totalCredits > 0 ? (
          <Card title="本頁參考 GPA">
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 40 }}>
                {gpaData.gpa.toFixed(2)}
              </Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontWeight: '700',
                  fontSize: 20,
                  marginLeft: 4,
                }}
              >
                / 4.00
              </Text>
            </View>
            <Text style={{ color: theme.colors.muted, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
              依本頁已接受修課紀錄的績點與學分加權（已粗估合併重複修課
              {gpaData.retakeCollapsed > 0 ? ` ${gpaData.retakeCollapsed} 筆` : ''}
              ）。非正式累計 GPA。
            </Text>
            <Text style={{ color: theme.colors.muted, marginTop: 4, fontSize: 13 }}>
              計入 {gpaData.totalCredits} 學分・加權總績點 {gpaData.totalPoints.toFixed(1)}
            </Text>
          </Card>
        ) : null}

        <Card
          title={isPu ? '各類學分進度（參考）' : '各類修課加總'}
          subtitle={isPu && currentDept ? currentDept.shortName : school.shortName || school.name}
        >
          {CATEGORY_ORDER.map((k) => {
            const b = byCategory[k];
            const isCountBased = isPu && (k === 'pe' || k === 'service');
            const showVal = isCountBased ? b.passedCourses : b.earned;
            const reqVal = isPu && currentDept
              ? isCountBased
                ? k === 'pe'
                  ? currentDept.peCoursesRequired
                  : currentDept.serviceCoursesRequired
                : b.required
              : 0;

            if (isPu) {
              if (reqVal === 0 && b.courses === 0 && !isCountBased) return null;
            } else if (b.courses === 0) {
              return null;
            }

            const pct =
              isPu && reqVal > 0
                ? Math.min(1, showVal / reqVal)
                : showVal > 0
                  ? 1
                  : 0;
            const rem = isPu ? Math.max(0, reqVal - showVal) : 0;
            const done = isPu && reqVal > 0 ? rem <= 0 : false;

            return (
              <View key={k} style={{ marginBottom: 16 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: PU_CATEGORY_COLORS[k],
                      }}
                    />
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
                      {PU_CATEGORY_LABELS[k]}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                      ({b.courses} 門)
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: done ? '#34C759' : theme.colors.muted,
                      fontWeight: '600',
                      fontSize: 14,
                    }}
                  >
                    {isPu
                      ? `${showVal}${isCountBased ? ' 門' : ''}/${reqVal}${
                          isCountBased ? ' 門' : ''
                        }${done ? ' ✓' : rem > 0 ? ` (差${rem}${isCountBased ? '門' : ''})` : ''}`
                      : `${showVal}${isCountBased ? ' 門' : ' 學分'}`}
                  </Text>
                </View>
                <View
                  style={{
                    marginTop: 6,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.surface2,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      width: `${Math.round(pct * 100)}%`,
                      backgroundColor: PU_CATEGORY_COLORS[k],
                      opacity: 0.85,
                      borderRadius: 4,
                    }}
                  />
                </View>
                {b.failedCourses > 0 ? (
                  <Text style={{ color: '#f43f5e', fontSize: 12, marginTop: 4 }}>
                    有 {b.failedCourses} 門未通過
                  </Text>
                ) : null}
                {b.ungradedCourses > 0 ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                    有 {b.ungradedCourses} 門尚未評分（不計入已修學分）
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Card>

        {readAt ? (
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 12,
              textAlign: 'center',
              marginTop: 4,
              paddingHorizontal: 12,
            }}
          >
            本機讀取時間：{new Date(readAt).toLocaleString('zh-TW')}（非校方正式更新時間）
            {fromOfflineSchoolCache
              ? '。目前含離線快取的校務成績，不是這次即時校方更新。'
              : ''}
          </Text>
        ) : null}

        <Card title="各學期成績明細" subtitle={`共 ${bySemester.length} 個學期`}>
          <View style={{ gap: 8 }}>
            {bySemester.map(([sem, semGrades]) => {
              const isExpanded = expandedSem === sem;
              const semCredits = semGrades.reduce(
                (s, g) => s + (isPassed(g) ? (Number.isFinite(g.credits) ? g.credits : 0) : 0),
                0,
              );
              const weightedAvg = semesterWeightedAverage(semGrades);

              return (
                <View key={sem}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${semesterLabel(sem)}，${isExpanded ? '收合' : '展開'}明細`}
                    onPress={() => setExpandedSem(isExpanded ? null : sem)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      minHeight: 56,
                      padding: 14,
                      borderRadius: theme.radius.md,
                      backgroundColor: isExpanded ? theme.colors.surface2 : 'transparent',
                      borderWidth: 1,
                      borderColor: isExpanded ? theme.colors.border : theme.colors.surface2,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
                        {semesterLabel(sem)}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                          {semGrades.length} 門課
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                          通過學分：{semCredits}
                        </Text>
                        {weightedAvg !== null ? (
                          <Text
                            style={{
                              color:
                                weightedAvg >= 80
                                  ? '#34C759'
                                  : weightedAvg >= 60
                                    ? theme.colors.muted
                                    : '#f43f5e',
                              fontSize: 13,
                              fontWeight: '600',
                            }}
                          >
                            加權平均：{weightedAvg.toFixed(1)}
                          </Text>
                        ) : (
                          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                            加權平均：無法計算
                          </Text>
                        )}
                      </View>
                    </View>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={22}
                      color={theme.colors.muted}
                    />
                  </Pressable>

                  {isExpanded ? (
                    <View style={{ paddingHorizontal: 4, paddingTop: 4, gap: 6 }}>
                      <View
                        style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6 }}
                      >
                        <Text
                          style={{
                            flex: 4,
                            color: theme.colors.muted,
                            fontSize: 12,
                            fontWeight: '600',
                          }}
                        >
                          科目
                        </Text>
                        <Text
                          style={{
                            flex: 1.5,
                            color: theme.colors.muted,
                            fontSize: 12,
                            fontWeight: '600',
                            textAlign: 'center',
                          }}
                        >
                          分類
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            color: theme.colors.muted,
                            fontSize: 12,
                            fontWeight: '600',
                            textAlign: 'center',
                          }}
                        >
                          學分
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            color: theme.colors.muted,
                            fontSize: 12,
                            fontWeight: '600',
                            textAlign: 'center',
                          }}
                        >
                          成績
                        </Text>
                      </View>
                      {semGrades.map((g, i) => {
                        const passed = isPassed(g);
                        const cat = mapCourseTypeDetailed(g.courseType, g.courseName);
                        const numeric =
                          typeof (g.grade ?? g.score) === 'number' &&
                          Number.isFinite((g.grade ?? g.score) as number)
                            ? ((g.grade ?? g.score) as number)
                            : null;
                        return (
                          <View
                            key={g.id || `${sem}-${i}`}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              minHeight: 48,
                              paddingHorizontal: 12,
                              paddingVertical: 10,
                              borderRadius: theme.radius.sm,
                              backgroundColor: passed ? 'transparent' : 'rgba(255,45,85,0.05)',
                              borderBottomWidth: i < semGrades.length - 1 ? 1 : 0,
                              borderBottomColor: theme.colors.surface2,
                            }}
                          >
                            <View style={{ flex: 4 }}>
                              <Text
                                style={{
                                  color: theme.colors.text,
                                  fontSize: 14,
                                  fontWeight: '600',
                                }}
                                numberOfLines={2}
                              >
                                {g.courseName}
                              </Text>
                              {g.courseClass ? (
                                <Text
                                  style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}
                                >
                                  {g.courseClass}
                                </Text>
                              ) : null}
                            </View>
                            <View style={{ flex: 1.5, alignItems: 'center' }}>
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                  backgroundColor: PU_CATEGORY_COLORS[cat] + '18',
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: '700',
                                    color: PU_CATEGORY_COLORS[cat],
                                  }}
                                >
                                  {PU_CATEGORY_LABELS[cat]}
                                </Text>
                              </View>
                            </View>
                            <Text
                              style={{
                                flex: 1,
                                textAlign: 'center',
                                color: theme.colors.text,
                                fontSize: 14,
                                fontWeight: '600',
                              }}
                            >
                              {g.credits}
                            </Text>
                            <Text
                              style={{
                                flex: 1,
                                textAlign: 'center',
                                fontSize: 14,
                                fontWeight: '700',
                                color: passed
                                  ? numeric !== null && numeric >= 80
                                    ? '#34C759'
                                    : theme.colors.text
                                  : numeric === null
                                    ? theme.colors.muted
                                    : '#f43f5e',
                              }}
                            >
                              {scoreDisplay(g)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>

        {isPu && currentDept && remaining > 0 && !deptIsUnknown ? (
          <Card title="參考缺口（非正式）">
            <Text
              style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 8 }}
            >
              依「{currentDept.shortName}」參考模型，粗估還差約 {remaining}{' '}
              學分。實際選課與畢業審查請以學校規定為準；本畫面不會自動幫你選課。
            </Text>
            {CATEGORY_ORDER.filter((k) => {
              if (k === 'pe' || k === 'service') return false;
              return byCategory[k].required - byCategory[k].earned > 0;
            }).map((k) => {
              const rem = byCategory[k].required - byCategory[k].earned;
              return (
                <View
                  key={k}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    borderLeftWidth: 3,
                    borderLeftColor: PU_CATEGORY_COLORS[k],
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                    {PU_CATEGORY_LABELS[k]}：粗估還需約 {rem} 學分
                  </Text>
                </View>
              );
            })}
            {(() => {
              const peRem = Math.max(
                0,
                currentDept.peCoursesRequired - byCategory.pe.passedCourses,
              );
              const svcRem = Math.max(
                0,
                currentDept.serviceCoursesRequired - byCategory.service.passedCourses,
              );
              if (peRem <= 0 && svcRem <= 0) return null;
              return (
                <>
                  {peRem > 0 ? (
                    <View
                      style={{
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderLeftWidth: 3,
                        borderLeftColor: PU_CATEGORY_COLORS.pe,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        體育：粗估還需約 {peRem} 門
                      </Text>
                    </View>
                  ) : null}
                  {svcRem > 0 ? (
                    <View
                      style={{
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderLeftWidth: 3,
                        borderLeftColor: PU_CATEGORY_COLORS.service,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        服務學習：粗估還需約 {svcRem} 門
                      </Text>
                    </View>
                  ) : null}
                </>
              );
            })()}
            <View style={{ marginTop: 8 }}>
              <Button
                text="開啟 AI 選課助理"
                kind="primary"
                onPress={() => props.navigation?.getParent?.()?.navigate?.('AICourseAdvisor')}
              />
            </View>
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4, paddingBottom: 8 }}>
          <Button text="重新整理" onPress={() => void load()} />
        </View>
      </ScrollView>
    </Screen>
  );
}
