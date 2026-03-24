/* eslint-disable */
import React, { useCallback, memo } from "react";
import { ScrollView, Text, View, Pressable, FlatList, RefreshControl, ListRenderItemInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Pill, LoadingState, ErrorState } from "../ui/components";
import {
  useNotifications,
  getNotificationIcon,
  getNotificationTypeLabel,
  type NotificationType,
  type Notification,
} from "../state/notifications";
import { useAuth } from "../state/auth";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { formatDateTime } from "../utils/format";

type NotificationItemProps = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt?: any;
  read: boolean;
  onPress: () => void;
};

const NotificationItem = memo(function NotificationItem(props: NotificationItemProps) {
  const { type, title, body, createdAt, read, onPress } = props;
  const iconName = getNotificationIcon(type) as any;
  const typeLabel = getNotificationTypeLabel(type);

  return (
    <Pressable
      onPress={onPress}
      style={{
        padding: 14,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: read ? theme.colors.border : "rgba(124,92,255,0.45)",
        backgroundColor: read ? theme.colors.surface : theme.colors.accentSoft,
      }}
    >
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: read ? theme.colors.surface2 : theme.colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={iconName}
            size={20}
            color={read ? theme.colors.muted : "#fff"}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: read ? theme.colors.muted : theme.colors.text,
                fontWeight: "800",
                flex: 1,
              }}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Pill text={typeLabel} kind={read ? "default" : "accent"} />
          </View>
          <Text
            style={{
              color: theme.colors.muted,
              marginTop: 4,
              lineHeight: 18,
            }}
            numberOfLines={2}
          >
            {body}
          </Text>
          {createdAt ? (
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }}>
              {formatDateTime(createdAt?.toDate?.() ?? createdAt)}
            </Text>
          ) : null}
        </View>
        {!read ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: theme.colors.accent,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
});

export function NotificationsScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const notifs = useNotifications();

  const handleNotificationPress = useCallback((n: Notification) => {
    notifs.markAsRead(n.id);

    switch (n.type) {
      case "announcement":
        if (n.data?.announcementId) {
          nav?.navigate?.("Today", { screen: "公告詳情", params: { id: n.data.announcementId } });
        }
        break;
      case "event":
        if (n.data?.eventId) {
          nav?.navigate?.("Today", { screen: "活動詳情", params: { id: n.data.eventId } });
        }
        break;
      case "group_post":
        if (n.data?.groupId && n.data?.postId) {
          nav?.navigate?.("收件匣", {
            screen: "GroupPost",
            params: { groupId: n.data.groupId, postId: n.data.postId },
          });
        }
        break;
      case "group_invite":
        nav?.navigate?.("收件匣", { screen: "Groups" });
        break;
      case "assignment":
        if (n.data?.groupId && n.data?.assignmentId) {
          nav?.navigate?.("收件匣", {
            screen: "AssignmentDetail",
            params: { groupId: n.data.groupId, assignmentId: n.data.assignmentId },
          });
        }
        break;
      case "grade":
        if (n.data?.groupId) {
          nav?.navigate?.("收件匣", {
            screen: "GroupAssignments",
            params: { groupId: n.data.groupId },
          });
        }
        break;
      case "message":
        if (n.data?.peerId) {
          nav?.navigate?.("收件匣", {
            screen: "Chat",
            params: { kind: "dm", peerId: n.data.peerId },
          });
        }
        break;
      default:
        break;
    }
  }, [nav, notifs]);

  const renderNotification = useCallback(({ item: n }: ListRenderItemInfo<Notification>) => (
    <NotificationItem
      key={n.id}
      id={n.id}
      type={n.type}
      title={n.title}
      body={n.body}
      createdAt={n.createdAt}
      read={n.read}
      onPress={() => handleNotificationPress(n)}
    />
  ), [handleNotificationPress]);

  const keyExtractor = useCallback((item: Notification) => item.id, []);

  const ListHeader = useCallback(() => (
    <Card title="通知" subtitle={`共 ${notifs.notifications.length} 則（未讀 ${notifs.unreadCount}）`}>
      {notifs.unreadCount > 0 ? (
        <View style={{ marginBottom: 10 }}>
          <Button text="全部標為已讀" onPress={notifs.markAllAsRead} />
        </View>
      ) : null}
    </Card>
  ), [notifs.notifications.length, notifs.unreadCount, notifs.markAllAsRead]);

  const ListEmpty = useCallback(() => (
    <View style={{ padding: 20 }}>
      <Text style={{ color: theme.colors.muted, textAlign: "center" }}>
        目前沒有通知。新公告、活動、群組訊息會出現在這裡。
      </Text>
    </View>
  ), []);

  const ListFooter = useCallback(() => (
    <Card title="通知設定" subtitle="管理推播通知與免打擾">
      <Text style={{ color: theme.colors.muted, lineHeight: 20, marginBottom: 12 }}>
        開啟推播通知、選擇通知類型、設定免打擾時段。
      </Text>
      <Button
        text="前往通知設定"
        kind="primary"
        onPress={() => nav?.navigate?.("NotificationSettings")}
      />
    </Card>
  ), [nav]);

  if (!auth.user) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <Card title="通知" subtitle="尚未登入">
            <Text style={{ color: theme.colors.muted }}>
              請先到『我的』登入後才能查看通知。
            </Text>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      {notifs.loading ? (
        <LoadingState title="通知" subtitle="載入中..." rows={4} />
      ) : notifs.error ? (
        <ErrorState
          title="通知"
          subtitle="載入通知失敗"
          hint={notifs.error}
          actionText="重試"
          onAction={notifs.reload}
        />
      ) : (
        <FlatList
          data={notifs.notifications}
          keyExtractor={keyExtractor}
          renderItem={renderNotification}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={{ gap: 10, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          refreshControl={
            <RefreshControl
              refreshing={notifs.loading}
              onRefresh={notifs.reload}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
            />
          }
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          getItemLayout={(_, index) => ({
            length: 120,
            offset: 120 * index,
            index,
          })}
        />
      )}
    </Screen>
  );
}
