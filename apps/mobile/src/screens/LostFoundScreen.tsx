import React, { useState, useMemo, useCallback, useEffect, memo } from "react";
import { ScrollView, Text, View, Pressable, RefreshControl, Image, Alert, FlatList, ListRenderItemInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  AnimatedCard,
  Card,
  Button,
  Pill,
  SegmentedControl,
  SearchBar,
  Skeleton,
  FilterChip,
  ListItem,
  Badge,
  Spinner,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { formatRelativeTime, formatDateTime } from "../utils/format";
import { getDataSource, hasDataSource } from "../data";
import type { LostFoundItem as DataLostFoundItem } from "../data/types";
import { analytics } from "../services/analytics";

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
  claimedBy?: string;
  claimedAt?: Date;
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

const STATUS_INFO: Record<ItemStatus, { label: string; color: string }> = {
  open: { label: "尋找中", color: theme.colors.accent },
  claimed: { label: "已認領", color: "#F59E0B" },
  returned: { label: "已歸還", color: theme.colors.success },
  expired: { label: "已過期", color: theme.colors.muted },
};

const MOCK_ITEMS: LostFoundItem[] = [
  {
    id: "lf1",
    type: "lost",
    status: "open",
    title: "黑色 AirPods Pro 耳機盒",
    description: "在圖書館 2F 自習區遺失，盒子上有貼紙裝飾。希望好心人歸還！",
    category: "electronics",
    location: "圖書館 2F",
    date: new Date("2026-02-28"),
    createdAt: new Date("2026-02-28T14:30:00"),
    authorId: "u1",
    authorName: "王小明",
    contactInfo: "LINE: xiaoming123",
  },
  {
    id: "lf2",
    type: "found",
    status: "open",
    title: "學生證一張",
    description: "在工程館一樓走廊撿到學生證，請失主來認領。",
    category: "cards",
    location: "工程館 1F",
    date: new Date("2026-02-27"),
    createdAt: new Date("2026-02-27T16:00:00"),
    authorId: "u2",
    authorName: "李大華",
  },
  {
    id: "lf3",
    type: "lost",
    status: "open",
    title: "灰色 Uniqlo 外套",
    description: "上週五在學餐忘記拿，深灰色羽絨外套 L 號，口袋裡有紙巾。",
    category: "clothing",
    location: "學生餐廳",
    date: new Date("2026-02-21"),
    createdAt: new Date("2026-02-22T09:00:00"),
    authorId: "u3",
    authorName: "張小美",
  },
  {
    id: "lf4",
    type: "found",
    status: "claimed",
    title: "鑰匙一串（含悠遊卡）",
    description: "在行政大樓門口撿到鑰匙一串，上面掛有悠遊卡和小熊吊飾。",
    category: "keys",
    location: "行政大樓",
    date: new Date("2026-02-25"),
    createdAt: new Date("2026-02-25T11:30:00"),
    authorId: "u4",
    authorName: "陳志偉",
    claimedBy: "林小英",
    claimedAt: new Date("2026-02-26T10:00:00"),
  },
  {
    id: "lf5",
    type: "lost",
    status: "returned",
    title: "藍色保溫瓶",
    description: "象印保溫瓶，深藍色，500ml，在體育館遺失。",
    category: "other",
    location: "體育館",
    date: new Date("2026-02-20"),
    createdAt: new Date("2026-02-20T18:00:00"),
    authorId: "u5",
    authorName: "黃小華",
  },
  {
    id: "lf6",
    type: "found",
    status: "open",
    title: "蘋果充電線和充電頭",
    description: "在資工系館 3F 電腦教室撿到，Type-C 充電頭和線。",
    category: "electronics",
    location: "資工系館 3F",
    date: new Date("2026-02-28"),
    createdAt: new Date("2026-02-28T20:00:00"),
    authorId: "u6",
    authorName: "周小龍",
  },
  {
    id: "lf7",
    type: "lost",
    status: "open",
    title: "眼鏡（黑框）",
    description: "雷朋黑框眼鏡，在文學院附近遺失。有點近視度數。",
    category: "accessories",
    location: "文學院",
    date: new Date("2026-02-26"),
    createdAt: new Date("2026-02-26T13:00:00"),
    authorId: "u7",
    authorName: "吳小玲",
  },
  {
    id: "lf8",
    type: "found",
    status: "open",
    title: "微積分課本",
    description: "Stewart 微積分第八版，封面有寫名字但看不太清楚。在 S101 教室撿到。",
    category: "books",
    location: "S101 教室",
    date: new Date("2026-02-27"),
    createdAt: new Date("2026-02-27T10:30:00"),
    authorId: "u8",
    authorName: "鄭小傑",
  },
];

const ItemCard = memo(function ItemCard({ item, onPress }: { item: LostFoundItem; onPress: () => void }) {
  const categoryInfo = CATEGORY_INFO[item.category];
  const statusInfo = STATUS_INFO[item.status];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 14,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      })}
    >
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            backgroundColor: `${categoryInfo.color}20`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={categoryInfo.icon as any} size={26} color={categoryInfo.color} />
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: item.type === "lost" ? `${theme.colors.danger}20` : `${theme.colors.success}20`,
              }}
            >
              <Text
                style={{
                  color: item.type === "lost" ? theme.colors.danger : theme.colors.success,
                  fontSize: 11,
                  fontWeight: "700",
                }}
              >
                {item.type === "lost" ? "遺失" : "拾獲"}
              </Text>
            </View>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: `${statusInfo.color}20`,
              }}
            >
              <Text style={{ color: statusInfo.color, fontSize: 11, fontWeight: "600" }}>
                {statusInfo.label}
              </Text>
            </View>
          </View>

          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, marginTop: 6 }} numberOfLines={1}>
            {item.title}
          </Text>

          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
            {item.description}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="location-outline" size={13} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{item.location}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="time-outline" size={13} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{formatRelativeTime(item.createdAt)}</Text>
            </View>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} style={{ alignSelf: "center" }} />
      </View>
    </Pressable>
  );
});

export function LostFoundScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<LostFoundItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<"all" | ItemType>("all");
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory | null>(null);
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);

  useEffect(() => {
    analytics.logScreenView("LostFound");
    loadItems();
  }, [school?.id]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      if (hasDataSource() && school?.id) {
        const ds = getDataSource();
        const serverItems = await ds.listLostFoundItems(school.id);
        
        const convertedItems: LostFoundItem[] = serverItems.map((item) => ({
          id: item.id,
          type: item.type as ItemType,
          status: item.status === "active" ? "open" : item.status === "resolved" ? "returned" : item.status as ItemStatus,
          title: item.title,
          description: item.description,
          category: item.category as ItemCategory,
          location: item.location,
          date: new Date(item.date),
          createdAt: new Date(item.createdAt),
          imageUrl: item.imageUrls?.[0],
          contactInfo: item.contactInfo,
          authorId: item.reporterId,
          authorName: item.reporter?.displayName ?? "匿名用戶",
          claimedBy: undefined,
          claimedAt: item.resolvedAt ? new Date(item.resolvedAt) : undefined,
        }));
        
        setItems(convertedItems.length > 0 ? convertedItems : MOCK_ITEMS);
      } else {
        setItems(MOCK_ITEMS);
      }
    } catch (error) {
      console.error("Failed to load lost found items:", error);
      setItems(MOCK_ITEMS);
    } finally {
      setLoading(false);
    }
  }, [school?.id]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedType !== "all" && item.type !== selectedType) return false;
      if (selectedCategory && item.category !== selectedCategory) return false;
      if (showOnlyOpen && item.status !== "open") return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.location.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, selectedType, selectedCategory, showOnlyOpen, searchQuery]);

  const stats = useMemo(() => {
    const openItems = items.filter((i) => i.status === "open");
    return {
      totalOpen: openItems.length,
      lostOpen: openItems.filter((i) => i.type === "lost").length,
      foundOpen: openItems.filter((i) => i.type === "found").length,
      returned: items.filter((i) => i.status === "returned").length,
    };
  }, [items]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handlePostNew = (type: ItemType) => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能發布失物招領資訊", [
        { text: "取消", style: "cancel" },
        { text: "前往登入", onPress: () => nav?.navigate?.("MeHome") },
      ]);
      return;
    }
    nav?.navigate?.("LostFoundPost", { type });
  };

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />
        }
      >
        <AnimatedCard title="失物招領" subtitle="幫助物品回到主人身邊">
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View
              style={{
                flex: 1,
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: `${theme.colors.danger}15`,
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.colors.danger, fontWeight: "900", fontSize: 24 }}>{stats.lostOpen}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>遺失中</Text>
            </View>
            <View
              style={{
                flex: 1,
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: `${theme.colors.success}15`,
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{stats.foundOpen}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>待認領</Text>
            </View>
            <View
              style={{
                flex: 1,
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accentSoft,
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{stats.returned}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>已歸還</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <Button text="我遺失物品" kind="primary" onPress={() => handlePostNew("lost")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button text="我拾獲物品" onPress={() => handlePostNew("found")} />
            </View>
          </View>
        </AnimatedCard>

        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜尋物品名稱、描述或地點"
        />

        <View>
          <SegmentedControl
            options={[
              { key: "all", label: "全部" },
              { key: "lost", label: "遺失" },
              { key: "found", label: "拾獲" },
            ]}
            selected={selectedType}
            onChange={(k) => setSelectedType(k as "all" | ItemType)}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
            <Pressable
              onPress={() => setShowOnlyOpen(!showOnlyOpen)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: showOnlyOpen ? theme.colors.accentSoft : theme.colors.surface2,
                borderWidth: 1,
                borderColor: showOnlyOpen ? theme.colors.accent : theme.colors.border,
                gap: 6,
              }}
            >
              <Ionicons
                name={showOnlyOpen ? "checkmark-circle" : "ellipse-outline"}
                size={16}
                color={showOnlyOpen ? theme.colors.accent : theme.colors.muted}
              />
              <Text style={{ color: showOnlyOpen ? theme.colors.accent : theme.colors.muted, fontWeight: "600" }}>
                僅顯示進行中
              </Text>
            </Pressable>

            {Object.entries(CATEGORY_INFO).map(([key, info]) => (
              <Pressable
                key={key}
                onPress={() => setSelectedCategory(selectedCategory === key ? null : (key as ItemCategory))}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor:
                    selectedCategory === key ? `${info.color}20` : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: selectedCategory === key ? info.color : theme.colors.border,
                  gap: 6,
                }}
              >
                <Ionicons
                  name={info.icon as any}
                  size={14}
                  color={selectedCategory === key ? info.color : theme.colors.muted}
                />
                <Text
                  style={{
                    color: selectedCategory === key ? info.color : theme.colors.muted,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  {info.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <AnimatedCard title="物品列表" subtitle={`共 ${filteredItems.length} 筆`} delay={100}>
          {filteredItems.length === 0 ? (
            <View style={{ alignItems: "center", padding: 24 }}>
              <Ionicons name="search-outline" size={48} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, marginTop: 12, textAlign: "center" }}>
                {searchQuery || selectedCategory
                  ? "沒有符合條件的物品\n試試調整搜尋條件"
                  : "目前沒有失物招領資訊"}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <ItemCard
                  item={item}
                  onPress={() => nav?.navigate?.("LostFoundDetail", { id: item.id })}
                />
              )}
              scrollEnabled={false}
              contentContainerStyle={{ gap: 12 }}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={false}
              getItemLayout={(_, index) => ({
                length: 120,
                offset: 132 * index,
                index,
              })}
            />
          )}
        </AnimatedCard>

        <AnimatedCard title="失物招領說明" subtitle="使用須知" delay={200}>
          <View style={{ gap: 10 }}>
            <ListItem
              icon="information-circle-outline"
              title="發布規範"
              subtitle="請如實描述物品特徵，勿發布不實資訊"
            />
            <ListItem
              icon="time-outline"
              title="有效期限"
              subtitle="刊登資訊將在 30 天後自動下架"
            />
            <ListItem
              icon="shield-checkmark-outline"
              title="隱私保護"
              subtitle="聯絡資訊僅在登入後顯示"
            />
            <ListItem
              icon="location-outline"
              title="實體招領處"
              subtitle="學生事務處一樓也有實體失物招領服務"
            />
          </View>
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
