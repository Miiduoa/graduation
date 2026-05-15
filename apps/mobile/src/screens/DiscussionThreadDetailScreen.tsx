/**
 * DiscussionThreadDetailScreen — 單一討論串回覆（LearnStack）
 * Demo 或 TronClass：有 API 走 tcFetchDiscussionPosts，否則用 demoFetchDiscussionPosts。
 */
import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { tcFetchDiscussionPosts, type TCDiscussionPost } from '../services/tronClassClient';
import { isDemoCourseId, demoFetchDiscussionPosts, toDemoCourseId } from '../data/demoCoursesAdapter';
import { theme } from '../ui/theme';
import { EmptyState } from '../ui/components';
import {
  CourseChipErrorBanner,
  CourseChipHeader,
  CourseChipLoading,
  CourseDemoDataRibbon,
  courseChipScrollContentStyle,
} from '../ui/courseChipShell';

type RouteProps = {
  route?: {
    params?: {
      groupId?: string;
      groupName?: string;
      discussionId?: number;
      threadTitle?: string;
    };
  };
};

export default function DiscussionThreadDetailScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const groupName = props.route?.params?.groupName ?? '課程討論';
  const groupIdStr = props.route?.params?.groupId ?? '';
  const courseId = toDemoCourseId(groupIdStr);
  const discussionId = Number(props.route?.params?.discussionId ?? 0) || 0;
  const threadTitle = props.route?.params?.threadTitle ?? '討論串';

  const [posts, setPosts] = useState<TCDiscussionPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: threadTitle.length > 18 ? `${threadTitle.slice(0, 18)}…` : threadTitle });
  }, [navigation, threadTitle]);

  const load = useCallback(async () => {
    setError(null);
    if (!courseId || !discussionId) {
      setError(!courseId ? '沒有提供課程 ID' : '沒有提供討論編號');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      if (isDemoCourseId(courseId)) {
        setPosts(demoFetchDiscussionPosts(courseId, discussionId));
      } else {
        const data = await tcFetchDiscussionPosts(courseId, discussionId);
        setPosts(data);
      }
    } catch (e) {
      setError((e as Error)?.message ?? '載入失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId, discussionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <CourseChipLoading
        title="正在載入討論內容"
        subtitle="讀取回覆與時間序…"
        accessibilityHint="載入完成即可瀏覽討論串"
      />
    );
  }

  const demoRibbon = isDemoCourseId(courseId);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      contentContainerStyle={courseChipScrollContentStyle(true)}
      accessibilityLabel="討論串內容"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          title="重新整理"
          tintColor={theme.colors.primary}
          accessibilityLabel="重新整理討論回覆"
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      {demoRibbon ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: theme.space.sm }}>
          <CourseDemoDataRibbon />
        </View>
      ) : null}

      <CourseChipHeader
        emoji="💬"
        eyebrow={groupName}
        title={threadTitle}
        meta={posts.length > 0 ? `共 ${posts.length} 則留言` : '尚無留言'}
      />

      {error ? <CourseChipErrorBanner message={error} onRetry={() => load()} /> : null}

      {posts.length === 0 && !error ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="此討論尚無回覆"
          subtitle="成為第一位回覆的同學，或請教師在 TronClass 開啟討論。"
          hint="可下拉重新整理以同步最新內容。"
          showCalmHero
        />
      ) : (
        posts.map((p) => (
          <View
            key={p.id}
            style={{
              marginTop: 12,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.text }}>
                {p.author_name ?? '匿名'}
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                {p.created_at ? new Date(p.created_at).toLocaleString('zh-TW') : '—'}
              </Text>
            </View>
            <Text style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
              {p.content}
            </Text>
            {p.likes_count > 0 && (
              <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 8 }}>
                👍 {p.likes_count}
              </Text>
            )}
          </View>
        ))
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回討論列表"
        onPress={() => navigation.goBack()}
        style={{
          marginTop: 20,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          minHeight: 48,
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>返回討論列表</Text>
      </Pressable>
    </ScrollView>
  );
}
