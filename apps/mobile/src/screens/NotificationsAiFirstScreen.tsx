import React, { useCallback } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AIButton, AIDetailScreen, AIEmptyState, AIRow, AISection, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { useNotifications } from '../state/notifications';
import { navigateFromInboxTask } from '../services/inboxActions';
import { inboxTaskFromAssignmentNotification } from '../utils/inboxTaskFromNotification';

function createdLabel(value: unknown): string {
  if (!value) return '';
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '';
}

export default function NotificationsAiFirstScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const { notifications, unreadCount, loading, error, markAsRead, markAllAsRead, reload } =
    useNotifications();

  const openNotification = useCallback(
    async (id: string) => {
      const row = notifications.find((item) => item.id === id);
      if (!row) return;
      await markAsRead(id);
      const task = inboxTaskFromAssignmentNotification(row);
      if (task) {
        navigateFromInboxTask(navigation, task, {
          role: auth.profile?.role,
          isTeachingRole: false,
        });
      }
    },
    [auth.profile?.role, markAsRead, navigation, notifications],
  );

  return (
    <AIDetailScreen
      title="通知"
      subtitle={unreadCount > 0 ? `${unreadCount} 則未讀` : '顯示這組帳號的通知'}
      onBack={() => navigation?.goBack?.()}
      rightAction={
        unreadCount > 0 ? (
          <AIButton label="全部已讀" variant="ghost" size="sm" onPress={() => void markAllAsRead()} />
        ) : undefined
      }
    >
      {loading ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator color={aiTokens.ai} accessibilityLabel="讀取通知" />
        </View>
      ) : error ? (
        <AISection title="通知資料">
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text, lineHeight: 22 }}>{error}</Text>
            <AIButton label="重新讀取" onPress={reload} />
          </View>
        </AISection>
      ) : notifications.length === 0 ? (
        <AIEmptyState title="目前沒有通知" subtitle="有新的作業、成績或系統訊息時會顯示在這裡。" />
      ) : (
        <AISection title="全部" subtitle={`${notifications.length} 則`}>
          {notifications.map((row) => {
            const when = createdLabel(row.createdAt);
            return (
              <AIRow
                key={row.id}
                title={row.title || '通知'}
                subtitle={[row.body, when].filter(Boolean).join(' · ')}
                tag={row.read ? undefined : '未讀'}
                onPress={() => void openNotification(row.id)}
              />
            );
          })}
        </AISection>
      )}
    </AIDetailScreen>
  );
}
