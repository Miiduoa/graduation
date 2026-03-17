import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Dimensions,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen, Button } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, shadowStyle } from "../ui/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ONBOARDING_KEY = "@has_seen_onboarding";
const SCHOOL_SELECTION_KEY = "campus.schoolSelection.v1";

type OnboardingSlide = {
  id: string;
  icon: string;
  title: string;
  description: string;
  color: string;
  emoji: string;
};

type SchoolOption = {
  code: string;
  name: string;
  shortName: string;
};

const AVAILABLE_SCHOOLS: SchoolOption[] = [
  { code: "NCHU", name: "國立中興大學", shortName: "中興" },
  { code: "NTU", name: "國立台灣大學", shortName: "台大" },
  { code: "NCKU", name: "國立成功大學", shortName: "成大" },
  { code: "NTHU", name: "國立清華大學", shortName: "清大" },
  { code: "NCTU", name: "國立陽明交通大學", shortName: "陽交大" },
  { code: "NCU", name: "國立中央大學", shortName: "中央" },
  { code: "NSYSU", name: "國立中山大學", shortName: "中山" },
  { code: "NTNU", name: "國立台灣師範大學", shortName: "台師大" },
];

const SLIDES: OnboardingSlide[] = [
  {
    id: "welcome",
    icon: "school-outline",
    title: "歡迎使用\n校園助手",
    description: "一個 App，掌握所有校園資訊\n公告、課表、地圖、餐廳，一應俱全",
    color: "#6366F1",
    emoji: "🎓",
  },
  {
    id: "schedule",
    icon: "calendar-outline",
    title: "智慧課表\n輕鬆管理",
    description: "自動同步課程資訊，提醒上課時間\n支援 iCal 訂閱，同步至行事曆",
    color: "#F97316",
    emoji: "📅",
  },
  {
    id: "map",
    icon: "navigate-outline",
    title: "校園導航\n快速到達",
    description: "完整校園地圖與 POI 資訊\n快速找到教室、餐廳、圖書館",
    color: "#22C55E",
    emoji: "🗺️",
  },
  {
    id: "notifications",
    icon: "notifications-outline",
    title: "即時通知\n不遺漏",
    description: "重要公告、活動提醒即時推送\n自訂通知偏好，掌握校園脈動",
    color: "#8B5CF6",
    emoji: "🔔",
  },
  {
    id: "community",
    icon: "people-outline",
    title: "校園社群\n一起學習",
    description: "加入社團、參與活動、認識同學\n透過群組功能，與同學協作",
    color: "#EC4899",
    emoji: "👥",
  },
];

type OnboardingStep = "slides" | "school_selection" | "complete";

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<OnboardingStep>("slides");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<SchoolOption | null>(null);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const scrollViewRef = useRef<any>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const filteredSchools = AVAILABLE_SCHOOLS.filter(
    (s) =>
      s.name.includes(schoolSearch) ||
      s.shortName.includes(schoolSearch) ||
      s.code.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    setCurrentIndex(Math.round(offsetX / SCREEN_WIDTH));
  };

  const goToSlide = (index: number) => {
    (scrollViewRef.current as any)?.scrollTo?.({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) goToSlide(currentIndex + 1);
    else setStep("school_selection");
  };

  const handleSkip = () => setStep("school_selection");

  const handleSchoolConfirm = async () => {
    if (!selectedSchool) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await AsyncStorage.setItem(SCHOOL_SELECTION_KEY, JSON.stringify({ code: selectedSchool.code }));
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    } catch (error) {
      console.error("Failed to save school selection:", error);
      setSaveError("儲存失敗，請重試");
      setIsSaving(false);
    }
  };

  const handleSkipSchool = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    } catch (error) {
      setSaveError("發生錯誤，請重試");
      setIsSaving(false);
    }
  };

  if (step === "school_selection") {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flex: 1, paddingTop: 60 }}>
            <View style={{ alignItems: "center", marginBottom: 32, paddingHorizontal: 32 }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 24,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <Ionicons name="school-outline" size={36} color={theme.colors.accent} />
              </View>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 28,
                  fontWeight: "800",
                  textAlign: "center",
                  marginBottom: 10,
                  letterSpacing: -0.5,
                }}
              >
                選擇您的學校
              </Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 15,
                  textAlign: "center",
                  lineHeight: 22,
                }}
              >
                我們將根據您的學校提供專屬資訊服務
              </Text>
            </View>

            <View style={{ paddingHorizontal: 24, marginBottom: 16 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.colors.surface2,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: 14,
                  height: 48,
                }}
              >
                <Ionicons name="search" size={18} color={theme.colors.muted} />
                <TextInput
                  value={schoolSearch}
                  onChangeText={setSchoolSearch}
                  placeholder="搜尋學校名稱..."
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    flex: 1,
                    paddingVertical: 0,
                    paddingHorizontal: 10,
                    color: theme.colors.text,
                    fontSize: 15,
                  }}
                />
                {schoolSearch.length > 0 && (
                  <Pressable onPress={() => setSchoolSearch("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                  </Pressable>
                )}
              </View>
            </View>

            <FlatList
              data={filteredSchools}
              keyExtractor={(item) => item.code}
              contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
              renderItem={({ item }) => {
                const isSelected = selectedSchool?.code === item.code;
                return (
                  <Pressable
                    onPress={() => setSelectedSchool(item)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 16,
                      marginBottom: 8,
                      borderRadius: theme.radius.lg,
                      borderWidth: 1.5,
                      borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                      backgroundColor: isSelected ? theme.colors.accentSoft : theme.colors.surface,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                      ...(isSelected ? shadowStyle(theme.shadows.sm) : {}),
                    })}
                  >
                    <View
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 14,
                        backgroundColor: isSelected ? theme.colors.accent : theme.colors.surface2,
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 14,
                      }}
                    >
                      <Text style={{ color: isSelected ? "#fff" : theme.colors.text, fontSize: 14, fontWeight: "700" }}>
                        {item.shortName.slice(0, 2)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.1 }}>
                        {item.name}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }}>
                        {item.code}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={24} color={theme.colors.accent} />}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={{ alignItems: "center", padding: 40 }}>
                  <Ionicons name="search-outline" size={40} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 14, textAlign: "center", lineHeight: 21 }}>
                    找不到符合的學校{"\n"}請嘗試其他關鍵字
                  </Text>
                </View>
              }
            />

            <View
              style={{
                paddingHorizontal: 24,
                paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
                paddingTop: 16,
                gap: 12,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
              }}
            >
              {saveError && (
                <View
                  style={{
                    backgroundColor: theme.colors.dangerSoft,
                    borderRadius: theme.radius.md,
                    padding: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
                  <Text style={{ color: theme.colors.danger, fontSize: 13, flex: 1 }}>{saveError}</Text>
                </View>
              )}
              <Button
                text={selectedSchool ? `確認選擇 ${selectedSchool.shortName}` : "請選擇學校"}
                kind="primary"
                size="large"
                onPress={handleSchoolConfirm}
                disabled={!selectedSchool || isSaving}
                loading={isSaving}
                fullWidth
              />
              <Pressable
                onPress={handleSkipSchool}
                disabled={isSaving}
                style={({ pressed }) => ({ paddingVertical: 12, alignItems: "center", opacity: pressed || isSaving ? 0.5 : 1 })}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 14 }}>稍後再設定</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  const isLastSlide = currentIndex === SLIDES.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ position: "absolute", top: 56, right: 24, zIndex: 10 }}>
        <Pressable
          onPress={handleSkip}
          style={({ pressed }) => ({
            paddingHorizontal: 18,
            paddingVertical: 8,
            borderRadius: theme.radius.full,
            backgroundColor: pressed ? theme.colors.surface2 : "transparent",
          })}
          accessibilityRole="button"
          accessibilityLabel="跳過導覽"
        >
          <Text style={{ color: theme.colors.muted, fontSize: 15, fontWeight: "500" }}>跳過</Text>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={scrollViewRef as any}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide) => (
          <View
            key={slide.id}
            style={{
              width: SCREEN_WIDTH,
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 40,
            }}
          >
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 36,
                backgroundColor: `${slide.color}12`,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 48,
              }}
            >
              <Ionicons name={slide.icon as any} size={56} color={slide.color} />
            </View>

            <Text
              style={{
                color: theme.colors.text,
                fontSize: 34,
                fontWeight: "800",
                textAlign: "center",
                marginBottom: 18,
                letterSpacing: -0.8,
                lineHeight: 42,
              }}
            >
              {slide.title}
            </Text>

            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 16,
                textAlign: "center",
                lineHeight: 25,
                maxWidth: 300,
              }}
            >
              {slide.description}
            </Text>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={{ paddingHorizontal: 32, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 36 }}>
          {SLIDES.map((_, index) => {
            const inputRange = [
              (index - 1) * SCREEN_WIDTH,
              index * SCREEN_WIDTH,
              (index + 1) * SCREEN_WIDTH,
            ];
            const dotWidth = scrollX.interpolate({ inputRange, outputRange: [8, 28, 8], extrapolate: "clamp" });
            const dotOpacity = scrollX.interpolate({ inputRange, outputRange: [0.2, 1, 0.2], extrapolate: "clamp" });

            return (
              <Pressable key={index} onPress={() => goToSlide(index)}>
                <Animated.View
                  style={{
                    height: 6,
                    width: dotWidth,
                    borderRadius: 3,
                    backgroundColor: theme.colors.accent,
                    opacity: dotOpacity,
                  }}
                />
              </Pressable>
            );
          })}
        </View>

        <Button
          text={isLastSlide ? "開始使用" : "繼續"}
          kind="primary"
          size="large"
          onPress={handleNext}
          fullWidth
        />
      </View>
    </View>
  );
}

export async function hasSeenOnboarding(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === "true";
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_KEY);
}
