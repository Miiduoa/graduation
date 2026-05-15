/**
 * Course Discussion Screen — 課程討論串本地畫面
 *
 * 對應 TronClass endpoint：GET /courses/{id}/discussions  → tcFetchDiscussions
 *                          GET /courses/{id}/discussions/{did}/posts → tcFetchDiscussionPosts
 *                          POST /courses/{id}/discussions → tcCreateDiscussion (本檔新增)
 *
 * 使用真實資料；空資料時顯示空狀態而非 mock。
 */
import React, { useState, useEffect, useCallback } from 'react';
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

type RouteProps = {
  route?: {
    params?: {
      groupId?: string;
      groupName?: string;
    };
  };
};

export default function CourseDiscussionScreen(props: RouteProps) {
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

  const load = useCallback(async () => {
    setError(null);
    if (!courseId) {
      setError('沒有提供課程 ID');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const data = await tcFetchDiscussions(courseId);
      setThreads(data);
    } catch (e) {
      setError((e as Error)?.message ?? '載入失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId]);

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
  }, [newTitle, newBody, courseId, load]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: '#6b7280' }}>正在載入課程討論⋯⋯</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#111827' }}>{groupName}</Text>
        <Text style={{ color: '#6b7280', marginTop: 4 }}>
          討論串 {threads.length} 則
        </Text>

        {error && (
          <View
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: '#fee2e2',
              borderRadius: 8,
            }}
          >
            <Text style={{ color: '#991b1b', fontSize: 13 }}>⚠️ {error}</Text>
          </View>
        )}

        {/* 新發文 */}
        {composing ? (
          <View
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: '#fff',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <TextInput
              placeholder="想討論的問題（限 60 字）"
              maxLength={60}
              value={newTitle}
              onChangeText={setNewTitle}
              style={{
                fontSize: 16,
                fontWeight: '600',
                padding: 8,
                borderBottomWidth: 1,
                borderBottomColor: '#e5e7eb',
              }}
            />
            <TextInput
              placeholder="補充內容（選填）"
              value={newBody}
              onChangeText={setNewBody}
              multiline
              numberOfLines={4}
              style={{
                fontSize: 14,
                padding: 8,
                color: '#374151',
                minHeight: 80,
                textAlignVertical: 'top',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable
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
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#e5e7eb',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#6b7280' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handlePost}
                disabled={posting}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: '#1F4E78',
                  alignItems: 'center',
                  opacity: posting ? 0.5 : 1,
                }}
              >
                {posting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>送出討論</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setComposing(true)}
            style={{
              marginTop: 16,
              padding: 14,
              backgroundColor: '#1F4E78',
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'center',
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>發起新討論</Text>
          </Pressable>
        )}

        {/* 討論串列表 */}
        {threads.length === 0 && !error ? (
          <View style={{ alignItems: 'center', padding: 32, gap: 8 }}>
            <Text style={{ fontSize: 48 }}>💬</Text>
            <Text style={{ color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
              這門課還沒有任何討論。{'\n'}你可以是第一個發問的人！
            </Text>
          </View>
        ) : (
          threads.map((t) => (
            <Pressable
              key={t.id}
              style={{
                marginTop: 12,
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 14,
                borderWidth: 1,
                borderColor: '#e5e7eb',
              }}
              onPress={() => {
                /* TODO: open thread detail screen */
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>
                {t.title || '(未命名)'}
              </Text>
              {t.description ? (
                <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }} numberOfLines={2}>
                  {t.description}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                <Text style={{ fontSize: 12, color: '#6b7280' }}>💬 {t.post_count} 則</Text>
                {t.last_post_at && (
                  <Text style={{ fontSize: 12, color: '#6b7280' }}>
                    最後回覆 {new Date(t.last_post_at).toLocaleString('zh-TW')}
                  </Text>
                )}
                {t.is_locked && (
                  <Text style={{ fontSize: 12, color: '#dc2626' }}>🔒 已鎖定</Text>
                )}
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
