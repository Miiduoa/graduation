import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { getThemeVersion, subscribeToTheme, theme } from '../ui/theme';
import { useDataSource } from '../hooks/useDataSource';
import type { Assignment, Submission } from '../data/types';
import { getDataSourceEvidence } from '../data/source';
import {
  publishedAssignmentGrade,
  type PublishedAssignmentGrade,
} from '../data/assignmentGrade';
import { onAssignmentSubmitted } from '../services/companionHooks';
import { safeNavigate } from '../utils/safeNavigate';
import { revealAssignmentSubmitArea } from './nuni/scrollAssignment';

type RouteParams = {
  courseId?: string;
  groupId?: string;
  hwId?: string;
  assignmentId?: string;
  hwTitle?: string;
  title?: string;
  dueAt?: string;
  description?: string;
  scrollToSubmit?: boolean;
  fromReminder?: boolean;
};

type RouteProps = {
  route?: {
    params?: RouteParams;
  };
};

type AssignmentRecord = Assignment & {
  published?: boolean;
  status?: string;
  allowLateSubmission?: boolean;
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

const DEMO_SUBMISSION_MESSAGE = '目前使用示範資料，無法查看正式繳交紀錄或繳交作業。請切換至正式課程後再試。';

function usesDemoData(): boolean {
  const evidence = getDataSourceEvidence();
  return evidence?.mode === 'mock' || evidence?.sourceLabel === 'mock';
}

function receiptInstant(value: unknown): string | null {
  try {
    const source = value && typeof value === 'object' && 'toDate' in value
      ? (value as { toDate: () => Date }).toDate()
      : value;
    if (typeof source !== 'string' && typeof source !== 'number' && !(source instanceof Date)) return null;
    const time = parseTaipeiInstant(source);
    return time === null ? null : new Date(time).toISOString();
  } catch {
    return null;
  }
}

export default function HomeworkSubmitScreen(props: RouteProps) {
  const { user } = useAuth();
  const { school } = useSchool();
  const params = props.route?.params ?? {};
  const scopeKey = JSON.stringify([
    user?.uid, school.id, params.courseId || params.groupId, params.hwId || params.assignmentId,
  ]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return <HomeworkSubmitContent key={scopeKey} {...props} uid={user?.uid ?? ''}
    scopeKey={scopeKey} activeScope={activeScope} />;
}

function HomeworkSubmitContent({ route, uid, scopeKey, activeScope }: RouteProps & {
  uid: string;
  scopeKey: string;
  activeScope: React.MutableRefObject<string>;
}) {
  const navigation = useNavigation<any>();
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const ds = useDataSource();
  const params = route?.params ?? {};
  const courseId = asText(params.courseId || params.groupId);
  const hwId = asText(params.hwId || params.assignmentId);
  const focused = useRef(false);
  const generation = useRef(0);
  const pendingSubmit = useRef(false);
  const answerEdited = useRef(false);
  const isCurrent = useCallback(
    () => focused.current && activeScope.current === scopeKey,
    [activeScope, scopeKey],
  );
  const matchesReceipt = useCallback((receipt: Submission | null | undefined) => Boolean(
    receipt && receipt.id && receipt.assignmentId === hwId && receipt.userId === uid &&
    receipt.groupId === courseId,
  ), [courseId, hwId, uid]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('作業繳交');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [invalidDeadline, setInvalidDeadline] = useState(false);
  const [receiptUnconfirmed, setReceiptUnconfirmed] = useState(false);
  const [allowLate, setAllowLate] = useState(false);
  const [closed, setClosed] = useState(false);
  const [unpublished, setUnpublished] = useState(false);
  const [quizLike, setQuizLike] = useState(false);
  const [answer, setAnswer] = useState('');
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [points, setPoints] = useState<number | null>(null);
  const [grade, setGrade] = useState<PublishedAssignmentGrade | null>(null);

  const load = useCallback(async () => {
    if (!isCurrent()) return;
    if (pendingSubmit.current) {
      setLoading(false);
      setReceiptUnconfirmed(true);
      return;
    }
    const request = ++generation.current;
    const current = () => isCurrent() && request === generation.current;
    setLoading(true);
    setError('');
    try {
      if (usesDemoData()) throw new Error(DEMO_SUBMISSION_MESSAGE);
      if (!courseId || !hwId) throw new Error('找不到這份作業。');
      if (!uid) throw new Error('請先登入。');
      const [assignment, submission] = await Promise.all([
        ds.getAssignment(hwId, courseId) as Promise<AssignmentRecord | null>,
        ds.getSubmission(hwId, uid, courseId) as Promise<Submission | null>,
      ]);
      if (!current()) return;
      if (usesDemoData()) throw new Error(DEMO_SUBMISSION_MESSAGE);
      if (!assignment || assignment.id !== hwId || assignment.groupId !== courseId) {
        if (params.fromReminder) {
          Alert.alert('無法開啟作業', '作業已移除，或你目前沒有這門課的權限。');
          safeNavigate(navigation, 'LearnHome');
          return;
        }
        throw new Error('找不到這份作業，或你尚未加入這門課。');
      }
      if (submission && !matchesReceipt(submission))
        throw new Error('繳交紀錄與這份作業不符，請重新讀取確認。');
      const status = asText(assignment.status);
      const type = asText(assignment.type);
      setTitle(asText(assignment.title, '作業繳交'));
      setDescription(asText(assignment.description));
      const deadline = receiptInstant(assignment.dueAt);
      setDueAt(deadline);
      setInvalidDeadline(assignment.dueAt != null && deadline === null);
      setAllowLate(assignment.allowLateSubmission === true);
      setUnpublished(assignment.published === false || ['draft', 'retracted', 'archived', 'deleted'].includes(status));
      setClosed(status === 'closed');
      setQuizLike(['quiz', 'exam'].includes(type));
      setPoints(
        typeof assignment.points === 'number' && Number.isFinite(assignment.points)
          ? assignment.points
          : null,
      );
      const already = receiptInstant(submission?.submittedAt);
      setGrade(already ? publishedAssignmentGrade(submission as unknown as Record<string, unknown>) : null);
      setSubmittedAt(already);
      const serverDraft = asText(submission?.status) === 'draft' && submission?.submittedAt == null;
      setReceiptUnconfirmed(Boolean(submission && !already && !serverDraft));
      // Keep local edits, including an intentionally empty answer, when refreshing a draft.
      if (already || (serverDraft && !answerEdited.current)) setAnswer(asText(submission?.content));
    } catch (e) {
      if (current()) {
        const message = String((e as Error)?.message ?? e);
        if (params.fromReminder && /permission|denied|權限|尚未加入/i.test(message)) {
          Alert.alert('無法開啟作業', '你目前沒有這份作業的權限，請從課程頁重新確認。');
          safeNavigate(navigation, 'LearnHome');
        } else setError(message);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [courseId, ds, hwId, isCurrent, matchesReceipt, navigation, params.fromReminder, uid]);

  const fileSubmit =
    process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED === 'true';
  const classWorkspaceFileSubmit =
    fileSubmit && courseId.startsWith('cw_') && hwId.startsWith('cwa_');

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (classWorkspaceFileSubmit) {
        safeNavigate(navigation, 'NuniWorkspace', {
          tab: 'courses',
          workspaceId: courseId,
          assignmentId: hwId,
        });
        return () => { focused.current = false; generation.current += 1; };
      }
      void load();
      return () => {
        focused.current = false;
        generation.current += 1;
      };
    }, [classWorkspaceFileSubmit, courseId, hwId, load, navigation]),
  );

  const dueText = useMemo(() => {
    if (invalidDeadline) return '截止時間無法確認';
    if (!dueAt) return '';
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due)) return '';
    const diffH = (due - Date.now()) / (1000 * 60 * 60);
    if (diffH < 0) return `已截止`;
    if (diffH < 24) return `${Math.max(1, Math.round(diffH))} 小時後截止`;
    return `${Math.round(diffH / 24)} 天後截止`;
  }, [dueAt, invalidDeadline]);

  const overdueLocked = useMemo(() => {
    if (!dueAt) return false;
    const due = Date.parse(dueAt);
    return Number.isFinite(due) && due < Date.now() && !allowLate;
  }, [allowLate, dueAt]);

  const blocked = unpublished || closed || overdueLocked || invalidDeadline || receiptUnconfirmed || quizLike || !!submittedAt;
  const scrollRef = useRef<ScrollView | null>(null);
  const submitRef = useRef<View | null>(null);
  const scrollOffset = useRef(0);
  useEffect(() => {
    if (!params.scrollToSubmit || loading) return;
    const timer = setTimeout(() => {
      revealAssignmentSubmitArea(scrollRef.current, submitRef.current, {
        contentOffsetY: scrollOffset.current, isActive: isCurrent,
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [isCurrent, loading, params.scrollToSubmit]);
  const overdue = useMemo(() => {
    if (!dueAt) return false;
    const due = Date.parse(dueAt);
    return Number.isFinite(due) && due < Date.now();
  }, [dueAt]);

  const handleSubmit = useCallback(async () => {
    if (!isCurrent() || pendingSubmit.current || loading || blocked) return;
    if (usesDemoData()) { setError(DEMO_SUBMISSION_MESSAGE); return; }
    if (dueAt && Date.parse(dueAt) < Date.now() && !allowLate) {
      Alert.alert('作業已截止', '如需補交，請聯絡授課教師。');
      return;
    }
    const text = answer.trim();
    if (!text || text.length > 20000) {
      Alert.alert('請先寫作業內容', '請輸入 1 至 20,000 字，再送出。');
      return;
    }
    pendingSubmit.current = true;
    const request = ++generation.current;
    const current = () => isCurrent() && request === generation.current;
    setSubmitting(true);
    try {
      const receipt = await ds.submitAssignment({
        assignmentId: hwId,
        userId: uid,
        groupId: courseId,
        content: text,
      });
      if (!current()) return;
      if (usesDemoData()) throw new Error(DEMO_SUBMISSION_MESSAGE);
      const confirmedAt = receiptInstant(receipt?.submittedAt);
      if (!matchesReceipt(receipt) || !confirmedAt || receipt.content !== text || receipt.status !== 'submitted') {
        setReceiptUnconfirmed(true);
        throw new Error('伺服器尚未回傳可核對的繳交紀錄。內容已保留，請重新核對後再操作。');
      }
      setSubmittedAt(confirmedAt);
      setAnswer(receipt.content);
      setGrade(publishedAssignmentGrade(receipt as unknown as Record<string, unknown>));
      onAssignmentSubmitted({ uid, assignmentId: hwId });
      Alert.alert('已繳交', '伺服器已確認收到這份作業。', [
        { text: '返回', onPress: () => { if (current()) navigation.goBack(); } },
      ]);
    } catch (e) {
      if (current()) {
        setReceiptUnconfirmed(true);
        Alert.alert('繳交尚未確認', String((e as Error)?.message ?? e));
      }
    } finally {
      pendingSubmit.current = false;
      if (isCurrent()) {
        setSubmitting(false);
        if (!current()) setReceiptUnconfirmed(true);
      }
    }
  }, [allowLate, answer, blocked, courseId, ds, dueAt, hwId, isCurrent, loading, matchesReceipt, navigation, uid]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            borderLeftWidth: 4,
            borderLeftColor: overdue ? theme.colors.danger : theme.colors.accent,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>{title}</Text>
          {dueText ? (
            <Text
              style={{
                fontSize: 13,
                color: overdue ? theme.colors.danger : theme.colors.muted,
                marginTop: 4,
              }}
            >
              {dueText}
            </Text>
          ) : (
            <Text style={{ fontSize: 13, color: theme.colors.muted, marginTop: 4 }}>未設截止時間</Text>
          )}
          {description ? (
            <Text style={{ marginTop: 12, fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
              {description}
            </Text>
          ) : (
            <Text style={{ marginTop: 12, fontSize: 14, color: theme.colors.muted, lineHeight: 22 }}>
              教師尚未填寫作業說明。
            </Text>
          )}
        </View>

        {classWorkspaceFileSubmit ? (
          <View
            style={{
              marginTop: 16,
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
              正在前往可傳檔的作業繳交…
            </Text>
          </View>
        ) : loading ? (
          <View style={{ marginTop: 24, alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={{ marginTop: 8, color: theme.colors.muted }}>讀取作業中</Text>
          </View>
        ) : error ? (
          <View style={{ marginTop: 16, backgroundColor: theme.colors.surface, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: theme.colors.danger, lineHeight: 22 }}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => safeNavigate(navigation, 'LearnHome')}>
              <Text style={{ color: theme.colors.accent, marginTop: 12 }}>返回課程</Text>
            </Pressable>
            <Pressable
              onPress={() => void load()}
              style={{ marginTop: 12, alignItems: 'center', padding: 12 }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>重新讀取</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View
              style={{
                marginTop: 16,
                backgroundColor: theme.colors.surface,
                borderRadius: 12,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>繳交方式</Text>
              <Text style={{ marginTop: 6, fontSize: 13, color: theme.colors.textSecondary, lineHeight: 20 }}>
                目前只支援文字繳交，與網站寫入同一份作業紀錄。作業檔案還沒接到上傳流程，無法從
                App 傳檔。
              </Text>
            </View>
            {quizLike ? (
              <Text style={{ marginTop: 16, fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
                請透過評量頁面作答。
              </Text>
            ) : unpublished ? (
              <Text style={{ marginTop: 16, fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
                此作業尚未開放。
              </Text>
            ) : submittedAt ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 6 }}>
                  已繳交內容
                </Text>
                <Text style={{ fontSize: 13, color: theme.colors.muted, marginBottom: 12 }}>
                  繳交時間：{formatTaipeiDateTime(submittedAt)}
                </Text>
                <Text
                  style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 14,
                    color: theme.colors.text,
                    lineHeight: 22,
                  }}
                >
                  {answer || '（無文字內容）'}
                </Text>
                {grade ? (
                  <View
                    accessibilityLabel="作業評分"
                    style={{
                      marginTop: 16,
                      backgroundColor: theme.colors.surface,
                      borderRadius: 12,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.text }}>
                      教師已評分：{grade.score}
                      {points !== null ? ` / ${points}` : ''} 分
                    </Text>
                    {grade.revisionCount > 0 ? (
                      <Text style={{ marginTop: 8, fontSize: 13, color: theme.colors.textSecondary, lineHeight: 20 }}>
                        此筆評分已更正 {grade.revisionCount} 次，顯示目前已發布的結果。
                      </Text>
                    ) : null}
                    {grade.feedback ? (
                      <Text style={{ marginTop: 8, fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
                        {grade.feedback}
                      </Text>
                    ) : null}
                    {grade.publishedAt ? (
                      <Text style={{ marginTop: 8, fontSize: 12, color: theme.colors.muted }}>
                        發布時間：
                        {new Date(grade.publishedAt).toLocaleString('zh-TW', {
                          timeZone: 'Asia/Taipei',
                        })}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <View
                    style={{
                      marginTop: 16,
                      backgroundColor: theme.colors.surface,
                      borderRadius: 12,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
                      作業已收到；老師公布評分後，會顯示在這裡。
                    </Text>
                  </View>
                )}
                <View
                  style={{
                    marginTop: 16,
                    padding: 14,
                    backgroundColor: grade ? theme.colors.successSoft : theme.colors.infoSoft,
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      color: grade ? theme.colors.success : theme.colors.accent,
                      fontSize: 14,
                      fontWeight: '600',
                      textAlign: 'center',
                    }}
                  >
                    {grade ? '已繳交 · 教師已發布評分' : '已繳交 · 等待老師評分'}
                  </Text>
                </View>
              </View>
            ) : receiptUnconfirmed ? (
              <View style={{ marginTop: 16 }}>
                <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
                  繳交狀態尚未確認，請先核對紀錄，避免重複送出。
                </Text>
                {answer ? <Text style={{ marginTop: 12, color: theme.colors.text }}>{answer}</Text> : null}
                <Pressable onPress={() => void load()} accessibilityRole="button" disabled={submitting}
                  style={{ marginTop: 12, padding: 12 }}>
                  <Text style={{ color: theme.colors.accent }}>重新核對繳交紀錄</Text>
                </Pressable>
              </View>
            ) : invalidDeadline ? (
              <Text accessibilityRole="alert" style={{ marginTop: 16, color: theme.colors.textSecondary, lineHeight: 22 }}>
                目前無法確認截止時間，請重新開啟作業或聯絡授課教師。
              </Text>
            ) : closed || overdueLocked ? (
              <Text style={{ marginTop: 16, fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
                作業已截止。如需補交，請聯絡授課教師。
              </Text>
            ) : (
              <View ref={submitRef} collapsable={false}>
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 6 }}>
                    文字作業內容
                  </Text>
                  <TextInput
                    placeholderTextColor={theme.colors.muted}
                    value={answer}
                    onChangeText={(text) => { answerEdited.current = true; setAnswer(text); }}
                    placeholder="在這裡寫下作業內容"
                    multiline
                    numberOfLines={8}
                    maxLength={20000}
                    editable={!blocked && !submitting}
                    accessibilityLabel="文字作業內容"
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 14,
                      color: theme.colors.text,
                      minHeight: 160,
                      textAlignVertical: 'top',
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  />
                </View>
                <Pressable
                  onPress={handleSubmit}
                  disabled={blocked || submitting || !answer.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="繳交作業"
                  style={{
                    marginTop: 24,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: theme.colors.accent,
                    alignItems: 'center',
                    opacity: submitting || !answer.trim() ? 0.6 : 1,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color={theme.colors.onAccent} />
                  ) : (
                    <Text style={{ color: theme.colors.onAccent, fontSize: 16, fontWeight: '700' }}>繳交作業</Text>
                  )}
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
