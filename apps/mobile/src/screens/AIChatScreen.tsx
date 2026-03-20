import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { buildUserSchoolCollectionPath } from "@campus/shared/src";
import { Screen, Pill, AnimatedCard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";
import { useSchedule } from "../state/schedule";
import { chatWithCampusAssistant, getAIStatus, type AIMessage, type AIContext } from "../services/ai";
import { toDate } from "../utils/format";
import { getDb } from "../firebase";
import { doc, getDoc, collection, getDocs, query, orderBy, limit, where, Timestamp } from "firebase/firestore";
import { collectionFromSegments } from "../data/firestorePath";
import { getFirstStorageValue, getScopedStorageKey } from "../services/scopedStorage";
import { removePersistedValue, savePersistedValue } from "../services/persistedStorage";

const LEGACY_CHAT_HISTORY_KEY = "ai_chat_history";
const CHAT_HISTORY_MAX = 50;

type MessageRole = "user" | "assistant" | "system";

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  suggestions?: string[];
  actions?: Array<{ label: string; action: string; params?: any }>;
};

type QuickAction = {
  icon: string;
  label: string;
  prompt: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  { icon: "sparkles", label: "今日摘要", prompt: "幫我摘要今天最重要的待辦事項" },
  { icon: "trending-up", label: "提升成績", prompt: "幫我分析如何提高本學期成績，給我具體建議" },
  { icon: "time", label: "時間規劃", prompt: "幫我規劃今天剩餘時間的學習計畫" },
  { icon: "restaurant", label: "推薦餐點", prompt: "今天吃什麼好？推薦幾道餐點" },
  { icon: "map", label: "找地點", prompt: "圖書館在哪裡？怎麼走？" },
  { icon: "help-circle", label: "學習支援", prompt: "我目前學習上遇到困難，你可以怎麼幫助我？" },
];

function getContextualGreeting(): string[] {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) {
    return [
      "早安！今天有什麼我可以幫你的嗎？☀️",
      "我可以幫你整理今日行程、預習課程重點，或是回答任何問題。",
    ];
  } else if (hour >= 12 && hour < 18) {
    return [
      "午安！需要學習上的幫助嗎？📚",
      "我可以幫你分析成績、整理筆記，或是規劃下午的學習計畫。",
    ];
  } else {
    return [
      "晚安！還在努力學習嗎？🌙",
      "我可以幫你複習今天的課程重點，或是規劃明天的時間表。",
    ];
  }
}

const GREETING_MESSAGES = getContextualGreeting();

const USE_AI_SERVICE = true;

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    const createAnimation = (dot: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      );
    };

    const anim1 = createAnimation(dot1, 0);
    const anim2 = createAnimation(dot2, 150);
    const anim3 = createAnimation(dot3, 300);
    
    animationsRef.current = [anim1, anim2, anim3];
    
    anim1.start();
    anim2.start();
    anim3.start();

    return () => {
      animationsRef.current.forEach((anim) => anim.stop());
      dot1.setValue(0);
      dot2.setValue(0);
      dot3.setValue(0);
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 12 }}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.accent,
            opacity: dot,
          }}
        />
      ))}
    </View>
  );
}

function MessageBubble(props: { message: Message; onAction?: (action: string, params?: any) => void; onSuggestion?: (text: string) => void }) {
  const { message, onAction, onSuggestion } = props;
  const isUser = message.role === "user";

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(isUser ? 20 : -20)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animationRef.current = Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]);
    
    animationRef.current.start();

    return () => {
      animationRef.current?.stop();
    };
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateX: slideAnim }],
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "85%",
        marginVertical: 4,
      }}
    >
      <View
        style={{
          padding: 14,
          borderRadius: 18,
          borderBottomRightRadius: isUser ? 4 : 18,
          borderBottomLeftRadius: isUser ? 18 : 4,
          backgroundColor: isUser ? theme.colors.accent : theme.colors.surface2,
          borderWidth: isUser ? 0 : 1,
          borderColor: theme.colors.border,
        }}
      >
        <Text style={{ color: isUser ? "#fff" : theme.colors.text, lineHeight: 22 }}>{message.content}</Text>
      </View>

      {message.suggestions && message.suggestions.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {message.suggestions.map((s, i) => (
            <Pressable
              key={i}
              onPress={() => onSuggestion?.(s)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: theme.colors.accentSoft,
                borderWidth: 1,
                borderColor: `${theme.colors.accent}40`,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {message.actions && message.actions.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {message.actions.map((a, i) => (
            <Pressable
              key={i}
              onPress={() => onAction?.(a.action, a.params)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Ionicons name="open-outline" size={14} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 13 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 4, marginLeft: 4 }}>
        {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </Text>
    </Animated.View>
  );
}

export function AIChatScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const ds = useDataSource();
  const db = getDb();
  const scrollRef = useRef<ScrollView>(null);
  const { courses } = useSchedule();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [aiStatus] = useState(() => getAIStatus());
  const [pendingAssignments, setPendingAssignments] = useState<any[]>([]);
  const [weeklyReport, setWeeklyReport] = useState<any>(null);
  const chatHistoryKey = useMemo(
    () => getScopedStorageKey("ai-chat-history", { uid: auth.user?.uid ?? null, schoolId: school.id }),
    [auth.user?.uid, school.id]
  );

  const { items: announcements } = useAsyncList(() => ds.listAnnouncements(school.id), [ds, school.id]);
  const { items: events } = useAsyncList(() => ds.listEvents(school.id), [ds, school.id]);
  const { items: menus } = useAsyncList(() => ds.listMenus(school.id), [ds, school.id]);
  const { items: pois } = useAsyncList(() => ds.listPois(school.id), [ds, school.id]);

  // 從 AsyncStorage 讀取對話記錄
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const stored = await getFirstStorageValue([chatHistoryKey, LEGACY_CHAT_HISTORY_KEY]);
        if (stored) {
          const parsed: Message[] = JSON.parse(stored);
          // 還原 Date 物件（JSON 序列化後變為字串）
          const restored = parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
          if (!cancelled && restored.length > 0) {
            setMessages(restored);
          }
        }
      } catch (error) {
        console.warn("[AIChat] Failed to load history:", error);
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [chatHistoryKey]);

  // 儲存對話記錄到 AsyncStorage（排除初始問候）
  const saveHistoryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length <= 1) return; // 只有問候訊息時不儲存
    if (saveHistoryRef.current) clearTimeout(saveHistoryRef.current);
    saveHistoryRef.current = setTimeout(async () => {
      try {
        const toSave = messages.slice(-CHAT_HISTORY_MAX);
        await savePersistedValue(chatHistoryKey, toSave);
      } catch (error) {
        console.warn("[AIChat] Failed to save history:", error);
      }
    }, 500);
    return () => {
      if (saveHistoryRef.current) clearTimeout(saveHistoryRef.current);
    };
  }, [messages, chatHistoryKey]);

  // 載入個人化資料（pendingAssignments + 週報）
  useEffect(() => {
    if (!auth.user) return;
    const uid = auth.user.uid;

    async function loadPersonalData() {
      try {
        // 讀取最新週報
        const canonicalWeeklySnap = await getDocs(
          query(
            collectionFromSegments(db, buildUserSchoolCollectionPath(uid, school.id, "weeklyReports")),
            orderBy("generatedAt", "desc"),
            limit(1)
          )
        ).catch(() => ({ empty: true, docs: [] as any[] }));
        if (!canonicalWeeklySnap.empty) {
          setWeeklyReport(canonicalWeeklySnap.docs[0].data());
        } else {
          const legacyWeeklySnap = await getDocs(
            query(collection(db, "users", uid, "weeklyReports"), orderBy("generatedAt", "desc"), limit(1))
          );
          if (!legacyWeeklySnap.empty) setWeeklyReport(legacyWeeklySnap.docs[0].data());
        }

        // 讀取待繳作業（從用戶加入的群組讀取 assignments）
        const userGroupsRef = collection(db, "users", uid, "groups");
        const groupsSnap = await getDocs(query(userGroupsRef, where("status", "==", "active"), limit(10)));
        const groupIds = groupsSnap.docs.map((d) => d.id);

        const now = Timestamp.now();
        const pending: any[] = [];

        for (const gid of groupIds.slice(0, 8)) {
          const assSnap = await getDocs(
            query(
              collection(db, "groups", gid, "assignments"),
              where("dueAt", ">", now),
              orderBy("dueAt", "asc"),
              limit(5)
            )
          ).catch(() => ({ docs: [] as any[] }));

          const groupName = groupsSnap.docs.find((d) => d.id === gid)?.data()?.name ?? gid;
          for (const d of assSnap.docs) {
            pending.push({ id: d.id, groupId: gid, groupName, ...d.data() });
          }
        }

        // 按截止日排序
        pending.sort((a, b) => {
          const aTs = a.dueAt?.seconds ?? 0;
          const bTs = b.dueAt?.seconds ?? 0;
          return aTs - bTs;
        });

        setPendingAssignments(pending);
      } catch (e) {
        console.warn("[AIChatScreen] loadPersonalData error:", e);
      }
    }
    loadPersonalData();
  }, [auth.user?.uid, school.id]);

  // Function Calling 動作執行器
  const executeAIAction = async (action: string, params?: any): Promise<string | null> => {
    switch (action) {
      case "schedule_reminder": {
        const { title, dueDate } = params ?? {};
        if (!title) return null;
        try {
          const trigger = dueDate
            ? { date: new Date(dueDate) }
            : { seconds: 3600 };
          await Notifications.scheduleNotificationAsync({
            content: { title: "作業提醒", body: `別忘了完成：${title}` },
            trigger: trigger as any,
          });
          return `已為「${title}」設定提醒！`;
        } catch {
          return "設定提醒失敗，請確認通知權限已開啟。";
        }
      }
      case "search_group_knowledge": {
        const { keyword } = params ?? {};
        return keyword ? `已搜尋「${keyword}」相關群組討論，請前往群組查看。` : null;
      }
      default:
        return null;
    }
  };

  const aiContext = useMemo<AIContext>(() => ({
    schoolId: school.id,
    userId: auth.user?.uid,
    userName: auth.profile?.displayName ?? undefined,
    announcements: announcements.map((a) => ({ id: a.id, title: a.title, source: a.source })),
    events: events.map((e) => ({ id: e.id, title: e.title, location: e.location, startsAt: e.startsAt })),
    menus: menus.map((m) => ({ id: m.id, name: m.name ?? m.cafeteria, price: m.price, cafeteria: m.cafeteria })),
    pois: pois.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    // 個人化資料
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      teacher: c.teacher,
      dayOfWeek: c.dayOfWeek,
      startPeriod: c.startPeriod,
      credits: c.credits,
    })),
    pendingAssignments: pendingAssignments.map((a) => ({
      id: a.id,
      title: a.title,
      groupName: a.groupName ?? "",
      dueAt: a.dueAt ? new Date(a.dueAt.seconds * 1000).toLocaleDateString("zh-TW") : undefined,
      isLate: a.isLate,
    })),
    weeklyReport: weeklyReport ? {
      summary: weeklyReport.summary ?? "",
      stats: weeklyReport.stats ?? { onTimeRate: 100, totalSubmissions: 0, newAchievements: 0 },
    } : undefined,
  }), [school.id, auth.user?.uid, auth.profile?.displayName, announcements, events, menus, pois, courses, pendingAssignments, weeklyReport]);

  useEffect(() => {
    const providerLabel =
      aiStatus.provider === "openai"
        ? "OpenAI"
        : aiStatus.provider === "gemini"
          ? "Gemini"
          : aiStatus.provider === "cloud"
            ? "Campus Cloud"
            : "本地";
    const name = auth.profile?.displayName?.split(" ")[0] ?? (auth.user ? "同學" : "同學");
    const courseCount = courses.length;
    const greetingContent = [
      `哈囉 ${name}！我是你的校園智慧助理 🎓`,
      auth.user
        ? `我已載入你的 ${courseCount} 門課程資料，可以幫你查詢作業截止、安排提醒、推薦餐廳等。`
        : "有什麼我可以幫你的嗎？",
      "我可以幫你查詢公告、活動、餐廳資訊，也了解你的課表和學業狀況。",
    ].join("\n\n");

    const greeting: Message = {
      id: "greeting",
      role: "assistant",
      content: greetingContent + (aiStatus.provider !== "mock" ? `\n\n（使用 ${providerLabel} 智慧引擎）` : ""),
      timestamp: new Date(),
      suggestions: auth.user
        ? ["我有哪些作業快截止？", "今天推薦吃什麼？", "幫我找圖書館"]
        : ["今天有什麼公告？", "推薦今天的午餐", "我想找圖書館"],
    };
    setMessages([greeting]);
  }, [auth.user?.uid, courses.length]);

  const generateResponse = async (userMessage: string): Promise<Message> => {
    const lowerMsg = userMessage.toLowerCase();

    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));

    if (lowerMsg.includes("公告") || lowerMsg.includes("消息") || lowerMsg.includes("通知")) {
      const recent = announcements.slice(0, 3);
      if (recent.length === 0) {
        return {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: "目前沒有新的公告。你可以稍後再查看，或是問我其他問題！",
          timestamp: new Date(),
        };
      }
      const list = recent.map((a, i) => `${i + 1}. ${a.title}`).join("\n");
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `最近有 ${announcements.length} 則公告，以下是最新的幾則：\n\n${list}\n\n要看哪一則的詳情嗎？`,
        timestamp: new Date(),
        actions: recent.map((a) => ({
          label: `查看「${a.title.slice(0, 10)}...」`,
          action: "navigate",
          params: { screen: "Today", nested: "公告詳情", id: a.id },
        })),
      };
    }

    if (lowerMsg.includes("活動") || lowerMsg.includes("報名") || lowerMsg.includes("參加")) {
      const upcoming = events.filter((e) => {
        const start = toDate(e.startsAt);
        return start ? start > new Date() : false;
      }).slice(0, 3);

      if (upcoming.length === 0) {
        return {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: "近期沒有即將舉辦的活動。我會持續關注，有新活動時再通知你！",
          timestamp: new Date(),
          suggestions: ["查看過去活動", "訂閱活動通知"],
        };
      }

      const list = upcoming.map((e, i) => `${i + 1}. ${e.title}${e.location ? ` (${e.location})` : ""}`).join("\n");
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `近期有 ${upcoming.length} 個活動可以參加：\n\n${list}\n\n想報名哪一個？`,
        timestamp: new Date(),
        actions: upcoming.map((e) => ({
          label: `報名「${e.title.slice(0, 8)}...」`,
          action: "navigate",
          params: { screen: "Today", nested: "活動詳情", id: e.id },
        })),
      };
    }

    if (lowerMsg.includes("吃") || lowerMsg.includes("餐") || lowerMsg.includes("午餐") || lowerMsg.includes("晚餐") || lowerMsg.includes("推薦")) {
      const shuffled = [...menus].sort(() => Math.random() - 0.5).slice(0, 3);
      if (shuffled.length === 0) {
        return {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: "目前沒有菜單資料。不過你可以去學餐實地看看，說不定會有驚喜！",
          timestamp: new Date(),
        };
      }

      const list = shuffled.map((m, i) => `${i + 1}. ${m.name ?? m.cafeteria} - $${m.price ?? "?"}`).join("\n");
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `讓我幫你推薦幾道餐點：\n\n${list}\n\n今天想吃什麼口味的？我可以幫你篩選！`,
        timestamp: new Date(),
        suggestions: ["便宜的", "有肉的", "素食"],
        actions: shuffled.map((m) => ({
          label: `查看「${(m.name ?? m.cafeteria).slice(0, 8)}」`,
          action: "navigate",
          params: { screen: "校園", nested: "MenuDetail", id: m.id },
        })),
      };
    }

    if (lowerMsg.includes("圖書館") || lowerMsg.includes("教室") || lowerMsg.includes("在哪") || lowerMsg.includes("怎麼走") || lowerMsg.includes("地點")) {
      let keyword = "";
      if (lowerMsg.includes("圖書館")) keyword = "圖書館";
      else if (lowerMsg.includes("行政")) keyword = "行政";
      else if (lowerMsg.includes("餐廳")) keyword = "餐廳";

      const matches = keyword ? pois.filter((p) => p.name.includes(keyword) || p.category.includes(keyword)) : pois.slice(0, 3);

      if (matches.length === 0) {
        return {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: "抱歉，我找不到這個地點。你可以告訴我更具體的名稱，或是直接去地圖頁面搜尋！",
          timestamp: new Date(),
          actions: [{ label: "開啟地圖", action: "navigate", params: { screen: "校園" } }],
        };
      }

      const poi = matches[0];
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `找到了！「${poi.name}」位於 ${poi.category} 區域。\n\n${poi.description}\n\n要開啟導航嗎？`,
        timestamp: new Date(),
        actions: [
          { label: "查看詳情", action: "navigate", params: { screen: "校園", nested: "PoiDetail", id: poi.id } },
          { label: "開始導航", action: "navigate", params: { screen: "校園", nested: "PoiDetail", id: poi.id } },
        ],
      };
    }

    if (lowerMsg.includes("學分") || lowerMsg.includes("畢業") || lowerMsg.includes("選課")) {
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: "你可以到「學分試算」功能查看目前的學分狀況！\n\n我會根據你的修課記錄，幫你計算還差多少學分才能畢業，並給予選課建議。",
        timestamp: new Date(),
        actions: [{ label: "前往學分試算", action: "navigate", params: { screen: "我的", nested: "CreditAuditStack" } }],
        suggestions: ["怎麼新增課程？", "哪些是必修？"],
      };
    }

    if (lowerMsg.includes("功能") || lowerMsg.includes("怎麼用") || lowerMsg.includes("說明") || lowerMsg.includes("幫助")) {
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `這個 APP 有很多功能喔！讓我介紹一下：

📣 **公告** - 查看學校最新公告，支援 AI 摘要
📅 **活動** - 瀏覽校園活動，一鍵報名
🗺️ **地圖** - 校園導航，即時人潮資訊
🍽️ **餐廳** - 查看菜單、評價、等候時間
💬 **群組** - 課程討論、作業繳交、私訊
📚 **學分** - 畢業學分試算與選課建議
📆 **行事曆** - 活動與作業截止日期整合

有什麼想深入了解的嗎？`,
        timestamp: new Date(),
        suggestions: ["公告怎麼用？", "怎麼報名活動？", "怎麼加入群組？"],
      };
    }

    const genericResponses = [
      "我理解你的問題，讓我想想...\n\n這部分我可能需要更多資訊才能幫到你。可以說得更具體一點嗎？",
      "感謝你的提問！\n\n目前我主要能幫你查詢公告、活動、餐廳和地點資訊。有需要這些方面的協助嗎？",
      "這是個好問題！\n\n不過這超出了我目前的能力範圍。你可以試著用其他方式描述，或是問我校園相關的問題。",
    ];

    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: genericResponses[Math.floor(Math.random() * genericResponses.length)],
      timestamp: new Date(),
      suggestions: ["今天有什麼公告？", "推薦午餐", "找地點"],
    };
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    let response: Message;

    if (USE_AI_SERVICE) {
      const aiMessages: AIMessage[] = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      aiMessages.push({ role: "user", content: userMsg.content });

      const aiResponse = await chatWithCampusAssistant(aiMessages, aiContext);

      response = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: aiResponse.error ? `抱歉，發生錯誤：${aiResponse.error}` : aiResponse.content,
        timestamp: new Date(),
        suggestions: aiResponse.suggestions,
        actions: aiResponse.actions,
      };
    } else {
      response = await generateResponse(userMsg.content);
    }

    setIsTyping(false);
    setMessages((prev) => [...prev, response]);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleAction = async (action: string, params?: any) => {
    if (action === "navigate" && params) {
      if (params.nested) {
        nav?.navigate?.(params.screen, { screen: params.nested, params: { id: params.id } });
      } else {
        nav?.navigate?.(params.screen);
      }
      return;
    }

    // Function Calling 執行
    const result = await executeAIAction(action, params);
    if (result) {
      const actionResultMsg: Message = {
        id: `action-${Date.now()}`,
        role: "assistant",
        content: result,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, actionResultMsg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
    setTimeout(() => handleSend(), 100);
  };

  const handleQuickAction = (action: QuickAction) => {
    setInput(action.prompt);
    setTimeout(() => handleSend(), 100);
  };

  const handleClearHistory = useCallback(() => {
    Alert.alert("清除對話記錄", "確定要清除所有對話記錄嗎？", [
      { text: "取消", style: "cancel" },
      {
        text: "清除",
        style: "destructive",
        onPress: async () => {
          try {
            await removePersistedValue(chatHistoryKey);
          } catch (error) {
            console.warn("[AIChat] Failed to clear history:", error);
          }
          // 重設回歡迎訊息
          const name = auth.profile?.displayName?.split(" ")[0] ?? "同學";
          const greeting: Message = {
            id: "greeting",
            role: "assistant",
            content: `哈囉 ${name}！對話記錄已清除。有什麼我可以幫你的嗎？`,
            timestamp: new Date(),
            suggestions: ["今天有什麼公告？", "推薦午餐", "找地點"],
          };
          setMessages([greeting]);
        },
      },
    ]);
  }, [auth.profile?.displayName, chatHistoryKey]);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={90}
      >
        <View style={{ flex: 1 }}>
          {messages.length <= 1 && (
            <View style={{ padding: 12 }}>
              <Text style={{ color: theme.colors.muted, marginBottom: 12, textAlign: "center" }}>
                試試這些快捷指令
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                {QUICK_ACTIONS.map((action) => (
                  <Pressable
                    key={action.label}
                    onPress={() => handleQuickAction(action)}
                    style={{
                      alignItems: "center",
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      minWidth: 80,
                    }}
                  >
                    <Ionicons name={action.icon as any} size={24} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.text, fontSize: 12, marginTop: 6 }}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onAction={handleAction}
                onSuggestion={handleSuggestion}
              />
            ))}
            {isTyping && (
              <View style={{ alignSelf: "flex-start", marginTop: 8 }}>
                <View
                  style={{
                    padding: 8,
                    borderRadius: 18,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <TypingIndicator />
                </View>
              </View>
            )}
          </ScrollView>
        </View>

        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: 12,
            paddingBottom: Platform.OS === "ios" ? 24 : 12,
            backgroundColor: theme.colors.bg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 8,
              borderRadius: 999,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Pressable
              onPress={handleClearHistory}
              style={({ pressed }) => ({
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                alignItems: "center", justifyContent: "center",
              })}
            >
              <Ionicons name="trash-outline" size={18} color={theme.colors.muted} />
            </Pressable>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="輸入訊息..."
              placeholderTextColor={theme.colors.muted}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
                color: theme.colors.text,
                fontSize: 15,
              }}
            />
            <Pressable
              onPress={handleSend}
              disabled={!input.trim()}
              style={({ pressed }) => ({
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: input.trim() ? theme.colors.accent : theme.colors.surface2,
                alignItems: "center", justifyContent: "center",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="send" size={18} color={input.trim() ? "#fff" : theme.colors.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
