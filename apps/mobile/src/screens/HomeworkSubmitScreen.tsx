import React, { useCallback, useMemo, useState } from 'react';
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
import { useDataSource } from '../hooks/useDataSource';
import type { Assignment, Submission } from '../data/types';
import {
  publishedAssignmentGrade,
  type PublishedAssignmentGrade,
} from '../data/assignmentGrade';
import { onAssignmentSubmitted } from '../services/companionHooks';
import { safeNavigate } from '../utils/safeNavigate';

type RouteParams = {
  courseId?: string;
  groupId?: string;
  hwId?: string;
  assignmentId?: string;
  hwTitle?: string;
  title?: string;
  dueAt?: string;
  description?: string;
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

export default function HomeworkSubmitScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const ds = useDataSource();
  const params = props.route?.params ?? {};
  const courseId = asText(params.courseId || params.groupId);
  const hwId = asText(params.hwId || params.assignmentId);
  const uid = auth.user?.uid ?? '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState(asText(params.hwTitle || params.title, '作業繳交'));
  const [description, setDescription] = useState(asText(params.description));
  const [dueAt, setDueAt] = useState(asText(params.dueAt) || null);
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
    setLoading(true);
    setError('');
    try {
      if (!courseId || !hwId) throw new Error('找不到這份作業。');
      if (!uid) throw new Error('請先登入。');
      const [assignment, submission] = await Promise.all([
        ds.getAssignment(hwId, courseId) as Promise<AssignmentRecord | null>,
        ds.getSubmission(hwId, uid, courseId) as Promise<Submission | null>,
      ]);
      if (!assignment) throw new Error('找不到這份作業，或你尚未加入這門課。');
      const status = asText(assignment.status);
      const type = asText(assignment.type);
      setTitle(asText(assignment.title, asText(params.hwTitle || params.title, '作業繳交')));
      setDescription(asText(assignment.description, asText(params.description)));
      setDueAt(asText(assignment.dueAt) || asText(params.dueAt) || null);
      setAllowLate(assignment.allowLateSubmission === true);
      setUnpublished(assignment.published === false || status === 'draft');
      setClosed(status === 'closed');
      setQuizLike(['quiz', 'exam'].includes(type));
      setPoints(
        typeof assignment.points === 'number' && Number.isFinite(assignment.points)
          ? assignment.points
          : null,
      );
      setGrade(publishedAssignmentGrade(submission as unknown as Record<string, unknown>));
      const already = asText(submission?.submittedAt) || null;
      setSubmittedAt(already);
      setAnswer(already ? asText(submission?.content) : '');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [courseId, ds, hwId, params.description, params.hwTitle, params.title, params.dueAt, uid]);

  const fileSubmit =
    process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED === 'true';
  const classWorkspaceFileSubmit =
    fileSubmit && courseId.startsWith('cw_') && hwId.startsWith('cwa_');

  useFocusEffect(
    useCallback(() => {
      if (classWorkspaceFileSubmit) {
        safeNavigate(navigation, 'NuniWorkspace', {
          tab: 'courses',
          workspaceId: courseId,
          assignmentId: hwId,
        });
        return;
      }
      void load();
    }, [classWorkspaceFileSubmit, courseId, hwId, load, navigation]),
  );

  const dueText = useMemo(() => {
    if (!dueAt) return '';
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due)) return '';
    const diffH = (due - Date.now()) / (1000 * 60 * 60);
    if (diffH < 0) return `已截止`;
    if (diffH < 24) return `${Math.max(1, Math.round(diffH))} 小時後截止`;
    return `${Math.round(diffH / 24)} 天後截止`;
  }, [dueAt]);

  const overdueLocked = useMemo(() => {
    if (!dueAt) return false;
    const due = Date.parse(dueAt);
    return Number.isFinite(due) && due < Date.now() && !allowLate;
  }, [allowLate, dueAt]);

  const blocked = unpublished || closed || overdueLocked || quizLike || !!submittedAt;
  const overdue = useMemo(() => {
    if (!dueAt) return false;
    const due = Date.parse(dueAt);
    return Number.isFinite(due) && due < Date.now();
  }, [dueAt]);

  const handleSubmit = useCallback(async () => {
    const text = answer.trim();
    if (!text || text.length > 20000) {
      Alert.alert('請先寫作業內容', '請輸入 1 至 20,000 字，再送出。');
      return;
    }
    setSubmitting(true);
    try {
      await ds.submitAssignment({
        assignmentId: hwId,
        userId: uid,
        groupId: courseId,
        content: text,
      });
      onAssignmentSubmitted({ uid, assignmentId: hwId });
      setSubmittedAt(new Date().toISOString());
      Alert.alert('已繳交', '這份作業已寫入與網站相同的繳交紀錄。', [
        { text: '返回', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }, [answer, courseId, ds, hwId, navigation, uid]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F2F2F7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 12,
            padding: 16,
            borderLeftWidth: 4,
            borderLeftColor: overdue ? '#D70015' : '#003F8A',
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1C1E' }}>{title}</Text>
          {dueText ? (
            <Text
              style={{
                fontSize: 13,
                color: overdue ? '#D70015' : '#8E8E93',
                marginTop: 4,
              }}
            >
              {dueText}
            </Text>
          ) : (
            <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 4 }}>未設截止時間</Text>
          )}
          {description ? (
            <Text style={{ marginTop: 12, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
              {description}
            </Text>
          ) : (
            <Text style={{ marginTop: 12, fontSize: 14, color: '#8E8E93', lineHeight: 22 }}>
              教師尚未填寫作業說明。
            </Text>
          )}
        </View>

        {classWorkspaceFileSubmit ? (
          <View
            style={{
              marginTop: 16,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
              正在前往可傳檔的作業繳交…
            </Text>
          </View>
        ) : loading ? (
          <View style={{ marginTop: 24, alignItems: 'center' }}>
            <ActivityIndicator color="#003F8A" />
            <Text style={{ marginTop: 8, color: '#8E8E93' }}>讀取作業中</Text>
          </View>
        ) : error ? (
          <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16 }}>
            <Text style={{ color: '#D70015', lineHeight: 22 }}>{error}</Text>
            <Pressable
              onPress={() => void load()}
              style={{ marginTop: 12, alignItems: 'center', padding: 12 }}
            >
              <Text style={{ color: '#003F8A', fontWeight: '600' }}>重新讀取</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View
              style={{
                marginTop: 16,
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>繳交方式</Text>
              <Text style={{ marginTop: 6, fontSize: 13, color: '#3C3C43', lineHeight: 20 }}>
                目前只支援文字繳交，與網站寫入同一份作業紀錄。作業檔案還沒接到上傳流程，無法從
                App 傳檔。
              </Text>
            </View>
            {quizLike ? (
              <Text style={{ marginTop: 16, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
                請透過評量頁面作答。
              </Text>
            ) : unpublished ? (
              <Text style={{ marginTop: 16, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
                此作業尚未開放。
              </Text>
            ) : submittedAt ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E', marginBottom: 6 }}>
                  已繳交內容
                </Text>
                <Text
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 14,
                    color: '#1C1C1E',
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
                      backgroundColor: '#fff',
                      borderRadius: 12,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: '#E5E5EA',
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#1C1C1E' }}>
                      教師已評分：{grade.score}
                      {points !== null ? ` / ${points}` : ''} 分
                    </Text>
                    {grade.revisionCount > 0 ? (
                      <Text style={{ marginTop: 8, fontSize: 13, color: '#3C3C43', lineHeight: 20 }}>
                        此筆評分已更正 {grade.revisionCount} 次，顯示目前已發布的結果。
                      </Text>
                    ) : null}
                    {grade.feedback ? (
                      <Text style={{ marginTop: 8, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
                        {grade.feedback}
                      </Text>
                    ) : null}
                    {grade.publishedAt ? (
                      <Text style={{ marginTop: 8, fontSize: 12, color: '#8E8E93' }}>
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
                      backgroundColor: '#fff',
                      borderRadius: 12,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: '#E5E5EA',
                    }}
                  >
                    <Text style={{ fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
                      作業已收到；老師公布評分後，會顯示在這裡。
                    </Text>
                  </View>
                )}
                <View
                  style={{
                    marginTop: 16,
                    padding: 14,
                    backgroundColor: grade ? '#dcfce7' : '#e8f1ff',
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      color: grade ? '#166534' : '#003F8A',
                      fontSize: 14,
                      fontWeight: '600',
                      textAlign: 'center',
                    }}
                  >
                    {grade ? '已繳交 · 教師已發布評分' : '已繳交 · 等待老師評分'}
                  </Text>
                </View>
              </View>
            ) : closed || overdueLocked ? (
              <Text style={{ marginTop: 16, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
                作業已截止。如需補交，請聯絡授課教師。
              </Text>
            ) : (
              <>
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E', marginBottom: 6 }}>
                    文字作業內容
                  </Text>
                  <TextInput
                    value={answer}
                    onChangeText={setAnswer}
                    placeholder="在這裡寫下作業內容"
                    multiline
                    numberOfLines={8}
                    maxLength={20000}
                    editable={!blocked && !submitting}
                    accessibilityLabel="文字作業內容"
                    style={{
                      backgroundColor: '#fff',
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 14,
                      color: '#1C1C1E',
                      minHeight: 160,
                      textAlignVertical: 'top',
                      borderWidth: 1,
                      borderColor: '#E5E5EA',
                    }}
                  />
                </View>
                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting || !answer.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="繳交作業"
                  style={{
                    marginTop: 24,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: '#003F8A',
                    alignItems: 'center',
                    opacity: submitting || !answer.trim() ? 0.6 : 1,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>繳交作業</Text>
                  )}
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
