import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import { resolveCourseHubTarget, type CourseHubTarget } from '../utils/courseHubRoute';
import { loadCourseHub, type CourseHubData, type CourseHubScope, type HubAssignment } from '../features/courseHub';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import { formatTaipeiDateTime, parseTaipeiInstant, taipeiParts } from '@campus/shared/src/taipeiTime';
import { revealAssignmentSubmitArea } from './nuni/scrollAssignment';
import { canListAsPendingWork, canSubmitCourseWork, submissionStatusText, summarizeCourseReceipts } from '../features/courseSubmissionState';

type Props = {
  navigation?: Parameters<typeof safeNavigate>[0] & {
    goBack?: () => void;
    addListener?: (event: 'focus', callback: () => void) => () => void;
  };
  route?: { params?: Record<string, unknown> };
};

function weekAssignments(items: HubAssignment[], now = new Date()): HubAssignment[] {
  const parts = taipeiParts(now);
  if (!parts) return [];
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = shifted.getUTCDay() || 7;
  const start = Date.UTC(parts.year, parts.month - 1, parts.day) - (weekday - 1) * 86400000;
  const end = start + 7 * 86400000;
  return items.filter((item) => {
    if (!item.dueAt || !canSubmitCourseWork(item, now)) return false;
    const due = parseTaipeiInstant(item.dueAt);
    if (due === null) return false;
    const dueParts = taipeiParts(due);
    if (!dueParts) return false;
    const dueUtc = Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day);
    return dueUtc >= start && dueUtc < end;
  }).sort((a, b) => (parseTaipeiInstant(a.dueAt!) ?? 0) - (parseTaipeiInstant(b.dueAt!) ?? 0));
}

function deadlineLabel(item: HubAssignment): string {
  if (item.closed) return '已關閉';
  if (!item.dueAt) return '未提供截止時間';
  if (parseTaipeiInstant(item.dueAt) === null) return '截止時間無法確認';
  return `截止：${formatTaipeiDateTime(item.dueAt, { seconds: false })}`;
}

function overduePolicyText(item: HubAssignment, now = new Date()): string | null {
  if (item.submission?.kind === 'submitted' || !item.dueAt) return null;
  const dueMs = parseTaipeiInstant(item.dueAt);
  if (dueMs === null || dueMs >= now.getTime()) return null;
  return !item.closed && item.allowLateSubmission
    ? '已過截止時間 · 教師允許補交'
    : '已過截止時間 · 請洽授課教師';
}
export default function CourseHubAiFirstScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const { school } = useSchool();
  const target = resolveCourseHubTarget(route?.params);
  const section = typeof route?.params?.section === 'string' ? route.params.section : undefined;
  const scopeKey = JSON.stringify([user?.uid, school.id, target]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return (
    <CourseContent
      key={scopeKey}
      uid={user?.uid ?? ''}
      schoolId={school.id}
      target={target}
      section={section}
      navigation={navigation}
      scopeKey={scopeKey}
      activeScope={activeScope}
    />
  );
}
function CourseContent({
  uid,
  schoolId,
  target,
  section,
  navigation,
  scopeKey,
  activeScope,
}: {
  uid: string;
  schoolId: string;
  target: CourseHubTarget | null;
  section?: string;
  navigation: Props['navigation'];
  scopeKey: string;
  activeScope: React.MutableRefObject<string>;
}) {
  const theme = useTheme();
  const mounted = useRef(true);
  const scrollRef = useRef<ScrollView>(null);
  const weekRef = useRef<View>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const [data, setData] = useState<CourseHubData | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(target && uid));
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [opening, setOpening] = useState(false);
  const [workFilter, setWorkFilter] = useState<'all' | 'unsubmitted' | 'submitted'>('all');
  const isCurrent = useCallback(
    () => mounted.current && activeScope.current === scopeKey,
    [activeScope, scopeKey],
  );
  const targetKey = JSON.stringify(target);
  const load = useCallback(async () => {
    const currentTarget = JSON.parse(targetKey) as CourseHubTarget | null;
    if (!currentTarget || !uid || !isCurrent()) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setData(null);
    setCheckedAt(null);
    setLinkError('');
    try {
      const result = await loadCourseHub(
        { uid, schoolId, target: currentTarget } satisfies CourseHubScope,
        () => isCurrent() && request === generation.current,
      );
      if (isCurrent() && request === generation.current) {
        setData(result);
        setCheckedAt(new Date().toISOString());
      }
    } catch (reason) {
      if (isCurrent() && request === generation.current)
        setError(reason instanceof Error ? reason.message : '目前無法讀取課程。');
    } finally {
      if (isCurrent() && request === generation.current) setLoading(false);
    }
  }, [uid, schoolId, targetKey, isCurrent]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const unsubscribe = navigation?.addListener?.('focus', () => { void load(); });
    return () => {
      unsubscribe?.();
      mounted.current = false;
      generation.current += 1;
    };
  }, [load, navigation]);
  useEffect(() => {
    if (section !== 'week' || loading || !data) return;
    const timer = setTimeout(() => {
      revealAssignmentSubmitArea(scrollRef.current, weekRef.current);
    }, 50);
    return () => clearTimeout(timer);
  }, [section, loading, data]);
  const open = async (url: string) => {
    if (!isCurrent() || pending.current || !data) return;
    pending.current = true;
    setOpening(true);
    setLinkError('');
    try {
      const opened = await webBrowserOpenWithPuTronClassGate(url);
      if (isCurrent() && !opened) setLinkError('目前無法開啟連結，請稍後再試。');
    } catch {
      if (isCurrent()) setLinkError('目前無法開啟連結，請稍後再試。');
    } finally {
      if (isCurrent()) setOpening(false);
      pending.current = false;
    }
  };
  const openMaterial = (title: string, url: string) => {
    if (!isCurrent() || !data) return;
    setLinkError('');
    safeNavigate(navigation, 'CourseMaterialViewer', {
      url,
      title,
      kind: 'material',
      courseName: data.name,
    });
  };
  const openGrading = () => {
    if (target?.source !== 'group' || !data?.canTeach) return;
    void open(`https://nuni.tw/teacher/course/${encodeURIComponent(target.groupId)}?school=${encodeURIComponent(schoolId)}`);
  };
  const openAssignment = (item: HubAssignment) => {
    if (!isCurrent() || !data || target?.source !== 'group') return;
    if (data.canTeach || item.submission?.kind === 'instructor') {
      openGrading();
      return;
    }
    const dueAt =
      item.dueAt && parseTaipeiInstant(item.dueAt) !== null ? item.dueAt : undefined;
    safeNavigate(navigation, 'HomeworkSubmit', {
      courseId: target.groupId,
      hwId: item.id,
      hwTitle: item.title,
      ...(dueAt ? { dueAt } : {}),
    });
  };
  const go = (screen: string) => {
    if (isCurrent() && data && target?.source === 'group')
      safeNavigate(navigation, screen, { groupId: target.groupId, groupName: data.name });
  };
  const assignments = data?.assignments.status === 'ready' ? data.assignments.items : [];
  const receiptSummary = summarizeCourseReceipts(assignments);
  const showStudentFilters = assignments.some((item) => item.submission?.kind !== 'instructor');
  const visibleAssignments = workFilter === 'all'
    ? assignments
    : assignments.filter((item) => workFilter === 'submitted'
      ? item.submission?.kind === 'submitted'
      : canListAsPendingWork(item.submission));
  const weekItems = weekAssignments(assignments);
  const receiptUnconfirmed = assignments.some(
    (item) =>
      item.submission?.kind === 'unavailable' || item.submission?.kind === 'unconfirmed',
  );
  const body = { ...theme.typography.body, color: theme.colors.muted };
  const gap = { gap: theme.space.md };
  return (
    <AIDetailScreen
      title={data?.name ?? '課程總覽'}
      subtitle={target?.source === 'tronclass' ? '校方 TronClass 課程' : 'Campus One 課程'}
      onBack={() => navigation?.goBack?.()}
      scrollRef={scrollRef}
    >
      <Text style={body}>來源：{target?.source === 'tronclass' ? '校方正式（TronClass）' : 'nuni 課程'} · 本次讀取：{checkedAt ? new Date(checkedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚未確認'}。進度按已確認的繳交紀錄計數；部分讀取失敗或紀錄待確認時，完整進度為未知。待評與未取得不當成零分。</Text>
      {!target || !uid ? (
        <AICard title={!uid ? '登入後查看課程' : '請先選擇課程'}>
          <View style={gap}>
            <Text style={body}>
              {!uid
                ? '請使用學校帳號登入，再從課程列表開啟。'
                : '這個連結沒有提供可辨識的課程，請回到列表重新選擇。'}
            </Text>
            <AIButton label="回到課程列表" onPress={() => safeNavigate(navigation, 'LearnHome')} />
          </View>
        </AICard>
      ) : loading ? (
        <AICard>
          <ActivityIndicator accessibilityLabel="讀取課程資料" color={theme.colors.accent} />
        </AICard>
      ) : error ? (
        <AICard title="目前無法讀取課程">
          <View style={gap}>
            <Text accessibilityRole="alert" style={body}>
              {error}
            </Text>
            <AIButton label="重新讀取課程" onPress={() => void load()} />
          </View>
        </AICard>
      ) : data ? (
        <>
          <View ref={weekRef} nativeID="week" testID="course-week" collapsable={false}>
          <AICard title="本週">
            <View style={gap}>
              {data.assignments.status === 'error' ? (
                <Text accessibilityRole="alert" style={body}>
                  無法讀取這門課的作業，請更新課程後再試。
                </Text>
              ) : null}
              {receiptUnconfirmed ? (
                <Text accessibilityRole="alert" style={body}>
                  部分繳交狀態暫時無法確認，請重新整理或開啟作業核對。
                </Text>
              ) : null}
              {weekItems.length ? (
                weekItems.map((item) => (
                  <View key={item.id} style={{ gap: 4 }}>
                    <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: '700' }}>
                      {item.title}
                    </Text>
                    <Text style={body}>
                      {'截止：' + formatTaipeiDateTime(item.dueAt!, { seconds: false })}
                    </Text>
                    <AIButton
                      label={'查看本週作業：' + item.title}
                      variant="ghost"
                      onPress={() => openAssignment(item)}
                    />
                  </View>
                ))
              ) : data.assignments.status === 'error' || receiptUnconfirmed ? null : (
                <Text style={body}>本週沒有待繳交的作業。</Text>
              )}
            </View>
          </AICard>
          </View>
          <AICard title="課程資訊">
            <View style={gap}>
              {data.details.length ? <Text style={body}>{data.details.join(' · ')}</Text> : null}
              <Text style={body}>
                {data.description ||
                  (target.source === 'tronclass'
                    ? '課程說明請見校方課程頁面。'
                    : '尚未提供課程說明。')}
              </Text>
              <AIButton label="更新課程資料" variant="ghost" onPress={() => void load()} />
            </View>
          </AICard>
          {target.source === 'tronclass' ? (
            <AICard title="校方課程內容">
              <View style={gap}>
                <Text style={body}>
                  教材、作業繳交、測驗與成績請在這門課的校方頁面查看；開啟後可能需要重新登入學校帳號。
                </Text>
                <AIButton
                  label="開啟校方課程"
                  disabled={opening}
                  onPress={() =>
                    void open(`https://tronclass.pu.edu.tw/course/${target.courseId}/content`)
                  }
                />
              </View>
            </AICard>
          ) : (
            <>
              <AICard title="課程入口">
                <View style={gap}>
                  {data.canTeach ? (
                    <>
                      <AIButton label="開啟網頁批改" disabled={opening} onPress={openGrading} />
                      <Text style={body}>在網頁查看學生繳交、評分與發布回饋；可能需要重新登入學校帳號。</Text>
                    </>
                  ) : null}
                  <AIButton
                    label="課程群組與公告"
                    variant="ghost"
                    onPress={() => go('GroupDetail')}
                  />
                  <AIButton label="測驗通知" variant="ghost" onPress={() => go('QuizCenter')} />
                  <AIButton
                    label="課程顧問"
                    variant="ghost"
                    onPress={() => go('AICourseAdvisor')}
                  />
                </View>
              </AICard>
              <AICard title="教材檔案">
                <View style={gap}>
                  <Text style={body}>
                    列出教師已發布的教材連結。目前沒有課程檔案上傳路徑，無法在 App 內傳檔。
                  </Text>
                  {data.materials.status === 'error' ? (
                    <Text accessibilityRole="alert" style={body}>
                      教材讀取失敗，請更新課程資料後重試。
                    </Text>
                  ) : data.materials.items.length === 0 ? (
                    <Text style={body}>尚未發布教材或單元。</Text>
                  ) : (
                    data.materials.items.map((item) => (
                      <View key={item.id} style={gap}>
                        <Text
                          style={{
                            ...theme.typography.body,
                            color: theme.colors.text,
                            fontWeight: '700',
                          }}
                        >
                          {item.title}
                        </Text>
                        {item.description ? <Text style={body}>{item.description}</Text> : null}
                        {item.url ? (
                          <AIButton
                            label={`開啟教材：${item.title}`}
                            variant="ghost"
                            onPress={() => openMaterial(item.title, item.url!)}
                          />
                        ) : (
                          <Text style={body}>這個單元未附教材連結。</Text>
                        )}
                      </View>
                    ))
                  )}
                </View>
              </AICard>
              <AICard title="作業與繳交">
                <View style={gap}>
                  {data.assignments.status === 'error' ? (
                    <Text accessibilityRole="alert" style={body}>
                      作業讀取失敗，請更新課程資料後重試。
                    </Text>
                  ) : data.assignments.items.length === 0 ? (
                    <Text style={body}>尚未發布作業。</Text>
                  ) : (
                    <>
                      <Text style={body}>可開啟作業詳情；可否繳交與提交狀態以課程設定及實際紀錄為準。</Text>
                      {showStudentFilters ? (
                        <>
                          <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text }}>
                            已繳交 {receiptSummary.submitted} · 已發布評分 {receiptSummary.graded} · 未繳交 {receiptSummary.unsubmitted}
                            {receiptSummary.needsVerification > 0
                              ? ` · 待確認 ${receiptSummary.needsVerification}` : ''}
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {([
                              ['all', '全部'],
                              ['unsubmitted', '未繳交'],
                              ['submitted', '已繳交'],
                            ] as const).map(([key, label]) => (
                              <AIButton
                                key={key}
                                label={label}
                                variant={workFilter === key ? undefined : 'ghost'}
                                onPress={() => setWorkFilter(key)}
                              />
                            ))}
                          </View>
                        </>
                      ) : null}
                      {!visibleAssignments.length ? (
                        <Text style={body}>這個分類目前沒有作業。</Text>
                      ) : null}
                      {visibleAssignments.map((item) => {
                        const overdue = overduePolicyText(item);
                        return (
                          <View key={item.id} style={gap}>
                            <Text
                              style={{
                                ...theme.typography.body,
                                color: theme.colors.text,
                                fontWeight: '700',
                              }}
                            >
                              {item.title}
                            </Text>
                            {item.description ? <Text style={body}>{item.description}</Text> : null}
                            <Text style={body}>{deadlineLabel(item)}</Text>
                            <Text style={{ ...theme.typography.bodySmall, color: theme.colors.textSecondary }}>
                              {submissionStatusText(item.submission)}
                            </Text>
                            {overdue ? (
                              <Text style={{ ...theme.typography.bodySmall, color: theme.colors.warning }}>
                                {overdue}
                              </Text>
                            ) : null}
                            {item.submission?.kind === 'submitted' && item.submission.grade?.feedback ? (
                              <Text style={body}>教師回饋：{item.submission.grade.feedback}</Text>
                            ) : null}
                            <AIButton
                              label={
                                (item.submission?.kind === 'instructor'
                                  ? '開啟網頁批改：'
                                  : item.submission?.kind === 'submitted'
                                    ? '查看繳交紀錄：'
                                  : item.closed ? '查看已關閉作業：' : '查看作業：') + item.title
                              }
                              variant="ghost"
                              onPress={() => openAssignment(item)}
                            />
                          </View>
                        );
                      })}
                    </>
                  )}
                </View>
              </AICard>
            </>
          )}
          {linkError ? (
            <AICard>
              <Text accessibilityRole="alert" style={body}>
                {linkError}
              </Text>
            </AICard>
          ) : null}
        </>
      ) : null}
    </AIDetailScreen>
  );
}
