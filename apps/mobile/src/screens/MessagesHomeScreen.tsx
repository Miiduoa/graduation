import React, { useMemo, useEffect, useState } from "react";
import { ScrollView, View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, query, where, getDocs, limit, orderBy, onSnapshot } from "firebase/firestore";
import { Card, Button, Pill, Badge } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb } from "../firebase";
import { formatRelativeTime, toDate } from "../utils/format";

type GroupSummary = {
  id: string;
  name: string;
  type: string;
  unreadCount?: number;
  lastActivity?: Date;
};

type ConversationSummary = {
  id: string;
  participantName: string;
  lastMessage?: string;
  lastMessageAt?: Date;
  unread: boolean;
};

export function MessagesHomeScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();
  const insets = useSafeAreaInsets();

  const [groupsCount, setGroupsCount] = useState(0);
  const [unreadGroupsCount, setUnreadGroupsCount] = useState(0);
  const [recentGroups, setRecentGroups] = useState<GroupSummary[]>([]);
  const [unreadDmsCount, setUnreadDmsCount] = useState(0);
  const [recentDms, setRecentDms] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.user) {
      setLoading(false);
      return;
    }

    let unsubscribeGroups: (() => void) | undefined;
    let unsubscribeDms: (() => void) | undefined;

    const loadData = async () => {
      try {
        const groupsRef = collection(db, "users", auth.user.uid, "groups");
        const groupsQ = query(
          groupsRef,
          where("schoolId", "==", school.id),
          where("status", "==", "active"),
          limit(5)
        );

        unsubscribeGroups = onSnapshot(groupsQ, (snap) => {
          const groups = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: data.groupId,
              name: data.name,
              type: data.type,
              unreadCount: data.unreadCount ?? 0,
              lastActivity: data.lastActivity ? toDate(data.lastActivity) : undefined,
            } as GroupSummary;
          });

          setGroupsCount(snap.size);
          setUnreadGroupsCount(groups.filter((g) => (g.unreadCount ?? 0) > 0).length);
          setRecentGroups(groups.slice(0, 3));
        }, (error) => {
          console.warn("[MessagesHome] Groups snapshot error:", error);
        });

        const dmsRef = collection(db, "conversations");
        const dmsQ = query(
          dmsRef,
          where("participants", "array-contains", auth.user.uid),
          limit(5)
        );

        unsubscribeDms = onSnapshot(dmsQ, async (snap) => {
          const conversations = await Promise.all(
            snap.docs.map(async (d) => {
              const data = d.data();
              const otherUserId = data.participants?.find((p: string) => p !== auth.user?.uid);
              let participantName = "未知用戶";

              if (otherUserId) {
                try {
                  const userRef = collection(db, "users");
                  const userQ = query(userRef, where("__name__", "==", otherUserId), limit(1));
                  const userSnap = await getDocs(userQ);
                  if (!userSnap.empty) {
                    const userData = userSnap.docs[0].data();
                    participantName = userData.displayName || userData.email || "用戶";
                  }
                } catch {
                  // ignore
                }
              }

              const lastReadAt = data.lastReadBy?.[auth.user?.uid];
              const lastMessageAt = data.lastMessageAt ? toDate(data.lastMessageAt) : undefined;
              const unread = lastMessageAt && lastReadAt
                ? lastMessageAt > toDate(lastReadAt)!
                : !!lastMessageAt;

              return {
                id: d.id,
                participantName,
                lastMessage: data.lastMessage?.content,
                lastMessageAt,
                unread,
              } as ConversationSummary;
            })
          );

          setUnreadDmsCount(conversations.filter((c) => c.unread).length);
          setRecentDms(conversations.slice(0, 3));
        }, (error) => {
          console.warn("[MessagesHome] DMs snapshot error:", error);
        });

      } catch (e) {
        console.warn("[MessagesHome] Failed to load:", e);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    return () => {
      unsubscribeGroups?.();
      unsubscribeDms?.();
    };
  }, [auth.user?.uid, db, school.id]);

  const totalUnread = unreadGroupsCount + unreadDmsCount;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: 20,
          paddingHorizontal: 20,
          backgroundColor: theme.colors.bg,
        }}
      >
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>訊息</Text>

        {auth.user && totalUnread > 0 && (
          <View style={styles.statsRow}>
            {unreadGroupsCount > 0 && (
              <View style={[styles.statBlock, { backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: theme.colors.border }]}>
                <Ionicons name="people" size={16} color={theme.colors.accent} />
                <Text style={[styles.statNumber, { color: theme.colors.accent }]}>{unreadGroupsCount}</Text>
                <Text style={[styles.statLabel, { color: theme.colors.muted }]}>群組未讀</Text>
              </View>
            )}
            {unreadDmsCount > 0 && (
              <View style={[styles.statBlock, { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }]}>
                <Ionicons name="chatbubble" size={16} color={theme.colors.accent} />
                <Text style={[styles.statNumber, { color: theme.colors.accent }]}>{unreadDmsCount}</Text>
                <Text style={[styles.statLabel, { color: theme.colors.muted }]}>私訊未讀</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        showsVerticalScrollIndicator={false}
      >
        {/* Groups Section */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconBg, { backgroundColor: "#22c55e20" }]}>
              <Ionicons name="people" size={22} color="#22c55e" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>群組</Text>
              <Text style={styles.sectionSubtitle}>加入課程群、查看公告與 Q&A</Text>
            </View>
            {auth.user && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{groupsCount}</Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <Pill text="加入碼 8 碼" kind="accent" size="sm" />
            <Pill text="公告 / Q&A" size="sm" />
            <Pill text="作業繳交" size="sm" />
          </View>

          {recentGroups.length > 0 && (
            <View style={{ marginTop: 16, gap: 10 }}>
              <Text style={styles.listLabel}>最近活動</Text>
              {recentGroups.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => nav?.navigate?.("GroupDetail", { groupId: g.id })}
                  style={({ pressed }) => ([
                    styles.listItem,
                    {
                      borderColor: g.unreadCount ? theme.colors.accent + "30" : theme.colors.border,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    },
                  ])}
                >
                  <View style={[styles.listItemIcon, {
                    backgroundColor: g.type === "course" ? "#6366f120" : "#22c55e20",
                  }]}>
                    <Ionicons
                      name={g.type === "course" ? "school" : "people"}
                      size={18}
                      color={g.type === "course" ? "#6366f1" : "#22c55e"}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle} numberOfLines={1}>
                      {g.name}
                    </Text>
                    {g.lastActivity && (
                      <Text style={styles.listItemMeta}>
                        {formatRelativeTime(g.lastActivity)}
                      </Text>
                    )}
                  </View>
                  {(g.unreadCount ?? 0) > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>
                        {g.unreadCount! > 99 ? "99+" : g.unreadCount}
                      </Text>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            onPress={() => nav?.navigate?.("Groups")}
            style={({ pressed }) => ([
              styles.actionButton,
              { backgroundColor: "#22c55e", transform: [{ scale: pressed ? 0.97 : 1 }] },
            ])}
          >
            <Ionicons name="arrow-forward" size={16} color="#fff" />
            <Text style={styles.actionButtonText}>進入群組</Text>
          </Pressable>
        </View>

        {/* DMs Section */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIconBg, { backgroundColor: "#3b82f620" }]}>
              <Ionicons name="chatbubbles" size={22} color="#3b82f6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>私訊</Text>
              <Text style={styles.sectionSubtitle}>私下問老師或同學</Text>
            </View>
            {auth.user && unreadDmsCount > 0 && (
              <View style={[styles.unreadBadge, { width: "auto", paddingHorizontal: 10 }]}>
                <Text style={styles.unreadBadgeText}>{unreadDmsCount} 未讀</Text>
              </View>
            )}
          </View>

          {recentDms.length > 0 && (
            <View style={{ marginTop: 16, gap: 10 }}>
              {recentDms.map((dm) => (
                <Pressable
                  key={dm.id}
                  onPress={() => nav?.navigate?.("Chat", { conversationId: dm.id })}
                  style={({ pressed }) => ([
                    styles.listItem,
                    {
                      borderColor: dm.unread ? theme.colors.accent + "30" : theme.colors.border,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    },
                  ])}
                >
                  <View style={[styles.listItemIcon, { backgroundColor: "#3b82f620" }]}>
                    <Text style={{ color: "#3b82f6", fontWeight: "800", fontSize: 16 }}>
                      {dm.participantName[0]?.toUpperCase() ?? "?"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listItemTitle, dm.unread && { fontWeight: "800" }]} numberOfLines={1}>
                      {dm.participantName}
                    </Text>
                    {dm.lastMessage && (
                      <Text style={styles.listItemMeta} numberOfLines={1}>
                        {dm.lastMessage}
                      </Text>
                    )}
                  </View>
                  {dm.unread && (
                    <View style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: "#3b82f6",
                    }} />
                  )}
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                </Pressable>
              ))}
            </View>
          )}

          {!auth.user && (
            <Text style={{ color: theme.colors.textSecondary, lineHeight: 20, marginTop: 12 }}>
              請先登入以查看私訊。
            </Text>
          )}

          <Pressable
            onPress={() => nav?.navigate?.("Dms")}
            style={({ pressed }) => ([
              styles.actionButton,
              { backgroundColor: "#3b82f6", transform: [{ scale: pressed ? 0.97 : 1 }] },
            ])}
          >
            <Ionicons name="arrow-forward" size={16} color="#fff" />
            <Text style={styles.actionButtonText}>查看私訊</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  statBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statNumber: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 18,
  },
  statLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "600",
  },
  sectionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...softShadowStyle(theme.shadows.soft),
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionIconBg: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: theme.colors.text,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  countBadge: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  countBadgeText: {
    color: theme.colors.accent,
    fontWeight: "800",
    fontSize: 14,
  },
  listLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
    ...softShadowStyle(theme.shadows.soft),
  },
  listItemIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  listItemTitle: {
    color: theme.colors.text,
    fontWeight: "700",
    fontSize: 15,
  },
  listItemMeta: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 11,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 14,
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
});
