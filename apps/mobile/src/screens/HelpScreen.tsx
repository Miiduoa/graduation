import React, { useState } from "react";
import { ScrollView, Text, View, Pressable, Linking, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AnimatedCard, Button, SearchBar, FeatureHighlight, ListItem } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";

type FAQItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
};

const FAQ_DATA: FAQItem[] = [
  {
    id: "1",
    question: "如何切換學校？",
    answer: "前往「我的」→「設定」，輸入你的學校代碼（如 NCHU、PU），即可切換到對應學校的資料。",
    category: "基本操作",
  },
  {
    id: "2",
    question: "如何加入群組？",
    answer: "在「訊息」頁面點擊「進入群組」，輸入 8 碼加入碼即可加入。你也可以請群組管理員分享 QR 碼給你掃描加入。",
    category: "群組功能",
  },
  {
    id: "3",
    question: "如何收藏公告或活動？",
    answer: "在公告或活動的詳情頁面，點擊「收藏」按鈕即可。收藏的項目可以在「我的」→「收藏」中查看。",
    category: "基本操作",
  },
  {
    id: "4",
    question: "如何報名活動？",
    answer: "在活動詳情頁面點擊「立即報名」。需要先登入帳號才能報名。報名後可以在活動頁面取消報名。",
    category: "活動功能",
  },
  {
    id: "5",
    question: "如何使用 AI 助理？",
    answer: "前往「我的」→「AI 助理」，可以用自然語言詢問校園相關問題，例如「圖書館在哪裡？」、「今天有什麼活動？」",
    category: "AI 功能",
  },
  {
    id: "6",
    question: "如何啟用推播通知？",
    answer: "前往「我的」→「通知」→「前往通知設定」，開啟「啟用推播通知」。首次開啟需要授權通知權限。",
    category: "通知設定",
  },
  {
    id: "7",
    question: "如何設定免打擾時段？",
    answer: "在「通知設定」頁面，可以設定免打擾時段。在此時段內，App 不會發送推播通知。",
    category: "通知設定",
  },
  {
    id: "8",
    question: "如何使用學分試算？",
    answer: "前往「我的」→「學分試算」，可以新增已修課程，系統會自動計算各類別學分進度，並提供 AI 選課建議。",
    category: "學業功能",
  },
  {
    id: "9",
    question: "如何導航到校園地點？",
    answer: "在「地圖」頁面選擇地點，進入詳情後點擊「導航」，會自動開啟手機地圖 App 進行導航。",
    category: "地圖功能",
  },
  {
    id: "10",
    question: "如何查看餐廳菜單？",
    answer: "在「餐廳」頁面可以查看所有餐點，支援按餐廳、價格篩選。點擊餐點可查看營養資訊和評價。",
    category: "餐廳功能",
  },
  {
    id: "11",
    question: "忘記密碼怎麼辦？",
    answer: "App 內目前沒有密碼重設頁面，但可以在 Web 登入頁先輸入電子郵件，再點擊「忘記密碼？」寄送重設信。",
    category: "帳號相關",
  },
  {
    id: "12",
    question: "如何登出帳號？",
    answer: "在「我的」頁面點擊「登出」按鈕即可登出。",
    category: "帳號相關",
  },
];

const CATEGORIES = ["全部", "基本操作", "群組功能", "活動功能", "AI 功能", "通知設定", "學業功能", "地圖功能", "餐廳功能", "帳號相關"];

const GUIDES = [
  {
    id: "quickstart",
    title: "新手入門",
    description: "5 分鐘快速了解 App 的核心功能",
    icon: "rocket-outline",
    color: theme.colors.accent,
  },
  {
    id: "groups",
    title: "群組使用教學",
    description: "如何加入、建立和管理群組",
    icon: "people-outline",
    color: theme.colors.success,
  },
  {
    id: "calendar",
    title: "行事曆同步",
    description: "將活動和作業同步到手機行事曆",
    icon: "calendar-outline",
    color: "#F59E0B",
  },
  {
    id: "achievements",
    title: "成就系統介紹",
    description: "了解如何獲得成就徽章",
    icon: "trophy-outline",
    color: "#8B5CF6",
  },
];

export function HelpScreen(props: any) {
  const nav = props?.navigation;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("全部");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const filteredFAQ = FAQ_DATA.filter((item) => {
    const matchesSearch =
      searchQuery.trim() === "" ||
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "全部" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const navigateToTab = (tabName: string, screen: string) => {
    nav?.getParent?.()?.navigate?.(tabName, { screen });
  };

  const handleGuidePress = (guideId: string) => {
    switch (guideId) {
      case "quickstart":
        Alert.alert(
          "新手入門",
          "1. 先到設定輸入學校代碼\n2. 在首頁查看公告與活動\n3. 到課業頁設定課表與學分\n4. 開啟通知設定，避免錯過重要提醒",
          [
            { text: "前往首頁", onPress: () => navigateToTab("首頁", "HomeMain") },
            { text: "前往設定", onPress: () => nav?.navigate?.("Settings") },
            { text: "關閉", style: "cancel" },
          ]
        );
        return;
      case "groups":
        navigateToTab("訊息", "Groups");
        return;
      case "calendar":
        navigateToTab("課業", "Calendar");
        return;
      case "achievements":
        nav?.navigate?.("Achievements");
        return;
      default:
        return;
    }
  };

  const handleContact = () => {
    Linking.openURL("mailto:support@campus-app.com?subject=校園App問題諮詢");
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜尋常見問題..."
        />

        <AnimatedCard title="使用教學" subtitle="影片和圖文教學">
          <View style={{ gap: 10 }}>
            {GUIDES.map((guide) => (
              <Pressable
                key={guide.id}
                onPress={() => handleGuidePress(guide.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: `${guide.color}20`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={guide.icon as any} size={22} color={guide.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{guide.title}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{guide.description}</Text>
                </View>
                <Ionicons name="arrow-forward-circle-outline" size={24} color={theme.colors.accent} />
              </Pressable>
            ))}
          </View>
        </AnimatedCard>

        <AnimatedCard title="常見問題" subtitle={`共 ${filteredFAQ.length} 則`} delay={100}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => setSelectedCategory(cat)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selectedCategory === cat ? theme.colors.accent : theme.colors.border,
                  backgroundColor: selectedCategory === cat ? theme.colors.accentSoft : pressed ? "rgba(255,255,255,0.06)" : "transparent",
                })}
              >
                <Text
                  style={{
                    color: selectedCategory === cat ? theme.colors.accent : theme.colors.muted,
                    fontWeight: "600",
                    fontSize: 12,
                  }}
                >
                  {cat}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ gap: 8 }}>
            {filteredFAQ.length === 0 ? (
              <View style={{ alignItems: "center", padding: 20 }}>
                <Ionicons name="search-outline" size={40} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, marginTop: 10 }}>找不到相關問題</Text>
              </View>
            ) : (
              filteredFAQ.map((item) => {
                const isExpanded = expandedIds.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleExpand(item.id)}
                    style={{
                      padding: 14,
                      borderRadius: theme.radius.md,
                      backgroundColor: isExpanded ? theme.colors.accentSoft : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: isExpanded ? theme.colors.accent : theme.colors.border,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", lineHeight: 22 }}>
                          {item.question}
                        </Text>
                      </View>
                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={20}
                        color={theme.colors.muted}
                      />
                    </View>
                    {isExpanded && (
                      <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                        <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>{item.answer}</Text>
                        <View style={{ marginTop: 10 }}>
                          <Text style={{ color: theme.colors.accent, fontSize: 12 }}>分類：{item.category}</Text>
                        </View>
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </View>
        </AnimatedCard>

        <AnimatedCard title="仍有問題？" subtitle="聯繫我們" delay={200}>
          <View style={{ gap: 10 }}>
            <FeatureHighlight
              icon="mail-outline"
              title="Email 客服"
              description="support@campus-app.com"
              color={theme.colors.accent}
            />
            <FeatureHighlight
              icon="chatbubble-outline"
              title="意見回饋"
              description="幫助我們改善 App"
              color={theme.colors.success}
            />
          </View>
          <View style={{ marginTop: 14, gap: 10 }}>
            <Button text="發送 Email" kind="primary" onPress={handleContact} />
            <Button text="前往意見回饋" onPress={() => nav?.navigate?.("Feedback")} />
          </View>
        </AnimatedCard>

        <AnimatedCard title="App 資訊" subtitle="" delay={300}>
          <View style={{ gap: 8 }}>
            <ListItem title="版本" rightText="1.0.0 (MVP)" />
            <ListItem title="最後更新" rightText="2024 年 2 月" />
            <ListItem title="開發團隊" rightText="畢業專題團隊" />
            <ListItem
              title="隱私政策"
              rightIcon="open-outline"
              onPress={() => Linking.openURL("https://example.com/privacy")}
            />
            <ListItem
              title="使用條款"
              rightIcon="open-outline"
              onPress={() => Linking.openURL("https://example.com/terms")}
            />
          </View>
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
