/**
 * Homework Submit Screen — 本地作業繳交，取代 TronClass webview。
 *
 * 對應 TronClass 端點：POST /courses/{id}/homework/{hwId}/submissions
 * 本地能做：看題目 / 寫文字答案 / 附加檔案 / 看附件 / 看分數與回饋 / 重交 / 撤回
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../state/auth';
import { simulateStudentSubmit } from '../services/demoActionSimulator';
import { getTeacherUidForCourse } from '../data/demoUserStories';

type RouteProps = {
  route?: {
    params?: {
      courseId?: string;
      hwId?: string;
      hwTitle?: string;
      dueAt?: string;
      description?: string;
      currentScore?: number | null;
      feedback?: string | null;
    };
  };
};

interface Attachment {
  id: string;
  name: string;
  uri: string;
  size?: number;
  type?: string;
}

export default function HomeworkSubmitScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const courseId = props.route?.params?.courseId ?? '';
  const hwId = props.route?.params?.hwId ?? '';
  const hwTitle = props.route?.params?.hwTitle ?? '作業繳交';
  const dueAt = props.route?.params?.dueAt;
  const description = props.route?.params?.description ?? '';
  const currentScore = props.route?.params?.currentScore ?? null;
  const feedback = props.route?.params?.feedback ?? '';

  const [answer, setAnswer] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(currentScore !== null);

  const dueText = useMemo(() => {
    if (!dueAt) return '';
    const d = new Date(dueAt);
    const now = new Date();
    const diffH = (d.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (diffH < 0) return `已截止 ${Math.abs(Math.round(diffH))} 小時`;
    if (diffH < 24) return `${Math.round(diffH)} 小時後截止`;
    return `${Math.round(diffH / 24)} 天後截止`;
  }, [dueAt]);

  const overdue = useMemo(() => {
    if (!dueAt) return false;
    return new Date(dueAt).getTime() < Date.now();
  }, [dueAt]);

  const handlePickFile = useCallback(async () => {
    try {
      // 動態載入 expo-document-picker，避免 build 期 import
      const DocumentPicker = await import('expo-document-picker').catch(() => null);
      if (!DocumentPicker) {
        Alert.alert('檔案選取功能尚未安裝', '請聯絡開發者執行 npx expo install expo-document-picker');
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const att: Attachment = {
        id: `att_${Date.now()}`,
        name: asset.name,
        uri: asset.uri,
        size: asset.size,
        type: asset.mimeType ?? undefined,
      };
      setAttachments((a) => [...a, att]);
    } catch (e) {
      Alert.alert('附加檔案失敗', String((e as Error)?.message ?? e));
    }
  }, []);

  const handleRemoveAttachment = (id: string) => {
    setAttachments((a) => a.filter((x) => x.id !== id));
  };

  const handleSubmit = useCallback(async () => {
    if (!answer.trim() && attachments.length === 0) {
      Alert.alert('還沒有內容', '請至少寫一段文字或附加一個檔案再送出。');
      return;
    }
    if (overdue) {
      Alert.alert(
        '此作業已截止',
        '系統仍會嘗試送出，但老師收到的紀錄會標記為「遲交」。確定要送出嗎？',
        [
          { text: '再想想', style: 'cancel' },
          { text: '仍然送出', style: 'destructive', onPress: () => doSubmit() },
        ],
      );
      return;
    }
    doSubmit();
  }, [answer, attachments, overdue]);

  const doSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      // ─ Demo 模式：emit cross-role event 給老師（取代 TronClass 提交）─
      const numericCourseId = Number(String(courseId).replace(/^tc:/, '')) || 0;
      const numericHwId = Number(String(hwId).replace(/^tc:/, '')) || 0;
      await simulateStudentSubmit({
        studentUid: auth.user?.uid ?? 'demo_student_kuchih',
        studentName: auth.profile?.displayName ?? '顧晉瑋',
        teacherUid: getTeacherUidForCourse(courseId),
        courseId: numericCourseId,
        courseName: hwTitle.split(' ')[0] ?? '課程',
        homeworkId: numericHwId,
        homeworkTitle: hwTitle,
        isLate: !!overdue,
      });

      // 紀錄 companion signal
      try {
        const { onAssignmentSubmitted } = await import('../services/companionHooks');
        onAssignmentSubmitted({ assignmentId: hwId });
      } catch {
        /* swallow */
      }

      setSubmitted(true);
      Alert.alert(
        '✅ 已送出',
        `${hwTitle} 已成功繳交${overdue ? '（標記為遲交）' : ''}。\n老師端會收到即時通知。`,
        [{ text: '回課程', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }, [answer, attachments, courseId, hwId, hwTitle, navigation, overdue, auth.user?.uid, auth.profile?.displayName]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F2F2F7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* ── 作業標題 ── */}
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 12,
            padding: 16,
            borderLeftWidth: 4,
            borderLeftColor: overdue ? '#D70015' : '#003F8A',
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1C1E' }}>{hwTitle}</Text>
          {dueText ? (
            <Text
              style={{
                fontSize: 13,
                color: overdue ? '#D70015' : '#8E8E93',
                marginTop: 4,
              }}
            >
              {overdue ? '⏰ ' : '📅 '}
              {dueText}
            </Text>
          ) : null}
          {description ? (
            <Text style={{ marginTop: 12, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
              {description}
            </Text>
          ) : null}
        </View>

        {/* ── 已批改回饋 ── */}
        {currentScore !== null && (
          <View
            style={{
              marginTop: 12,
              backgroundColor: currentScore >= 60 ? '#dcfce7' : '#fee2e2',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C1C1E' }}>
              老師已批改：{currentScore} 分
            </Text>
            {feedback ? (
              <Text style={{ marginTop: 6, fontSize: 13, color: '#3C3C43' }}>
                💬 {feedback}
              </Text>
            ) : null}
          </View>
        )}

        {/* ── 答案輸入區 ── */}
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E', marginBottom: 6 }}>
            你的答案
          </Text>
          <TextInput
            value={answer}
            onChangeText={setAnswer}
            placeholder="在這裡寫下你的答案、論述、心得⋯⋯"
            multiline
            numberOfLines={8}
            editable={!submitted}
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

        {/* ── 附件 ── */}
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>
              附加檔案 ({attachments.length})
            </Text>
            {!submitted && (
              <Pressable onPress={handlePickFile} hitSlop={8}>
                <Text style={{ color: '#003F8A', fontSize: 13, fontWeight: '600' }}>
                  + 加檔案
                </Text>
              </Pressable>
            )}
          </View>
          {attachments.map((att) => (
            <View
              key={att.id}
              style={{
                backgroundColor: '#fff',
                padding: 10,
                borderRadius: 8,
                marginTop: 6,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderWidth: 1,
                borderColor: '#E5E5EA',
              }}
            >
              <Ionicons name="document-outline" size={18} color="#8E8E93" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: '#1C1C1E' }} numberOfLines={1}>
                  {att.name}
                </Text>
                <Text style={{ fontSize: 11, color: '#8E8E93' }}>
                  {att.type ?? '檔案'} {att.size ? `・ ${Math.round(att.size / 1024)} KB` : ''}
                </Text>
              </View>
              {!submitted && (
                <Pressable onPress={() => handleRemoveAttachment(att.id)} hitSlop={8}>
                  <Ionicons name="close-circle" size={20} color="#D70015" />
                </Pressable>
              )}
            </View>
          ))}
          {attachments.length === 0 && (
            <Text style={{ fontSize: 12, color: '#8E8E93', fontStyle: 'italic', marginTop: 4 }}>
              還沒附加任何檔案。可附 PDF、Word、圖片等。
            </Text>
          )}
        </View>

        {/* ── 送出鈕 ── */}
        {!submitted && (
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={{
              marginTop: 24,
              padding: 14,
              borderRadius: 12,
              backgroundColor: overdue ? '#FF9500' : '#003F8A',
              alignItems: 'center',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {overdue ? '⏰ 仍然送出（標記遲交）' : '✅ 送出作業'}
              </Text>
            )}
          </Pressable>
        )}
        {submitted && (
          <View style={{ marginTop: 24, padding: 14, backgroundColor: '#dcfce7', borderRadius: 12 }}>
            <Text style={{ color: '#166534', fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
              ✅ 你已繳交此作業
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
