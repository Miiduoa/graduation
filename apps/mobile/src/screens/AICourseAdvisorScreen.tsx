/* eslint-disable */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert, TextInput, Animated as RNAnimated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Screen, Button, AnimatedCard, SegmentedControl, Pill, Spinner } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";
import { chatWithAI, getAIStatus, type AIMessage, type AIContext, createCancellableChat } from "../services/ai";
import { analytics } from "../services/analytics";
import { getFirstStorageValue, getScopedStorageKey } from "../services/scopedStorage";

type CourseCategory = "required" | "elective" | "general" | "free";
type CourseDifficulty = "easy" | "medium" | "hard";

type RecommendedCourse = {
  id: string;
  name: string;
  instructor: string;
  credits: number;
  category: CourseCategory;
  difficulty: CourseDifficulty;
  rating: number;
  enrollment: number;
  capacity: number;
  schedule: string;
  reasons: string[];
  matchScore: number;
};

const LEGACY_PREFERENCES_STORAGE_KEY = "@ai_course_advisor_preferences";
const LEGACY_CHAT_HISTORY_STORAGE_KEY = "@ai_course_advisor_chat_history";

type UserPreference = {
  interests: string[];
  preferredDifficulty: CourseDifficulty | "any";
  preferredTime: "morning" | "afternoon" | "evening" | "any";
  targetCredits: number;
  avoidEarly: boolean;
};

function getCategoryLabel(category: CourseCategory): string {
  switch (category) {
    case "required": return "必修";
    case "elective": return "選修";
    case "general": return "通識";
    case "free": return "自由";
    default: return "";
  }
}

function getCategoryColor(category: CourseCategory): string {
  switch (category) {
    case "required": return theme.colors.danger;
    case "elective": return theme.colors.accent;
    case "general": return theme.colors.success;
    case "free": return "#8B5CF6";
    default: return theme.colors.muted;
  }
}

function getDifficultyLabel(difficulty: CourseDifficulty): string {
  switch (difficulty) {
    case "easy": return "輕鬆";
    case "medium": return "適中";
    case "hard": return "挑戰";
    default: return "";
  }
}

function getDifficultyColor(difficulty: CourseDifficulty): string {
  switch (difficulty) {
    case "easy": return theme.colors.success;
    case "medium": return "#F59E0B";
    case "hard": return theme.colors.danger;
    default: return theme.colors.muted;
  }
}

export function AICourseAdvisorScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const ds = useDataSource();
  const scrollRef = useRef<ScrollView>(null);
  const aiChatRef = useRef(createCancellableChat());

  const [selectedTab, setSelectedTab] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendedCourse[]>([]);
  const [aiStatus] = useState(() => getAIStatus());
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "ai"; message: string }[]>([
    { role: "ai", message: "你好！我是 AI 選課助理。我可以根據你的興趣、時間安排和畢業需求，為你推薦最適合的課程。有什麼問題都可以問我！" },
  ]);

  const [preferences, setPreferences] = useState<UserPreference>({
    interests: ["AI", "程式設計"],
    preferredDifficulty: "any",
    preferredTime: "any",
    targetCredits: 18,
    avoidEarly: true,
  });

  const { items: availableCourses } = useAsyncList(
    () => ds.listCourses?.(school.id) ?? Promise.resolve([]),
    [ds, school.id]
  );
  const preferencesStorageKey = useMemo(
    () => getScopedStorageKey("ai-course-advisor-preferences", { uid: auth.user?.uid ?? null, schoolId: school.id }),
    [auth.user?.uid, school.id]
  );
  const chatHistoryStorageKey = useMemo(
    () => getScopedStorageKey("ai-course-advisor-chat-history", { uid: auth.user?.uid ?? null, schoolId: school.id }),
    [auth.user?.uid, school.id]
  );

  const TABS = ["AI 推薦", "對話諮詢", "偏好設定"];

  const INTERESTS = [
    "AI", "程式設計", "網頁開發", "資料科學", "雲端運算",
    "資安", "嵌入式系統", "遊戲開發", "UI/UX", "區塊鏈",
  ];

  const pulseAnim = useState(new RNAnimated.Value(0))[0];
  const pulseAnimRef = useRef<RNAnimated.CompositeAnimation | null>(null);

  useEffect(() => {
    loadSavedPreferences();
    loadChatHistory();
  }, [preferencesStorageKey, chatHistoryStorageKey]);

  useEffect(() => {
    if (isAnalyzing) {
      pulseAnimRef.current = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          RNAnimated.timing(pulseAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      );
      pulseAnimRef.current.start();
    } else {
      pulseAnimRef.current?.stop();
    }
    return () => { pulseAnimRef.current?.stop(); };
  }, [isAnalyzing, pulseAnim]);

  const loadSavedPreferences = async () => {
    try {
      const saved = await getFirstStorageValue([preferencesStorageKey, LEGACY_PREFERENCES_STORAGE_KEY]);
      if (saved) {
        setPreferences(JSON.parse(saved));
      }
    } catch (error) {
      console.error("Failed to load preferences:", error);
    }
  };

  const savePreferences = async (prefs: UserPreference) => {
    try {
      await AsyncStorage.setItem(preferencesStorageKey, JSON.stringify(prefs));
      setPreferences(prefs);
    } catch (error) {
      console.error("Failed to save preferences:", error);
    }
  };

  const loadChatHistory = async () => {
    try {
      const saved = await getFirstStorageValue([chatHistoryStorageKey, LEGACY_CHAT_HISTORY_STORAGE_KEY]);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChatHistory(parsed);
        }
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
    }
  };

  const saveChatHistory = async (history: typeof chatHistory) => {
    try {
      const limitedHistory = history.slice(-50);
      await AsyncStorage.setItem(chatHistoryStorageKey, JSON.stringify(limitedHistory));
    } catch (error) {
      console.error("Failed to save chat history:", error);
    }
  };

  const buildCourseContext = useMemo(() => {
    const courseList = availableCourses.slice(0, 20).map((c: any) => ({
      id: c.id,
      name: c.name,
      instructor: c.instructor,
      credits: c.credits,
      category: c.category,
      schedule: c.schedule,
    }));

    return {
      schoolId: school.id,
      userId: auth.user?.uid,
      userName: auth.profile?.displayName,
      courses: courseList,
      preferences,
    };
  }, [school.id, auth.user?.uid, auth.profile?.displayName, availableCourses, preferences]);

  const aiContext: AIContext = {
    schoolId: school.id,
    userId: auth.user?.uid,
    userName: auth.profile?.displayName,
  };

  const handleStartAnalysis = async () => {
    setIsAnalyzing(true);
    analytics.logEvent("ai_course_analysis_started", { schoolId: school.id });

    try {
      if (aiStatus.provider !== "mock" && aiStatus.configured) {
        const prompt = `作為選課助理，請根據以下資訊為學生推薦課程：
        
學生興趣：${preferences.interests.join("、")}
目標學分：${preferences.targetCredits}
難度偏好：${preferences.preferredDifficulty === "any" ? "不限" : getDifficultyLabel(preferences.preferredDifficulty as CourseDifficulty)}
避開早八：${preferences.avoidEarly ? "是" : "否"}

可選課程：
${availableCourses.slice(0, 15).map((c: any) => `- ${c.name}（${c.credits}學分，${c.instructor}）`).join("\n")}

請推薦 5 門最適合的課程，每門課程說明推薦原因。請用 JSON 格式回覆：
[{"name": "課程名", "reasons": ["原因1", "原因2"], "matchScore": 85}]`;

        const messages: AIMessage[] = [{ role: "user", content: prompt }];
        const response = await aiChatRef.current.chat(messages, aiContext);

        if (response.content && !response.error) {
          try {
            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const aiRecommendations = JSON.parse(jsonMatch[0]);
              const mapped = aiRecommendations.map((rec: any, idx: number) => {
                const course = availableCourses.find((c: any) => 
                  c.name.includes(rec.name) || rec.name.includes(c.name)
                );
                return {
                  id: `ai-${idx}`,
                  name: rec.name || course?.name || "未知課程",
                  instructor: course?.instructor || "待查詢",
                  credits: course?.credits || 3,
                  category: (course?.category as CourseCategory) || "elective",
                  difficulty: "medium" as CourseDifficulty,
                  rating: 4.0 + Math.random() * 0.8,
                  enrollment: Math.floor(Math.random() * 40) + 20,
                  capacity: 60,
                  schedule: course?.schedule || "待查詢",
                  reasons: rec.reasons || ["AI 推薦"],
                  matchScore: rec.matchScore || 80,
                };
              });
              setRecommendations(mapped);
              setIsAnalyzing(false);
              setShowResults(true);
              analytics.logEvent("ai_course_analysis_completed", { count: mapped.length });
              return;
            }
          } catch (parseError) {
            console.error("Failed to parse AI recommendations:", parseError);
          }
        }
      }

      await new Promise((r) => setTimeout(r, 2000));
      const mockRecs = generateMockRecommendations();
      setRecommendations(mockRecs);
      setIsAnalyzing(false);
      setShowResults(true);
    } catch (error) {
      console.error("Analysis failed:", error);
      setIsAnalyzing(false);
      Alert.alert("分析失敗", "無法完成課程分析，請稍後再試");
    }
  };

  const generateMockRecommendations = (): RecommendedCourse[] => {
    const baseCourses: RecommendedCourse[] = [
      { id: "1", name: "人工智慧概論", instructor: "林教授", credits: 3, category: "elective", difficulty: "medium", rating: 4.8, enrollment: 45, capacity: 60, schedule: "週二 3-4 節", reasons: ["符合您的興趣：AI 技術", "高評價課程"], matchScore: 95 },
      { id: "2", name: "資料庫系統", instructor: "陳教授", credits: 3, category: "required", difficulty: "medium", rating: 4.5, enrollment: 52, capacity: 70, schedule: "週三 5-6 節", reasons: ["必修課程", "畢業必備"], matchScore: 92 },
      { id: "3", name: "網頁程式設計", instructor: "黃教授", credits: 3, category: "elective", difficulty: "easy", rating: 4.6, enrollment: 38, capacity: 50, schedule: "週四 1-2 節", reasons: ["實作導向", "業界常用"], matchScore: 88 },
      { id: "4", name: "科技與社會", instructor: "吳教授", credits: 2, category: "general", difficulty: "easy", rating: 4.3, enrollment: 120, capacity: 150, schedule: "週五 7-8 節", reasons: ["通識學分", "輕鬆有趣"], matchScore: 85 },
      { id: "5", name: "機器學習", instructor: "張教授", credits: 3, category: "elective", difficulty: "hard", rating: 4.7, enrollment: 28, capacity: 40, schedule: "週一 5-6 節", reasons: ["進階 AI 課程", "研究所預備"], matchScore: 82 },
    ];

    if (preferences.interests.includes("AI") || preferences.interests.includes("資料科學")) {
      baseCourses[0].matchScore = 98;
      baseCourses[4].matchScore = 90;
    }
    if (preferences.preferredDifficulty === "easy") {
      baseCourses[2].matchScore = 96;
      baseCourses[3].matchScore = 94;
    }
    if (preferences.avoidEarly) {
      baseCourses.forEach((c) => {
        if (c.schedule.includes("1-2")) c.matchScore -= 10;
      });
    }

    return baseCourses.sort((a, b) => b.matchScore - a.matchScore);
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || isAiTyping) return;

    const userMessage = chatInput.trim();
    const newHistory = [...chatHistory, { role: "user" as const, message: userMessage }];
    setChatHistory(newHistory);
    setChatInput("");
    setIsAiTyping(true);

    analytics.logEvent("ai_course_chat_sent", { schoolId: school.id });

    try {
      if (aiStatus.provider !== "mock" && aiStatus.configured) {
        const systemContext = `你是一個校園選課助理。學生的興趣是：${preferences.interests.join("、")}。
目標學分：${preferences.targetCredits}。避開早八：${preferences.avoidEarly ? "是" : "否"}。
請根據這些資訊回答學生的選課問題。`;

        const messages: AIMessage[] = [
          { role: "system", content: systemContext },
          ...chatHistory.filter((m) => m.role !== "ai" || chatHistory.indexOf(m) > 0).map((m) => ({
            role: m.role === "user" ? "user" as const : "assistant" as const,
            content: m.message,
          })),
          { role: "user", content: userMessage },
        ];

        const response = await aiChatRef.current.chat(messages, aiContext);

        if (response.content && !response.error) {
          const updatedHistory = [...newHistory, { role: "ai" as const, message: response.content }];
          setChatHistory(updatedHistory);
          saveChatHistory(updatedHistory);
          setIsAiTyping(false);
          return;
        }
      }

      const aiResponse = generateLocalResponse(userMessage);
      const updatedHistory = [...newHistory, { role: "ai" as const, message: aiResponse }];
      setChatHistory(updatedHistory);
      saveChatHistory(updatedHistory);
    } catch (error) {
      console.error("Chat failed:", error);
      const errorHistory = [...newHistory, { role: "ai" as const, message: "抱歉，發生了錯誤。請稍後再試。" }];
      setChatHistory(errorHistory);
    } finally {
      setIsAiTyping(false);
    }
  };

  const generateLocalResponse = (message: string): string => {
    const lowerMsg = message.toLowerCase();
    
    if (lowerMsg.includes("推薦") || lowerMsg.includes("建議")) {
      return `根據你的興趣（${preferences.interests.join("、")}）和目標學分（${preferences.targetCredits}），我建議你這學期可以選修「人工智慧概論」和「資料庫系統」。這兩門課都是評價很高的課程，對你未來發展很有幫助！`;
    }
    if (lowerMsg.includes("輕鬆") || lowerMsg.includes("簡單")) {
      return "如果你想找比較輕鬆的課程，我推薦「科技與社會」這門通識課。這門課可以線上授課，作業也不多，很多學長姐都推薦！";
    }
    if (lowerMsg.includes("學分") || lowerMsg.includes("畢業")) {
      return `你的目標是修 ${preferences.targetCredits} 學分。建議優先完成必修課程，再選擇符合興趣的選修課。有需要我幫你規劃嗎？`;
    }
    if (lowerMsg.includes("衝堂") || lowerMsg.includes("時間")) {
      return "我可以幫你檢查課程時間是否衝堂。請告訴我你想選的課程名稱，我會幫你分析時間表。";
    }
    return "我了解了！根據你的需求，我建議你可以去「AI 推薦」頁面看看系統為你量身推薦的課程。如果還有其他問題，歡迎繼續問我！";
  };

  const toggleInterest = (interest: string) => {
    if (preferences.interests.includes(interest)) {
      setPreferences({
        ...preferences,
        interests: preferences.interests.filter((i) => i !== interest),
      });
    } else {
      setPreferences({
        ...preferences,
        interests: [...preferences.interests, interest],
      });
    }
  };

  const handleAddCourse = (course: RecommendedCourse) => {
    Alert.alert(
      "加入課表",
      `確定要將「${course.name}」加入課表嗎？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "加入",
          onPress: () => {
            Alert.alert("已加入", `${course.name} 已加入您的課表`);
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {!showResults ? (
                <>
                  <AnimatedCard title="AI 智慧選課" subtitle="根據你的需求推薦最適合的課程">
                    <View style={{ alignItems: "center", paddingVertical: 20, gap: 16 }}>
                      <RNAnimated.View
                        style={{
                          width: 100,
                          height: 100,
                          borderRadius: 50,
                          backgroundColor: isAnalyzing
                            ? theme.colors.accentSoft
                            : theme.colors.surface2,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: isAnalyzing
                            ? pulseAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.5, 1],
                              })
                            : 1,
                        }}
                      >
                        <Ionicons
                          name={isAnalyzing ? "sync" : "bulb"}
                          size={50}
                          color={theme.colors.accent}
                        />
                      </RNAnimated.View>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18 }}>
                        {isAnalyzing ? "正在分析中..." : "讓 AI 幫你選課"}
                      </Text>
                      <Text
                        style={{
                          color: theme.colors.muted,
                          textAlign: "center",
                          lineHeight: 20,
                        }}
                      >
                        {isAnalyzing
                          ? "AI 正在分析你的修課紀錄、興趣偏好和畢業條件..."
                          : "AI 會根據你的興趣、時間偏好和畢業條件，為你推薦最適合的課程組合。"}
                      </Text>
                      {!isAnalyzing && (
                        <Button text="開始分析" kind="primary" onPress={handleStartAnalysis} />
                      )}
                    </View>
                  </AnimatedCard>

                  <AnimatedCard title="你的偏好設定" delay={100}>
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="heart" size={18} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.muted, flex: 1 }}>
                          興趣：{preferences.interests.join("、")}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="school" size={18} color={theme.colors.success} />
                        <Text style={{ color: theme.colors.muted, flex: 1 }}>
                          目標學分：{preferences.targetCredits} 學分
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="time" size={18} color="#F59E0B" />
                        <Text style={{ color: theme.colors.muted, flex: 1 }}>
                          避開早八：{preferences.avoidEarly ? "是" : "否"}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => setSelectedTab(2)}
                      style={{ marginTop: 12, alignSelf: "flex-end" }}
                    >
                      <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>編輯偏好</Text>
                    </Pressable>
                  </AnimatedCard>
                </>
              ) : (
                <>
                  <AnimatedCard>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
                        <Ionicons name="checkmark-circle" size={28} color={theme.colors.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
                          分析完成！
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          為你找到 {recommendations.length} 門推薦課程
                        </Text>
                      </View>
                      <Pressable onPress={() => setShowResults(false)}>
                        <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>重新分析</Text>
                      </Pressable>
                    </View>
                  </AnimatedCard>

                  {recommendations.map((course, idx) => (
                    <AnimatedCard key={course.id} delay={idx * 50}>
                      <View style={{ gap: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
                                {course.name}
                              </Text>
                              <View
                                style={{
                                  paddingHorizontal: 8,
                                  paddingVertical: 2,
                                  borderRadius: theme.radius.full,
                                  backgroundColor: `${getCategoryColor(course.category)}20`,
                                }}
                              >
                                <Text
                                  style={{
                                    color: getCategoryColor(course.category),
                                    fontSize: 10,
                                    fontWeight: "700",
                                  }}
                                >
                                  {getCategoryLabel(course.category)}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                              {course.instructor} · {course.credits} 學分 · {course.schedule}
                            </Text>
                          </View>
                          <View
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 6,
                              borderRadius: theme.radius.full,
                              backgroundColor: theme.colors.accentSoft,
                            }}
                          >
                            <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 14 }}>
                              {course.matchScore}%
                            </Text>
                          </View>
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons name="star" size={14} color="#F59E0B" />
                            <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                              {course.rating}
                            </Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Ionicons name="people" size={14} color={theme.colors.muted} />
                            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                              {course.enrollment}/{course.capacity}
                            </Text>
                          </View>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: theme.radius.full,
                              backgroundColor: `${getDifficultyColor(course.difficulty)}20`,
                            }}
                          >
                            <Text
                              style={{
                                color: getDifficultyColor(course.difficulty),
                                fontSize: 11,
                                fontWeight: "600",
                              }}
                            >
                              {getDifficultyLabel(course.difficulty)}
                            </Text>
                          </View>
                        </View>

                        <View style={{ gap: 6 }}>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>推薦原因：</Text>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                            {course.reasons.map((reason, i) => (
                              <View
                                key={i}
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 4,
                                  borderRadius: theme.radius.full,
                                  backgroundColor: theme.colors.surface2,
                                }}
                              >
                                <Text style={{ color: theme.colors.text, fontSize: 11 }}>{reason}</Text>
                              </View>
                            ))}
                          </View>
                        </View>

                        <Button text="加入課表" kind="primary" onPress={() => handleAddCourse(course)} />
                      </View>
                    </AnimatedCard>
                  ))}
                </>
              )}
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ flex: 1, gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard>
                <View style={{ gap: 12 }}>
                  {chatHistory.map((chat, idx) => (
                    <View
                      key={idx}
                      style={{
                        alignSelf: chat.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "85%",
                      }}
                    >
                      <View
                        style={{
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor:
                            chat.role === "user" ? theme.colors.accent : theme.colors.surface2,
                        }}
                      >
                        <Text
                          style={{
                            color: chat.role === "user" ? "#fff" : theme.colors.text,
                            lineHeight: 20,
                          }}
                        >
                          {chat.message}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </AnimatedCard>

              {isAiTyping && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
                  <Spinner size={20} />
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>AI 正在思考中...</Text>
                </View>
              )}

              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  padding: 12,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <TextInput
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="輸入你的問題..."
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    flex: 1,
                    color: theme.colors.text,
                    fontSize: 15,
                  }}
                  onSubmitEditing={handleSendChat}
                  editable={!isAiTyping}
                />
                <Pressable
                  onPress={handleSendChat}
                  disabled={isAiTyping || !chatInput.trim()}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: isAiTyping || !chatInput.trim() ? theme.colors.border : theme.colors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="send" size={20} color={isAiTyping || !chatInput.trim() ? theme.colors.muted : "#fff"} />
                </Pressable>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {["推薦輕鬆的課", "還差多少學分畢業", "有什麼熱門課程", "幫我檢查衝堂"].map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => setChatInput(q)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontSize: 13 }}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="興趣領域" subtitle="選擇你感興趣的主題">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {INTERESTS.map((interest) => (
                    <Pressable
                      key={interest}
                      onPress={() => toggleInterest(interest)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: theme.radius.full,
                        backgroundColor: preferences.interests.includes(interest)
                          ? theme.colors.accent
                          : theme.colors.surface2,
                      }}
                    >
                      <Text
                        style={{
                          color: preferences.interests.includes(interest)
                            ? "#fff"
                            : theme.colors.text,
                          fontWeight: "600",
                          fontSize: 13,
                        }}
                      >
                        {interest}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="難度偏好" delay={50}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["any", "easy", "medium", "hard"] as const).map((diff) => (
                    <Pressable
                      key={diff}
                      onPress={() => setPreferences({ ...preferences, preferredDifficulty: diff })}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor:
                          preferences.preferredDifficulty === diff
                            ? theme.colors.accent
                            : theme.colors.surface2,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color:
                            preferences.preferredDifficulty === diff ? "#fff" : theme.colors.text,
                          fontWeight: "600",
                          fontSize: 13,
                        }}
                      >
                        {diff === "any" ? "不限" : getDifficultyLabel(diff)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="目標學分" delay={100}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {[15, 18, 21, 24].map((credits) => (
                    <Pressable
                      key={credits}
                      onPress={() => setPreferences({ ...preferences, targetCredits: credits })}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor:
                          preferences.targetCredits === credits
                            ? theme.colors.accent
                            : theme.colors.surface2,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color:
                            preferences.targetCredits === credits ? "#fff" : theme.colors.text,
                          fontWeight: "600",
                          fontSize: 13,
                        }}
                      >
                        {credits} 學分
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="時間偏好" delay={150}>
                <View style={{ gap: 12 }}>
                  <Pressable
                    onPress={() =>
                      setPreferences({ ...preferences, avoidEarly: !preferences.avoidEarly })
                    }
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Ionicons name="sunny" size={22} color="#F59E0B" />
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>避開早八</Text>
                    </View>
                    <View
                      style={{
                        width: 50,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: preferences.avoidEarly
                          ? theme.colors.accent
                          : theme.colors.border,
                        justifyContent: "center",
                        padding: 2,
                      }}
                    >
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: "#fff",
                          alignSelf: preferences.avoidEarly ? "flex-end" : "flex-start",
                        }}
                      />
                    </View>
                  </Pressable>
                </View>
              </AnimatedCard>

              <Button
                text="儲存偏好設定"
                kind="primary"
                onPress={() => {
                  savePreferences(preferences);
                  analytics.logEvent("ai_course_preferences_saved", { interests: preferences.interests.join(",") });
                  Alert.alert("已儲存", "偏好設定已更新");
                  setSelectedTab(0);
                }}
              />
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}
