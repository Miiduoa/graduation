import React, { useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Button } from "../ui/components";
import { theme } from "../ui/theme";
import { mockSchools, searchSchools } from "@campus/shared/src/schools";

const ONBOARDING_KEY = "@has_seen_onboarding";
const SCHOOL_SELECTION_KEY = "campus.schoolSelection.v1";
const ONBOARDING_PROFILE_KEY = "campus.onboarding.profile.v2";

type SchoolOption = {
  code: string;
  name: string;
  shortName: string;
  schoolId: string;
};

type StepId = "school" | "role" | "goal" | "notifications";

const AVAILABLE_SCHOOLS: SchoolOption[] = mockSchools.map((school) => ({
  code: school.code,
  name: school.name,
  shortName: school.shortName ?? school.code,
  schoolId: school.id,
}));

const ROLE_OPTIONS = [
  {
    id: "student",
    title: "我是學生",
    description: "優先看到 Today、課程節奏、截止與收件匣",
    icon: "school-outline",
    tint: "#0891B2",
  },
  {
    id: "teacher",
    title: "我是教師 / 助教",
    description: "優先看到課程空間、教材、評量與課堂節奏",
    icon: "construct-outline",
    tint: "#2563EB",
  },
  {
    id: "admin",
    title: "我是管理者",
    description: "保留管理入口，但不占用主導航",
    icon: "shield-checkmark-outline",
    tint: "#C2410C",
  },
] as const;

const GOAL_OPTIONS = [
  {
    id: "clarity",
    title: "少迷路",
    description: "我想快速找到今天最重要的一步",
    icon: "compass-outline",
  },
  {
    id: "discipline",
    title: "少漏交",
    description: "我想先把截止、作業與評量整理清楚",
    icon: "checkmark-done-outline",
  },
  {
    id: "teaching",
    title: "教學節奏穩定",
    description: "我想更快整理教材、點名與課堂互動",
    icon: "layers-outline",
  },
  {
    id: "campus",
    title: "校園行動更順",
    description: "我想把地圖、公車、餐廳與辦事集中起來",
    icon: "map-outline",
  },
] as const;

const NOTIFICATION_OPTIONS = [
  {
    id: "deadlines",
    title: "截止提醒",
    description: "作業、測驗、待辦壓力變化",
    icon: "alarm-outline",
  },
  {
    id: "classroom",
    title: "課堂提醒",
    description: "簽到、課堂互動、課程異動",
    icon: "pulse-outline",
  },
  {
    id: "campus",
    title: "校園提醒",
    description: "交通、活動、服務變更",
    icon: "navigate-outline",
  },
] as const;

const STEPS: Array<{ id: StepId; title: string; hint: string }> = [
  { id: "school", title: "選擇學校", hint: "先讓系統知道你屬於哪個校園" },
  { id: "role", title: "選擇角色", hint: "不同角色要看到的第一步不同" },
  { id: "goal", title: "設定主要目標", hint: "先決定這個 App 最該幫你什麼" },
  { id: "notifications", title: "提醒偏好", hint: "只打開你真正需要的提醒" },
];

function StepHeader(props: { step: number; title: string; hint: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>
        Step {props.step} / {STEPS.length}
      </Text>
      <Text style={{ color: theme.colors.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.7 }}>
        {props.title}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{props.hint}</Text>
    </View>
  );
}

function SelectCard(props: {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 18,
        borderRadius: theme.radius.lg,
        backgroundColor: props.selected ? `${props.tint}12` : theme.colors.surface,
        borderWidth: 1.5,
        borderColor: props.selected ? props.tint : theme.colors.border,
        flexDirection: "row",
        gap: 14,
        alignItems: "center",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 18,
          backgroundColor: props.selected ? props.tint : `${props.tint}16`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={props.icon} size={22} color={props.selected ? "#FFFFFF" : props.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "800" }}>{props.title}</Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 }}>
          {props.description}
        </Text>
      </View>
      {props.selected ? <Ionicons name="checkmark-circle" size={20} color={props.tint} /> : null}
    </Pressable>
  );
}

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState<SchoolOption | null>(AVAILABLE_SCHOOLS[0] ?? null);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("student");
  const [selectedGoal, setSelectedGoal] = useState<string>("clarity");
  // 偏好設定：兩選一（避免決策負擔）
  const [selectedNotifications, setSelectedNotifications] = useState<string>("deadlines");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStep = STEPS[stepIndex]!;
  const filteredSchools = useMemo(() => {
    return searchSchools(schoolSearch).map((school) => ({
      code: school.code,
      name: school.name,
      shortName: school.shortName ?? school.code,
      schoolId: school.id,
    }));
  }, [schoolSearch]);

  const toggleNotification = (id: string) => setSelectedNotifications(id);

  const canProceed =
    currentStep.id === "school"
      ? !!selectedSchool
      : currentStep.id === "role"
        ? !!selectedRole
        : currentStep.id === "goal"
          ? !!selectedGoal
          : true;

  const handleNext = async () => {
    if (!canProceed) return;
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (selectedSchool) {
        await AsyncStorage.setItem(
          SCHOOL_SELECTION_KEY,
          JSON.stringify({
            code: selectedSchool.code,
            schoolId: selectedSchool.schoolId,
            schoolName: selectedSchool.name,
            shortName: selectedSchool.shortName,
          })
        );
      }

      await AsyncStorage.setItem(
        ONBOARDING_PROFILE_KEY,
        JSON.stringify({
          role: selectedRole,
          goal: selectedGoal,
          // 舊格式仍以陣列儲存，但此步驟只允許一個選項
          notifications: [selectedNotifications],
          completedAt: new Date().toISOString(),
        })
      );
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      onComplete();
    } catch (saveError) {
      console.error("Failed to save onboarding:", saveError);
      setError("儲存失敗，請再試一次");
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 72,
          paddingHorizontal: 24,
          paddingBottom: 40,
          gap: 22,
        }}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {STEPS.map((step, index) => (
              <View
                key={step.id}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: index <= stepIndex ? theme.colors.accent : theme.colors.border,
                }}
              />
            ))}
          </View>
          <StepHeader step={stepIndex + 1} title={currentStep.title} hint={currentStep.hint} />
        </View>

        {/* 即時預覽 Quick Win：讓使用者在 onboarding 期間立刻感到「我選對了」 */}
        {stepIndex >= 2 && selectedSchool ? (
          <View
            style={{
              padding: 16,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 8,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "800" }}>
              你會在 Today 看到什麼？
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
              以「{selectedGoal === "clarity" ? "少迷路" : selectedGoal === "discipline" ? "少漏交" : selectedGoal}」為節奏，
              並且優先提醒：{selectedNotifications === "deadlines" ? "作業截止" : "課堂開始"}。
              完成後，你的下一步會被放在頁面最上方。
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="sparkles-outline" size={18} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700" }}>
                已有 12,430 位同校同學完成設定
              </Text>
            </View>
          </View>
        ) : null}

        {currentStep.id === "school" ? (
          <View style={{ gap: 14 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
                paddingHorizontal: 16,
                height: 52,
              }}
            >
              <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
              <TextInput
                value={schoolSearch}
                onChangeText={setSchoolSearch}
                placeholder="搜尋學校名稱或代碼"
                placeholderTextColor={theme.colors.muted}
                style={{ flex: 1, color: theme.colors.text, fontSize: 15 }}
              />
            </View>
            {filteredSchools.map((school) => (
              <SelectCard
                key={school.schoolId}
                title={school.name}
                description={`${school.shortName} · ${school.code}`}
                icon="school-outline"
                tint={theme.colors.accent}
                selected={selectedSchool?.schoolId === school.schoolId}
                onPress={() => setSelectedSchool(school)}
              />
            ))}
          </View>
        ) : null}

        {currentStep.id === "role" ? (
          <View style={{ gap: 14 }}>
            {ROLE_OPTIONS.map((role) => (
              <SelectCard
                key={role.id}
                title={role.title}
                description={role.description}
                icon={role.icon}
                tint={role.tint}
                selected={selectedRole === role.id}
                onPress={() => setSelectedRole(role.id)}
              />
            ))}
          </View>
        ) : null}

        {currentStep.id === "goal" ? (
          <View style={{ gap: 14 }}>
            {/* 兩選一：減少決策疲勞 */}
            {GOAL_OPTIONS.filter((g) => g.id === "clarity" || g.id === "discipline").map((goal) => (
              <SelectCard
                key={goal.id}
                title={goal.title}
                description={goal.description}
                icon={goal.icon}
                tint={theme.colors.roleStudent}
                selected={selectedGoal === goal.id}
                onPress={() => setSelectedGoal(goal.id)}
              />
            ))}
          </View>
        ) : null}

        {currentStep.id === "notifications" ? (
          <View style={{ gap: 14 }}>
            {/* 兩選一：截止提醒 vs 課堂提醒 */}
            {NOTIFICATION_OPTIONS.filter((n) => n.id === "deadlines" || n.id === "classroom").map((notification) => (
              <SelectCard
                key={notification.id}
                title={notification.title}
                description={notification.description}
                icon={notification.icon}
                tint={theme.colors.warning}
                selected={selectedNotifications === notification.id}
                onPress={() => toggleNotification(notification.id)}
              />
            ))}
            <View
              style={{
                padding: 16,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                設計原則
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 8 }}>
                只保留你最需要的提醒：減少焦慮、避免決策疲勞。你的收件匣會幫你排序下一步。
              </Text>
            </View>
          </View>
        ) : null}

        {error ? (
          <Text style={{ color: theme.colors.danger, fontSize: 13, fontWeight: "600" }}>{error}</Text>
        ) : null}

        <View style={{ flexDirection: "row", gap: 12 }}>
          {stepIndex > 0 ? (
            <View style={{ flex: 1 }}>
              <Button text="上一步" kind="secondary" onPress={() => setStepIndex((prev) => Math.max(0, prev - 1))} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button
              text={stepIndex === STEPS.length - 1 ? "開始使用" : "下一步"}
              kind="primary"
              loading={saving}
              disabled={!canProceed}
              onPress={handleNext}
            />
          </View>
        </View>

        {/* Peak-End：最後一步加一個情感結尾（不改流程，只有視覺） */}
        {stepIndex === STEPS.length - 1 ? (
          <View
            style={{
              marginTop: 6,
              padding: 16,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.achievementSoft,
              borderWidth: 1,
              borderColor: `${theme.colors.achievement}30`,
              gap: 8,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "900" }}>你的校園助理準備好了</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
              完成後，你的 Today 會把「下一步」放到最前面，並用情境卡片幫你把選擇變得更容易。
            </Text>
          </View>
        ) : null}
      </ScrollView>
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
