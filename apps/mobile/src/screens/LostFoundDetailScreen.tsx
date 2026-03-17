import React, { useState, useMemo, useEffect } from "react";
import { ScrollView, Text, View, Pressable, Alert, Linking, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  AnimatedCard,
  Card,
  Button,
  Pill,
  SectionTitle,
  ListItem,
  Skeleton,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { formatDateTime, formatRelativeTime } from "../utils/format";

type ItemType = "lost" | "found";
type ItemStatus = "open" | "claimed" | "returned" | "expired";
type ItemCategory = "electronics" | "cards" | "clothing" | "accessories" | "books" | "keys" | "other";

type LostFoundItem = {
  id: string;
  type: ItemType;
  status: ItemStatus;
  title: string;
  description: string;
  category: ItemCategory;
  location: string;
  date: Date;
  createdAt: Date;
  imageUrl?: string;
  contactInfo?: string;
  authorId: string;
  authorName: string;
  authorDepartment?: string;
  claimedBy?: string;
  claimedAt?: Date;
  characteristics?: string[];
};

const CATEGORY_INFO: Record<ItemCategory, { label: string; icon: string; color: string }> = {
  electronics: { label: "電子產品", icon: "phone-portrait", color: "#3B82F6" },
  cards: { label: "證件/卡片", icon: "card", color: "#8B5CF6" },
  clothing: { label: "衣物", icon: "shirt", color: "#EC4899" },
  accessories: { label: "配件", icon: "glasses", color: "#F59E0B" },
  books: { label: "書籍", icon: "book", color: "#10B981" },
  keys: { label: "鑰匙", icon: "key", color: "#6366F1" },
  other: { label: "其他", icon: "help-circle", color: "#6B7280" },
};

const STATUS_INFO: Record<ItemStatus, { label: string; color: string; icon: string }> = {
  open: { label: "尋找中", color: theme.colors.accent, icon: "search" },
  claimed: { label: "已認領", color: "#F59E0B", icon: "hand-left" },
  returned: { label: "已歸還", color: theme.colors.success, icon: "checkmark-circle" },
  expired: { label: "已過期", color: theme.colors.muted, icon: "time" },
};

const MOCK_ITEM: LostFoundItem = {
  id: "lf1",
  type: "lost",
  status: "open",
  title: "黑色 AirPods Pro 耳機盒",
  description:
    "在圖書館 2F 自習區遺失，盒子上有貼紙裝飾（粉色獨角獸貼紙）。\n\n大約是下午兩點左右離開座位時忘記帶走，發現時已經不見了。\n\n如果有好心人撿到，拜託聯繫我，非常感謝！可以請你喝飲料作為感謝 🙏",
  category: "electronics",
  location: "圖書館 2F 自習區 A",
  date: new Date("2026-02-28"),
  createdAt: new Date("2026-02-28T14:30:00"),
  authorId: "u1",
  authorName: "王小明",
  authorDepartment: "資訊工程學系",
  contactInfo: "LINE: xiaoming123",
  characteristics: ["黑色", "有粉色獨角獸貼紙", "Apple AirPods Pro", "附充電盒"],
};

export function LostFoundDetailScreen(props: any) {
  const nav = props?.navigation;
  const route = props?.route;
  const itemId = route?.params?.id;
  const auth = useAuth();

  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<LostFoundItem | null>(null);

  useEffect(() => {
    loadItem();
  }, [itemId]);

  const loadItem = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 500));
    setItem(MOCK_ITEM);
    setLoading(false);
  };

  const categoryInfo = item ? CATEGORY_INFO[item.category] : null;
  const statusInfo = item ? STATUS_INFO[item.status] : null;
  const isOwner = auth.user?.uid === item?.authorId;

  const handleContact = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "登入後才能查看聯絡資訊", [
        { text: "取消", style: "cancel" },
        { text: "前往登入", onPress: () => nav?.navigate?.("MeHome") },
      ]);
      return;
    }

    if (!item?.contactInfo) {
      Alert.alert("無聯絡資訊", "發布者未提供聯絡方式");
      return;
    }

    Alert.alert(
      "聯絡發布者",
      `聯絡方式：${item.contactInfo}\n\n請文明禮貌地聯繫對方`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "複製",
          onPress: () => {
            Alert.alert("已複製", "聯絡資訊已複製到剪貼簿");
          },
        },
      ]
    );
  };

  const handleClaim = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "登入後才能認領物品", [
        { text: "取消", style: "cancel" },
        { text: "前往登入", onPress: () => nav?.navigate?.("MeHome") },
      ]);
      return;
    }

    Alert.alert(
      "確認認領",
      item?.type === "lost"
        ? "您確定要表示您找到了這個物品嗎？"
        : "您確定這是您遺失的物品嗎？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認",
          onPress: () => {
            setItem((prev) =>
              prev
                ? {
                    ...prev,
                    status: "claimed",
                    claimedBy: auth.profile?.displayName ?? "匿名用戶",
                    claimedAt: new Date(),
                  }
                : null
            );
            Alert.alert(
              "認領成功",
              item?.type === "lost"
                ? "請儘快聯繫發布者安排歸還事宜！"
                : "請聯繫發布者確認身份並取回物品！"
            );
          },
        },
      ]
    );
  };

  const handleMarkReturned = () => {
    Alert.alert("確認歸還", "確定物品已成功歸還給原主人嗎？", [
      { text: "取消", style: "cancel" },
      {
        text: "確認",
        onPress: () => {
          setItem((prev) => (prev ? { ...prev, status: "returned" } : null));
          Alert.alert("太棒了！", "感謝您的幫助，物品已標記為已歸還 🎉");
        },
      },
    ]);
  };

  const handleShare = async () => {
    if (!item) return;
    try {
      await Share.share({
        message: `【${item.type === "lost" ? "失物" : "招領"}】${item.title}\n\n地點：${item.location}\n時間：${formatDateTime(item.date)}\n\n${item.description}\n\n#校園失物招領`,
        title: item.title,
      });
    } catch (error) {
      console.error("Share error:", error);
    }
  };

  const handleEdit = () => {
    nav?.navigate?.("LostFoundPost", { id: item?.id, type: item?.type });
  };

  const handleDelete = () => {
    Alert.alert("確認刪除", "確定要刪除這則失物招領嗎？此操作無法復原。", [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: () => {
          Alert.alert("已刪除", "失物招領資訊已刪除");
          nav?.goBack?.();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 8 }}>
          <Skeleton height={200} borderRadius={theme.radius.lg} />
          <Skeleton height={150} borderRadius={theme.radius.lg} />
          <Skeleton height={100} borderRadius={theme.radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <AnimatedCard title="找不到物品" subtitle="此物品可能已被刪除">
          <Button text="返回列表" onPress={() => nav?.goBack?.()} />
        </AnimatedCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="" subtitle="">
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 20,
                backgroundColor: `${categoryInfo?.color}20`,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name={categoryInfo?.icon as any} size={40} color={categoryInfo?.color} />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: item.type === "lost" ? `${theme.colors.danger}20` : `${theme.colors.success}20`,
                }}
              >
                <Text
                  style={{
                    color: item.type === "lost" ? theme.colors.danger : theme.colors.success,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  {item.type === "lost" ? "🔍 遺失物品" : "📦 拾獲物品"}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: `${statusInfo?.color}20`,
                  gap: 4,
                }}
              >
                <Ionicons name={statusInfo?.icon as any} size={14} color={statusInfo?.color} />
                <Text style={{ color: statusInfo?.color, fontSize: 13, fontWeight: "600" }}>
                  {statusInfo?.label}
                </Text>
              </View>
            </View>

            <Text
              style={{
                color: theme.colors.text,
                fontWeight: "900",
                fontSize: 22,
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              {item.title}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Pill text={categoryInfo?.label ?? ""} />
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="詳細資訊" delay={100}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="location" size={18} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  {item.type === "lost" ? "遺失地點" : "拾獲地點"}
                </Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 2 }}>{item.location}</Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="calendar" size={18} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  {item.type === "lost" ? "遺失日期" : "拾獲日期"}
                </Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 2 }}>
                  {formatDateTime(item.date)}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="time" size={18} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>發布時間</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 2 }}>
                  {formatDateTime(item.createdAt)} ({formatRelativeTime(item.createdAt)})
                </Text>
              </View>
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="物品描述" delay={150}>
          <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{item.description}</Text>

          {item.characteristics && item.characteristics.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>物品特徵</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {item.characteristics.map((char, idx) => (
                  <View
                    key={idx}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontSize: 13 }}>{char}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </AnimatedCard>

        <AnimatedCard title="發布者資訊" delay={200}>
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: theme.colors.accentSoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 18 }}>
                {item.authorName?.[0] ?? "?"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.authorName}</Text>
              {item.authorDepartment && (
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  {item.authorDepartment}
                </Text>
              )}
            </View>
            {auth.user && item.contactInfo && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="chatbubble-ellipses" size={16} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>聯繫</Text>
              </View>
            )}
          </Pressable>

          {!auth.user && (
            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: `${theme.colors.accent}10`,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Ionicons name="lock-closed" size={18} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
                登入後才能查看聯絡資訊
              </Text>
            </View>
          )}
        </AnimatedCard>

        {item.status === "claimed" && item.claimedBy && (
          <AnimatedCard title="認領資訊" delay={250}>
            <View
              style={{
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: `${STATUS_INFO.claimed.color}15`,
                borderWidth: 1,
                borderColor: `${STATUS_INFO.claimed.color}30`,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Ionicons name="hand-left" size={20} color={STATUS_INFO.claimed.color} />
                <Text style={{ color: STATUS_INFO.claimed.color, fontWeight: "700" }}>已有人認領</Text>
              </View>
              <Text style={{ color: theme.colors.text }}>
                認領者：{item.claimedBy}
              </Text>
              {item.claimedAt && (
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                  認領時間：{formatDateTime(item.claimedAt)}
                </Text>
              )}
            </View>
          </AnimatedCard>
        )}

        {item.status === "returned" && (
          <AnimatedCard title="歸還狀態" delay={250}>
            <View
              style={{
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: `${theme.colors.success}15`,
                borderWidth: 1,
                borderColor: `${theme.colors.success}30`,
                alignItems: "center",
              }}
            >
              <Ionicons name="checkmark-circle" size={48} color={theme.colors.success} />
              <Text style={{ color: theme.colors.success, fontWeight: "700", fontSize: 16, marginTop: 8 }}>
                物品已成功歸還！🎉
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4, textAlign: "center" }}>
                感謝所有幫助找回物品的好心人
              </Text>
            </View>
          </AnimatedCard>
        )}

        <View style={{ gap: 12, marginTop: 8 }}>
          {item.status === "open" && !isOwner && (
            <Button
              text={item.type === "lost" ? "我找到這個物品" : "這是我的物品"}
              kind="primary"
              onPress={handleClaim}
            />
          )}

          {item.status === "open" && (
            <Button text="聯繫發布者" onPress={handleContact} />
          )}

          {item.status === "claimed" && isOwner && (
            <Button text="標記為已歸還" kind="primary" onPress={handleMarkReturned} />
          )}

          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Button text="分享" onPress={handleShare} />
            </View>
            {isOwner && (
              <>
                <View style={{ flex: 1 }}>
                  <Button text="編輯" onPress={handleEdit} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button text="刪除" onPress={handleDelete} />
                </View>
              </>
            )}
          </View>
        </View>

        <AnimatedCard title="提醒事項" subtitle="領取物品時請注意" delay={300}>
          <View style={{ gap: 8 }}>
            <ListItem
              icon="shield-checkmark-outline"
              title="驗證身份"
              subtitle="領取前請確認物品確實屬於您"
            />
            <ListItem
              icon="document-text-outline"
              title="保留記錄"
              subtitle="建議拍照或截圖保存交易記錄"
            />
            <ListItem
              icon="people-outline"
              title="公共場所"
              subtitle="建議在校園公共區域進行交接"
            />
          </View>
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
