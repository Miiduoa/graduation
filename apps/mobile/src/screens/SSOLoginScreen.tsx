import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
} from "@campus/shared/src";

import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import {
  signInWithStudentId,
  type LoginProgress,
} from "../services/studentIdAuth";
import { Screen, Button, AnimatedCard, Card, Pill } from "../ui/components";
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

    const onProgress = (progressStep: LoginProgress, detail?: string) => {
      setStep(progressStep);
      if (detail) setStageDetail(detail);
    };

    try {
      const result = await signInWithStudentId({
        studentId: studentIdInput,
        password: studentPwInput,
        schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
        schoolName,
        onProgress,
      });

      setStep("linking");
      setStageDetail("完成登入");
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
        {/* ── 學校資訊卡片 ── */}
        <AnimatedCard title="選擇學校" subtitle="使用靜宜大學帳號登入">
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: school.themeColor ?? theme.colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="school" size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800" }}>
                  {schoolName}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
                  {school.shortName ? `${school.shortName} · ` : ""}
                  {PROVIDENCE_UNIVERSITY_SCHOOL_CODE}
                </Text>
              </View>
              <Pill text={PROVIDENCE_UNIVERSITY_SCHOOL_CODE} kind="accent" />
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              目前產品已鎖定為 PU-only，登入後會同步課表、成績、TronClass 與校園資料。
            </Text>
          </View>
        </AnimatedCard>

        {/* ── 學號登入表單 ── */}
        <AnimatedCard title="學號登入" subtitle="使用 E 校園帳號密碼">
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
                onChangeText={setStudentIdInput}
                placeholder="E校園帳號"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
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
              請使用靜宜大學 E 校園帳號與密碼登入。登入後會自動同步課表、成績與 TronClass 資料。
            </Text>
          </View>
        </AnimatedCard>

        {/* ── 登入進度 ── */}
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

        {/* ── 登入成功 ── */}
        {step === "success" ? (
          <AnimatedCard title="登入進度" subtitle="">
            <View style={{ alignItems: "center", paddingVertical: 16 }}>
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: `${theme.colors.success}20`,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <Ionicons name="checkmark-circle" size={36} color={theme.colors.success} />
              </View>
              <Text style={{ color: theme.colors.success, fontSize: 16, fontWeight: "700" }}>
                登入成功！
              </Text>
            </View>
          </AnimatedCard>
        ) : null}

        {/* ── 登入失敗 ── */}
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

        {/* ── 關於學校帳號登入（說明卡片）── */}
        {step === "idle" ? (
          <Card title="關於學校帳號登入" subtitle="安全、快速、自動同步">
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="shield-checkmark" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>安全可靠</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 18 }}>
                    透過學校 E 校園認證系統驗證身份，密碼僅用於本次登入驗證
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="flash" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>快速便捷</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 18 }}>
                    使用現有學校帳號，無需另外註冊，登入後自動建立 Campus One 帳號
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="sync" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>自動同步</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 18 }}>
                    自動同步您的姓名、學號、系所、課表、成績與 TronClass 課程資訊
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="cloud-done" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>離線快取</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 18 }}>
                    課表與成績會快取在本機，下次開啟不用重新抓取，定期自動更新
                  </Text>
                </View>
              </View>
            </View>
          </Card>
        ) : null}

        {/* ── 技術資訊 ── */}
        {step === "idle" ? (
          <Card title="技術資訊" subtitle="開發者參考">
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>認證方式</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>E 校園 + TronClass</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>E 校園端點</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 11 }}>alcat.pu.edu.tw</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>TronClass 端點</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 11 }}>tronclass.pu.edu.tw</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>資料快取</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>AsyncStorage + TTL</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>登入策略</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>後端優先 + 手機直連降級</Text>
              </View>
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
