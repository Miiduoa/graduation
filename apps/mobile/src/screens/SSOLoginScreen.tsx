import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from "react-native";

import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
} from "@campus/shared/src";

import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import {
  signInWithStudentId,
} from "../services/studentIdAuth";
import { Screen, Button, AnimatedCard, Pill } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";

type LoginStep =
  | "idle"
  | "authenticating"
  | "syncingCampus"
  | "syncingTronClass"
  | "linking"
  | "success"
  | "error";

type SSOLoginScreenProps = {
  navigation?: {
    goBack?: () => void;
  };
};

export function SSOLoginScreen(props: SSOLoginScreenProps) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();

  const [studentIdInput, setStudentIdInput] = useState("");
  const [studentPwInput, setStudentPwInput] = useState("");
  const [step, setStep] = useState<LoginStep>("idle");
  const [stageDetail, setStageDetail] = useState("驗證靜宜帳密");
  const [error, setError] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);

  const schoolName = useMemo(
    () => (school.id === PROVIDENCE_UNIVERSITY_SCHOOL_ID ? school.name : "靜宜大學"),
    [school.id, school.name],
  );

  const bootstrapStepOrder: LoginStep[] = [
    "authenticating",
    "syncingCampus",
    "syncingTronClass",
    "linking",
  ];

  const stepLabels: Record<LoginStep, string> = {
    idle: "等待登入",
    authenticating: "驗證靜宜帳密",
    syncingCampus: "同步 E 校園資料",
    syncingTronClass: "同步 TronClass 課程",
    linking: "建立 Campus One 帳號",
    success: "登入完成",
    error: "登入失敗",
  };

  const handleStudentIdLogin = async () => {
    setError(null);
    setIsRetryable(false);
    setStep("authenticating");
    setStageDetail("驗證靜宜帳密");

    try {
      const result = await signInWithStudentId({
        studentId: studentIdInput,
        password: studentPwInput,
        schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
        schoolName,
      });

      setStep("linking");
      setStageDetail("建立 Campus One 帳號");
      await auth.refreshProfile();
      setStep("success");

      const deptLabel = result.department ? `（${result.department}）` : "";
      setTimeout(() => {
        Alert.alert(
          "登入成功",
          `歡迎，${result.displayName}${deptLabel}`,
          [{ text: "確定", onPress: () => nav?.goBack?.() }],
        );
      }, 250);
    } catch (loginError) {
      console.warn("Student ID login error:", loginError);
      setError(loginError instanceof Error ? loginError.message : "學號登入失敗");
      setIsRetryable(true);
      setStep("error");
    }
  };

  const handleRetry = () => {
    setStep("idle");
    setStageDetail("驗證靜宜帳密");
    setError(null);
    setIsRetryable(false);
  };

  const isBusy =
    step === "authenticating" ||
    step === "syncingCampus" ||
    step === "syncingTronClass" ||
    step === "linking";

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard title="靜宜大學" subtitle="Campus One 現階段僅開放 PU 學號登入">
          <View
            style={{
              padding: 16,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ gap: 6 }}>
                <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: "800" }}>
                  {schoolName}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  目前產品已鎖定為 PU-only，登入後會同步課表、成績、TronClass 與校園資料。
                </Text>
              </View>
              <Pill text={PROVIDENCE_UNIVERSITY_SCHOOL_CODE} kind="accent" />
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              請使用靜宜 e 校園帳號密碼。登入成功後會建立 Firebase session，並初始化 PU 專用資料工作階段。
            </Text>
          </View>
        </AnimatedCard>

        <AnimatedCard title="學號登入" subtitle="唯一登入方式">
          <View style={{ gap: 14 }}>
            <View
              style={{
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                paddingHorizontal: 14,
                minHeight: 54,
                justifyContent: "center",
              }}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>學號</Text>
              <TextInput
                value={studentIdInput}
                onChangeText={(value) => setStudentIdInput(value.toUpperCase())}
                placeholder="例如 B11234567"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isBusy}
                style={{ color: theme.colors.text, fontSize: 16, paddingVertical: 0 }}
              />
            </View>

            <View
              style={{
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                paddingHorizontal: 14,
                minHeight: 54,
                justifyContent: "center",
              }}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>密碼</Text>
              <TextInput
                value={studentPwInput}
                onChangeText={setStudentPwInput}
                placeholder="輸入 e 校園密碼"
                placeholderTextColor={theme.colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isBusy}
                style={{ color: theme.colors.text, fontSize: 16, paddingVertical: 0 }}
              />
            </View>

            <Button
              text={isBusy ? "登入中..." : "使用學號登入"}
              kind="primary"
              onPress={handleStudentIdLogin}
              disabled={isBusy || !studentIdInput.trim() || !studentPwInput.trim()}
            />

            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              若你原本使用其他登入方式，這個版本已統一切換為靜宜學號登入，不再提供多校登入入口。
            </Text>
          </View>
        </AnimatedCard>

        {isBusy ? (
          <AnimatedCard title="登入處理中" subtitle={stepLabels[step]}>
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 12 }}>
              <ActivityIndicator color={theme.colors.accent} size="large" />
              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                {stageDetail}
              </Text>
              <Text style={{ color: theme.colors.muted, textAlign: "center", lineHeight: 20 }}>
                這會依序驗證帳密、同步 E 校園核心資料、同步 TronClass 課程，最後才建立 Campus One 內部登入狀態。
              </Text>
              <View style={{ width: "100%", gap: 8, marginTop: 4 }}>
                {bootstrapStepOrder.map((candidate, index) => {
                  const currentIndex = bootstrapStepOrder.indexOf(step);
                  const candidateIndex = bootstrapStepOrder.indexOf(candidate);
                  const isActive = currentIndex === candidateIndex;
                  const isDone = currentIndex > candidateIndex;

                  return (
                    <View
                      key={candidate}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: isActive
                          ? theme.colors.accentSoft
                          : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: isActive
                          ? `${theme.colors.accent}40`
                          : theme.colors.border,
                        opacity: isDone ? 0.9 : 1,
                      }}
                    >
                      <Text style={{ color: isDone ? theme.colors.success : theme.colors.muted }}>
                        {isDone ? "✓" : isActive ? "…" : `${index + 1}`}
                      </Text>
                      <Text
                        style={{
                          color: isActive ? theme.colors.accent : theme.colors.text,
                          fontWeight: isActive ? "700" : "500",
                        }}
                      >
                        {stepLabels[candidate]}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </AnimatedCard>
        ) : null}

        {step === "error" && error ? (
          <AnimatedCard title="登入失敗" subtitle="請檢查帳號密碼或稍後再試">
            <View style={{ gap: 14 }}>
              <View
                style={{
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.dangerSoft ?? `${theme.colors.danger}15`,
                  borderWidth: 1,
                  borderColor: `${theme.colors.danger}30`,
                }}
              >
                <Text style={{ color: theme.colors.danger, lineHeight: 20 }}>{error}</Text>
              </View>
              {isRetryable ? <Button text="重新嘗試" onPress={handleRetry} kind="primary" /> : null}
            </View>
          </AnimatedCard>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
