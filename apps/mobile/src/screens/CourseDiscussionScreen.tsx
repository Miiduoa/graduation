/**
 * Course Discussion Screen — 課程討論串本地畫面
 *
 * 對應 TronClass endpoint：GET /courses/{id}/discussions  → tcFetchDiscussions
 *                          GET /courses/{id}/discussions/{did}/posts → tcFetchDiscussionPosts
 *                          POST /courses/{id}/discussions → tcCreateDiscussion (本檔新增)
 *
 * 使用真實資料；空資料時顯示空狀態而非 mock。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  tcFetchDiscussions,
  tcPostDiscussion,
  type TCDiscussion,
} from '../services/tronClassClient';
import { isDemoCourseId, demoFetchDiscussions } from '../data/demoCoursesAdapter';
import { theme } from '../ui/theme';
import { EmptyState } from '../ui/components';
import { useAuth } from '../state/auth';
import { emitDiscussionPosted, emitHelpRequested } from '../services/roleEventBus';
import {
  CourseChipErrorBanner,
  CourseChipHeader,
  CourseChipLoading,
  CourseDemoDataRibbon,
  courseChipScrollContentStyle,
} from '../ui/courseChipShell';
import { useNavigation } from '@react-navigation/native';
import { safeNavigate } from '../utils/safeNavigate';

type RouteProps = {
  route?: {
    params?: {
      groupId?: string;
      groupName?: string;
    };
  };
};

export default function CourseDiscussionScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const groupName = props.route?.params?.groupName ?? '課程討論';
  const groupIdStr = props.route?.params?.groupId ?? '';
  const courseId = Number(groupIdStr.replace(/^tc:/, '')) || 0;

  const [threads, setThreads] = useState<TCDiscussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [posting, setPosting] = useState(false);

  /** Demo 模式下使用者在本機新增的討論串（依 courseId 分桶）；下拉重新整理時與 mock 合併，避免貼文被刷掉 */
  const demoUserThreadsByCourseRef = useRef<Map<number, TCDiscussion[]>>(new Map());

  const mergeDemoThreads = useCallback((cid: number, base: TCDiscussion[]) => {
    const userAdded = demoUserThreadsByCourseRef.current.get(cid) ?? [];
    const baseIds = new Set(base.map((b) => b.id));
    const extras = userAdded.filter((t) => !baseIds.has(t.id));
    return [...extras, ...base];
  }, []);

  const load = useCallback(async () => {
    setError(null);
    if (!courseId) {
      setError('沒有提供課程 ID');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      if (isDemoCourseId(courseId)) {
        // demo course → 直接用 mock data，不打 TronClass
        const base = demoFetchDiscussions(courseId) as TCDiscussion[];
        setThreads(mergeDemoThreads(courseId, base));
      } else {
        const data = await tcFetchDiscussions(courseId);
        setThreads(data);
      }
    } catch (e) {
      setError((e as Error)?.message ?? '載入失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId, mergeDemoThreads]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePost = useCallback(async () => {
    if (!newTitle.trim()) {
      Alert.alert('請輸入標題');
      return;
    }
    if (!courseId) return;
    setPosting(true);
    try {
      if (isDemoCourseId(courseId)) {
        // demo course → 本地新增、不打後端
        const newId = Date.now();
        const newThread: TCDiscussion = {
          id: newId,
          course_id: courseId,
          title: newTitle.trim(),
          description: newBody.trim() || '剛剛建立的討論',
          post_count: 0,
          created_at: new Date().toISOString(),
          last_post_at: new Date().toISOString(),
          is_locked: false,
        };
        const prevUser = demoUserThreadsByCourseRef.current.get(courseId) ?? [];
        demoUserThreadsByCourseRef.current.set(courseId, [newThread, ...prevUser]);
        setThreads(
          mergeDemoThreads(courseId, demoFetchDiscussions(courseId) as TCDiscussion[]),
        );
        try {
          const { onDiscussionPosted } = await import('../services/companionHooks');
          onDiscussionPosted({ threadId: String(newId) });
        } catch {
          /* swallow */
        }
        // ─ Demo：emit discussion_posted 給 TA + 老師 ─
        try {
          await emitDiscussionPosted({
            actorUid: auth.user?.uid ?? 'demo_student_kuchih',
            actorName: auth.profile?.displayName ?? '顧晉瑋',
            targetUids: ['demo_teacher_chang', 'demo_ta_lin'],
            courseId,
            courseName: groupName ?? '課程',
            payload: {
              threadId: String(newId),
              threadTitle: newTitle.trim(),
              authorName: auth.profile?.displayName ?? '顧晉瑋',
              preview: (newBody.trim() || '').slice(0, 80),
            },
          });
          // 標題含問號 / 「為什麼」/「怎麼」/ HELP 標記 → 升級為 help_requested
          const looksLikeHelp = /[?？]|為什麼|怎麼|不會|不懂|help|HELP/i.test(newTitle + ' ' + newBody);
          if (looksLikeHelp) {
            await emitHelpRequested({
              actorUid: auth.user?.uid ?? 'demo_student_kuchih',
              actorName: auth.profile?.displayName ?? '顧晉瑋',
              targetUids: ['demo_ta_lin', 'demo_teacher_chang'],
              courseId,
              courseName: groupName ?? '課程',
              payload: {
                topic: newTitle.trim().slice(0, 40),
                preview: (newBody.trim() || newTitle.trim()).slice(0, 120),
                urgency: /緊急|急|要交|今天/i.test(newTitle + ' ' + newBody) ? 'high' : 'medium',
              },
            });
          }
        } catch {
          /* swallow */
        }
        setNewTitle('');
        setNewBody('');
        setComposing(false);
        return;
      }

      const result = await tcPostDiscussion(courseId, {
        title: newTitle.trim(),
        content: newBody.trim(),
      });
      if (result?.success) {
        try {
          const { onDiscussionPosted } = await import('../services/companionHooks');
          onDiscussionPosted({ threadId: String(result.id ?? Date.now()) });
        } catch {
          /* swallow */
        }
        setNewTitle('');
        setNewBody('');
        setComposing(false);
        await load();
      } else {
        Alert.alert('發布失敗', result?.error ?? '請稍後再試。');
      }
    } catch (e) {
      Alert.alert('發布失敗', String((e as Error)?.message ?? e));
    } finally {
      setPosting(false);
    }
  }, [newTitle, newBody, courseId, load, mergeDemoThreads]);

  if (loading) {
    return (
      <CourseChipLoading
        title="正在載入課程討論"
        subtitle="整理討論串與回覆資訊…"
        accessibilityHint="載入完成後即可瀏覽與發起討論"
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={courseChipScrollContentStyle(true)}
        accessibilityLabel="課程討論列表"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            title="重新整理"
            tintColor={theme.colors.primary}
            accessibilityLabel="重新整理討論列表"
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        {isDemoCourseId(courseId) ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: theme.space.sm }}>
            <CourseDemoDataRibbon />
          </View>
        ) : null}
        <CourseChipHeader
          emoji="💬"
          eyebrow="課程討論"
          title={groupName}
          meta={`討論串 ${threads.length} 則`}
        />

        {error ? (
          <CourseChipErrorBanner message={error} onRetry={() => load()} />
        ) : null}

        {/* 新發文 */}
        {composing ? (
          <View
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <TextInput
              placeholder="想討論的問題（限 60 字）"
              placeholderTextColor={theme.colors.muted}
              accessibilityLabel="討論標題"
              accessibilityHint="限 60 字"
              maxLength={60}
              value={newTitle}
              onChangeText={setNewTitle}
              style={{
                fontSize: 16,
                fontWeight: '600',
                padding: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                color: theme.colors.text,
              }}
            />
            <TextInput
              placeholder="補充內容（選填）"
              placeholderTextColor={theme.colors.muted}
              accessibilityLabel="討論內容"
              value={newBody}
              onChangeText={setNewBody}
              multiline
              numberOfLines={4}
              style={{
                fontSize: 14,
                padding: 8,
                color: theme.colors.textSecondary,
                minHeight: 80,
                textAlignVertical: 'top',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消發文"
                onPress={() => {
                  if (!posting) {
                    setComposing(false);
                    setNewTitle('');
                    setNewBody('');
                  }
                }}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  alignItems: 'center',
                  minHeight: 44,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: theme.colors.muted }}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="送出討論"
                onPress={handlePost}
                disabled={posting}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.primary,
                  alignItems: 'center',
                  opacity: posting ? 0.5 : 1,
                  minHeight: 44,
                  justifyContent: 'center',
                }}
              >
                {posting ? (
                  <ActivityIndicator color={theme.colors.onAccent} size="small" />
                ) : (
                  <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>送出討論</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="發起新討論"
            onPress={() => setComposing(true)}
            style={{
              marginTop: 16,
              padding: 14,
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radius.lg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'center',
              minHeight: 48,
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color={theme.colors.onAccent} />
            <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>發起新討論</Text>
          </Pressable>
        )}

        {/* 討論串列表 */}
        {threads.length === 0 && !error ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="還沒有討論串"
            subtitle="你可以是第一個提問的人，老師或同學回覆後會出現在這裡。"
            hint="發起短標題問題，並在教材頁對照章節，回覆會更快。"
            showCalmHero
          />
        ) : (
          threads.map((t) => (
            <Pressable
              key={String(t.id)}
              accessibilityRole="button"
              accessibilityLabel={`討論：${t.title || '未命名'}`}
              style={({ pressed }) => ({
                marginTop: theme.space.md,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                padding: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.92 : 1,
              })}
              onPress={() => {
                safeNavigate(navigation, 'DiscussionThreadDetail', {
                  groupId: groupIdStr || `tc:${courseId}`,
                  groupName,
                  discussionId: t.id,
                  threadTitle: t.title || '討論串',
                });
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                {t.title || '(未命名)'}
              </Text>
              {t.description ? (
                <Text
                  style={{ color: theme.colors.muted, fontSize: 13, marginTop: 6 }}
                  numberOfLines={2}
                >
                  {t.description}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 12, color: theme.colors.muted }}>💬 {t.post_count} 則</Text>
                {t.last_post_at && (
                  <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                    最後回覆 {new Date(t.last_post_at).toLocaleString('zh-TW')}
                  </Text>
                )}
                {t.is_locked && (
                  <Text style={{ fontSize: 12, color: theme.colors.danger }}>🔒 已鎖定</Text>
                )}
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
