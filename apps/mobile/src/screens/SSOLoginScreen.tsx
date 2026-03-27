import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View, Pressable, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { School } from "@campus/shared/src";
import {
  listUniversalDevAccounts,
  UNIVERSAL_DEV_ACCOUNT_PASSWORD,
} from "@campus/shared/src/devUniversalAccounts";
import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { fetchSchoolDirectory } from "../services/schoolDirectory";
import { areUniversalDevAccountsEnabled } from "../services/release";
import {
  getSchoolSSOConfig,
  getSSOAvailability,
  performSSOLogin,
  isSSOAvailable,
  getSSOProviderName,
  SSOError,
  type SchoolSSOConfig,
  type SSOUserInfo,
} from "../services/sso";
import { signInWithUniversalDevAccount } from "../services/universalDevAuth";
import { isStudentIdLoginAvailable, signInWithStudentId } from "../services/studentIdAuth";

type LoginStep = "idle" | "checking" | "authenticating" | "linking" | "success" | "error";

type SSOLoginScreenProps = {
  navigation?: {
    goBack?: () => void;
  };
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function SSOLoginScreen(props: SSOLoginScreenProps) {
  const nav = props?.navigation;
  const { school, setSelection } = useSchool();
  const auth = useAuth();
  const universalDevAccounts = useMemo(() => listUniversalDevAccounts(), []);
  const showUniversalDevAccounts = useMemo(() => areUniversalDevAccountsEnabled(), []);

  const [availableSchools, setAvailableSchools] = useState<School[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [schoolPickerOpen, setSchoolPickerOpen] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [ssoConfig, setSsoConfig] = useState<SchoolSSOConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);
  const [ssoUserInfo, setSsoUserInfo] = useState<SSOUserInfo | null>(null);
  const [lastLoginAction, setLastLoginAction] = useState<
    { type: "sso" } | { type: "universal-dev"; email: string } | { type: "student-id" } | null
  >(null);

  // 學號登入表單
  const [studentIdInput, setStudentIdInput] = useState("");
  const [studentPwInput, setStudentPwInput] = useState("");
  const studentIdLoginAvailable = useMemo(() => isStudentIdLoginAvailable(), []);

  const loadSchoolDirectory = useCallback(async () => {
    setSchoolsLoading(true);
    try {
      const schools = await fetchSchoolDirectory();
      setAvailableSchools(schools);
    } catch (error) {
      console.error("Failed to load school directory:", error);
      setAvailableSchools([]);
    } finally {
      setSchoolsLoading(false);
    }
  }, []);

  const loadSSOConfig = useCallback(async () => {
    setLoading(true);
    setConfigError(null);
    try {
      const config = await getSchoolSSOConfig(school.id);
      setSsoConfig(config);
    } catch (error) {
      console.error("Failed to load SSO config:", error);
      setConfigError(getErrorMessage(error, "無法載入 SSO 設定，請檢查網路連線後重試"));
    } finally {
      setLoading(false);
    }
  }, [school.id]);

  useEffect(() => {
    void loadSchoolDirectory();
  }, [loadSchoolDirectory]);

  useEffect(() => {
    void loadSSOConfig();
  }, [loadSSOConfig]);

  const filteredSchools = useMemo(() => {
    const needle = schoolSearch.trim().toLowerCase();
    if (!needle) return availableSchools;

    return availableSchools.filter((item) => {
      const haystacks = [
        item.name,
        item.shortName,
        item.code,
        ...(item.aliases ?? []),
        ...((item.domains ?? []).map((domain) => domain.toLowerCase())),
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .map((value) => value.toLowerCase());

      return haystacks.some((value) => value.includes(needle));
    });
  }, [availableSchools, schoolSearch]);

  const handleSelectSchool = (nextSchool: School) => {
    setSelection({
      code: nextSchool.code,
      schoolId: nextSchool.id,
      schoolName: nextSchool.name,
      shortName: nextSchool.shortName ?? null,
      themeColor: nextSchool.themeColor ?? null,
      domains: nextSchool.domains ?? null,
    });
    setSchoolPickerOpen(false);
    setSchoolSearch("");
    setSsoConfig(null);
    setConfigError(null);
    setStep("idle");
    setError(null);
    setSsoUserInfo(null);
    setLastLoginAction(null);
  };

  const handleSSOLogin = async () => {
    setError(null);
    setIsRetryable(false);
    setStep("checking");
    setLastLoginAction({ type: "sso" });

    try {
      if (!isSSOAvailable(ssoConfig)) {
        throw new SSOError("此學校尚未設定 SSO 登入", "SSO_NOT_CONFIGURED");
      }

      setStep("authenticating");
      const result = await performSSOLogin(school.id);

      if (!result) {
        setStep("idle");
        return;
      }

      setSsoUserInfo(result.userInfo);
      setStep("linking");

      setStep("success");

      await auth.refreshProfile();

      setTimeout(() => {
        Alert.alert(
          result.isNewUser ? "歡迎加入！" : "登入成功",
          result.isNewUser
            ? `已使用 ${getSSOProviderName(ssoConfig)} 建立新帳號`
            : `已使用 ${getSSOProviderName(ssoConfig)} 登入`,
          [
            {
              text: "確定",
              onPress: () => nav?.goBack?.(),
            },
          ]
        );
      }, 500);
    } catch (error) {
      console.error("SSO login error:", error);
      
      if (error instanceof SSOError) {
        // 如果是使用者取消，靜默返回 idle 狀態
        if (error.code === "SSO_CANCELLED") {
          setStep("idle");
          return;
        }
        
        setError(error.userFriendlyMessage);
        setIsRetryable(error.isRetryable);
      } else {
        setError(getErrorMessage(error, "登入失敗，請稍後再試"));
        setIsRetryable(true);
      }
      
      setStep("error");
    }
  };

  const handleUniversalDevLogin = async (email: string) => {
    setError(null);
    setIsRetryable(false);
    setStep("authenticating");
    setLastLoginAction({ type: "universal-dev", email });

    try {
      const result = await signInWithUniversalDevAccount({
        email,
        password: UNIVERSAL_DEV_ACCOUNT_PASSWORD,
        schoolId: school.id,
      });

      setSsoUserInfo({
        sub: result.uid,
        email: result.email,
        name: result.displayName,
        displayName: result.displayName,
        role: result.role,
      });
      setStep("linking");

      await auth.refreshProfile();

      setStep("success");

      const roleLabel = result.role === "teacher" ? "教師" : "學生";
      setTimeout(() => {
        Alert.alert(
          "登入成功",
          `${roleLabel}通用帳號已套用到 ${school.name}`,
          [
            {
              text: "確定",
              onPress: () => nav?.goBack?.(),
            },
          ]
        );
      }, 300);
    } catch (loginError) {
      console.warn("Universal dev login error:", loginError);
      setError(getErrorMessage(loginError, "通用測試帳號登入失敗"));
      setIsRetryable(true);
      setStep("error");
    }
  };

  const handleStudentIdLogin = async () => {
    setError(null);
    setIsRetryable(false);
    setStep("authenticating");
    setLastLoginAction({ type: "student-id" });

    try {
      const result = await signInWithStudentId({
        studentId: studentIdInput,
        password: studentPwInput,
        schoolId: school.id,
        schoolName: school.name,
      });

      setSsoUserInfo({
        sub: result.uid,
        email: result.email,
        name: result.displayName,
        displayName: result.displayName,
        student_id: result.studentId,
        department: result.department,
        role: result.role as "student" | "teacher" | "admin" | "staff",
      });
      setStep("linking");

      await auth.refreshProfile();
      setStep("success");

      const deptLabel = result.department ? `（${result.department}）` : "";
      setTimeout(() => {
        Alert.alert(
          "登入成功",
          `歡迎，${result.displayName}${deptLabel}`,
          [{ text: "確定", onPress: () => nav?.goBack?.() }]
        );
      }, 300);
    } catch (loginError) {
      console.warn("Student ID login error:", loginError);
      setError(loginError instanceof Error ? loginError.message : "學號登入失敗");
      setIsRetryable(true);
      setStep("error");
    }
  };

  const handleRetry = () => {
    setStep("idle");
    setError(null);
    setIsRetryable(false);
    setSsoUserInfo(null);
  };

  const handleRetryLogin = () => {
    if (lastLoginAction?.type === "student-id") {
      void handleStudentIdLogin();
      return;
    }
    if (lastLoginAction?.type === "universal-dev") {
      void handleUniversalDevLogin(lastLoginAction.email);
      return;
    }
    void handleSSOLogin();
  };

  const getStepText = (): string => {
    switch (step) {
      case "checking":
        return "檢查 SSO 設定...";
      case "authenticating":
        return "正在進行身份驗證...";
      case "linking":
        return "連結帳號中...";
      case "success":
        return "登入成功！";
      case "error":
        return "登入失敗";
      default:
        return "";
    }
  };

  const getProviderIcon = (): keyof typeof Ionicons.glyphMap => {
    const provider = ssoConfig?.ssoConfig?.provider;
    switch (provider) {
      case "oidc":
        return "globe-outline";
      case "cas":
        return "server-outline";
      case "saml":
        return "shield-outline";
      default:
        return "school-outline";
    }
  };

  const getProviderDescription = (): string => {
    const provider = ssoConfig?.ssoConfig?.provider;
    switch (provider) {
      case "oidc":
        return "使用 OpenID Connect 標準協議進行安全的身份驗證";
      case "cas":
        return "使用中央認證服務 (CAS) 進行校園單一登入";
      case "saml":
        return "使用 SAML 協議進行企業級身份驗證";
      default:
        return "使用學校單一登入系統";
    }
  };

  const ssoAvailable = isSSOAvailable(ssoConfig);
  const ssoAvailability = getSSOAvailability(ssoConfig);
  const schoolLoginAvailable = ssoAvailable;
  const showRemoteLoading = loading;
  const ssoStatusLabel =
    ssoAvailability.setupStatus === "live"
      ? "已開通"
      : ssoAvailability.setupStatus === "testing"
        ? "測試中"
        : "未開通";

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="選擇學校" subtitle="先選學校，再用該校帳號密碼登入">
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
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
                  {(school.shortName?.[0] ?? school.name?.[0] ?? "?").toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "800" }}>{school.name}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
                  {school.shortName ? `${school.shortName} · ` : ""}
                  {school.code}
                </Text>
              </View>
              <Button
                text={schoolPickerOpen ? "收合" : "切換"}
                onPress={() => setSchoolPickerOpen((prev) => !prev)}
              />
            </View>

            {schoolPickerOpen && (
              <View style={{ gap: 10 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.lg,
                    paddingHorizontal: 14,
                    minHeight: 48,
                  }}
                >
                  <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
                  <TextInput
                    value={schoolSearch}
                    onChangeText={setSchoolSearch}
                    placeholder="搜尋學校名稱、簡稱或代碼"
                    placeholderTextColor={theme.colors.muted}
                    style={{ flex: 1, color: theme.colors.text, fontSize: 14 }}
                  />
                </View>

                {schoolsLoading ? (
                  <View style={{ paddingVertical: 16, alignItems: "center" }}>
                    <ActivityIndicator color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.muted, marginTop: 8 }}>載入可選學校...</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                      共找到 {filteredSchools.length} 間學校
                    </Text>
                    {filteredSchools.map((item) => {
                      const active = item.id === school.id;
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => handleSelectSchool(item)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                            padding: 14,
                            borderRadius: theme.radius.md,
                            backgroundColor: active ? theme.colors.accentSoft : theme.colors.surface,
                            borderWidth: 1,
                            borderColor: active ? theme.colors.accent : theme.colors.border,
                          }}
                        >
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 20,
                              backgroundColor: item.themeColor ?? theme.colors.surface2,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "800" }}>
                              {(item.shortName?.[0] ?? item.name?.[0] ?? "?").toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.name}</Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              {item.shortName ? `${item.shortName} · ` : ""}
                              {item.code}
                            </Text>
                          </View>
                          {active ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} /> : null}
                        </Pressable>
                      );
                    })}
                    {!filteredSchools.length && (
                      <Text style={{ color: theme.colors.muted, textAlign: "center", paddingVertical: 12 }}>
                        找不到符合的學校
                      </Text>
                    )}
                  </View>
                )}

                <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                  選好學校後會讀取該校登入設定。只有已配置學校認證的學校能直接用校務帳號登入。
                </Text>
              </View>
            )}
          </View>
        </AnimatedCard>

        {/* ─── 學號密碼登入（mock 模式主要入口）─── */}
        {studentIdLoginAvailable && step === "idle" && (
          <AnimatedCard title="學號登入" subtitle={school.name}>
            <View style={{ gap: 14 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
                使用你的靜宜 e 校園帳號密碼登入。登入後會從學校系統抓取你的真實課表、成績和公告。
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: 14,
                  minHeight: 48,
                }}
              >
                <Ionicons name="person-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  value={studentIdInput}
                  onChangeText={setStudentIdInput}
                  placeholder="學號（e 校園帳號）"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={{ flex: 1, color: theme.colors.text, fontSize: 15 }}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: 14,
                  minHeight: 48,
                }}
              >
                <Ionicons name="lock-closed-outline" size={18} color={theme.colors.muted} />
                <TextInput
                  value={studentPwInput}
                  onChangeText={setStudentPwInput}
                  placeholder="e 校園密碼"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  autoCorrect={false}
                  style={{ flex: 1, color: theme.colors.text, fontSize: 15 }}
                />
              </View>

              <Pressable
                onPress={handleStudentIdLogin}
                disabled={!studentIdInput.trim()}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                  borderRadius: theme.radius.lg,
                  backgroundColor: studentIdInput.trim()
                    ? (school.themeColor ?? theme.colors.accent)
                    : theme.colors.surface2,
                  gap: 8,
                }}
              >
                <Ionicons
                  name="log-in-outline"
                  size={20}
                  color={studentIdInput.trim() ? "#fff" : theme.colors.muted}
                />
                <Text
                  style={{
                    color: studentIdInput.trim() ? "#fff" : theme.colors.muted,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                >
                  登入 {school.shortName ?? school.name}
                </Text>
              </Pressable>
            </View>
          </AnimatedCard>
        )}

        <AnimatedCard title="學校帳號登入" subtitle={school.name}>
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor:
                  showRemoteLoading && step === "idle"
                    ? theme.colors.surface2
                    : schoolLoginAvailable
                    ? theme.colors.accentSoft
                    : theme.colors.surface2,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              {showRemoteLoading && step === "idle" ? (
                <ActivityIndicator color={theme.colors.accent} />
              ) : (
                <Ionicons
                  name={getProviderIcon()}
                  size={40}
                  color={schoolLoginAvailable ? theme.colors.accent : theme.colors.muted}
                />
              )}
            </View>

            {showRemoteLoading && step === "idle" ? (
              <>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
                  載入登入方式中
                </Text>
                <Text style={{ color: theme.colors.muted, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                  正在讀取 {school.name} 的登入設定
                </Text>
              </>
            ) : ssoAvailable ? (
              <>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
                  {getSSOProviderName(ssoConfig)}
                </Text>
                <Text style={{ color: theme.colors.muted, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                  {getProviderDescription()}{"\n"}登入時會跳轉到學校官方頁面輸入學校帳號與密碼
                </Text>
                {ssoAvailability.setupStatus === "testing" ? (
                  <Text style={{ color: theme.colors.warning, marginTop: 10, textAlign: "center", lineHeight: 20 }}>
                    此學校目前標示為測試中，但仍可直接使用校方帳號密碼登入。
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
                  {configError ? "無法讀取學校登入設定" : "此學校尚未設定登入"}
                </Text>
                <Text style={{ color: theme.colors.muted, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                  {configError
                    ? configError
                    : `${ssoAvailability.message}，請切換到其他已開通學校`}
                </Text>
              </>
            )}
          </View>

          {!showRemoteLoading && ssoConfig?.ssoConfig?.provider && (
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Pill
                text={ssoConfig.ssoConfig.provider.toUpperCase()}
                kind="accent"
              />
              <Pill text={ssoStatusLabel} />
              {ssoConfig.emailDomain && (
                <Pill text={`@${ssoConfig.emailDomain}`} />
              )}
            </View>
          )}

          {!showRemoteLoading && configError && (
            <View style={{ marginBottom: 8 }}>
              <Button text="重新載入此學校登入設定" kind="primary" onPress={loadSSOConfig} />
            </View>
          )}
        </AnimatedCard>

        {step !== "idle" && (
          <AnimatedCard title="登入進度" subtitle="">
            <View style={{ alignItems: "center", paddingVertical: 16 }}>
              {step === "success" ? (
                <View
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 30,
                    backgroundColor: theme.colors.success + "20",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Ionicons name="checkmark-circle" size={36} color={theme.colors.success} />
                </View>
              ) : step === "error" ? (
                <View
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 30,
                    backgroundColor: theme.colors.error + "20",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Ionicons name="alert-circle" size={36} color={theme.colors.error} />
                </View>
              ) : (
                <ActivityIndicator size="large" color={theme.colors.accent} style={{ marginBottom: 12 }} />
              )}

              <Text
                style={{
                  color: step === "success"
                    ? theme.colors.success
                    : step === "error"
                    ? theme.colors.error
                    : theme.colors.text,
                  fontSize: 16,
                  fontWeight: "700",
                }}
              >
                {getStepText()}
              </Text>

              {error && (
                <Text style={{ color: theme.colors.error, marginTop: 8, textAlign: "center" }}>
                  {error}
                </Text>
              )}

              {ssoUserInfo && step === "success" && (
                <View style={{ marginTop: 16, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                    歡迎，{ssoUserInfo.name || ssoUserInfo.email || "使用者"}
                  </Text>
                  {ssoUserInfo.student_id && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                      學號：{ssoUserInfo.student_id}
                    </Text>
                  )}
                  {ssoUserInfo.department && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      系所：{ssoUserInfo.department}
                    </Text>
                  )}
                </View>
              )}
            </View>

            {step === "error" && (
              <View style={{ marginTop: 12, gap: 8 }}>
                {isRetryable && (
                  <Button text="重試登入" kind="primary" onPress={handleRetryLogin} />
                )}
                <Button 
                  text={isRetryable ? "返回" : "返回重新選擇"} 
                  onPress={handleRetry} 
                />
              </View>
            )}
          </AnimatedCard>
        )}

        {step === "idle" && (
          <Card title="登入方式">
            <View style={{ gap: 12 }}>
              {showRemoteLoading && (
                <View
                  style={{
                    paddingVertical: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.muted, marginTop: 10 }}>
                    載入 {school.shortName ?? school.name} 的登入方式...
                  </Text>
                </View>
              )}

              {!showRemoteLoading && ssoAvailable && (
                <Pressable
                  onPress={handleSSOLogin}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 16,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.accent,
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: "rgba(255,255,255,0.2)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="school" size={24} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                      使用 {school.shortName ?? school.name} 帳號登入
                    </Text>
                    <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 }}>
                      會跳轉到該校官方登入頁輸入校務系統帳號與密碼
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color="#fff" />
                </Pressable>
              )}

              {!showRemoteLoading && !schoolLoginAvailable && (
                <View
                  style={{
                    padding: 16,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    gap: 8,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>
                    目前這間學校還不能用校方帳密登入
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                    請切換其他學校；只要該校已配置學校登入，就會像 TronClass 一樣跳到校方官方頁面驗證。
                  </Text>
                </View>
              )}

              {showUniversalDevAccounts && (
                <View
                  style={{
                    padding: 16,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    gap: 10,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>
                    開發通用帳號
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                    這兩組測試帳號會套用到目前選擇的學校。固定密碼：{UNIVERSAL_DEV_ACCOUNT_PASSWORD}
                  </Text>

                  {universalDevAccounts.map((account) => {
                    const roleLabel = account.role === "teacher" ? "教師" : "學生";
                    return (
                      <Pressable
                        key={account.email}
                        onPress={() => handleUniversalDevLogin(account.email)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                          padding: 14,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            backgroundColor: theme.colors.accentSoft,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons
                            name={account.role === "teacher" ? "person-circle-outline" : "school-outline"}
                            size={20}
                            color={theme.colors.accent}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                            {roleLabel}通用帳號
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                            {account.email}
                          </Text>
                        </View>
                        <Ionicons name="arrow-forward" size={18} color={theme.colors.muted} />
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </Card>
        )}

        <Card title="關於學校帳號登入" subtitle="流程和 TronClass 類似">
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
                  會導到學校官方認證系統輸入帳密，我們不直接儲存您的學校密碼
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
                  使用現有學校帳號，無需另外註冊
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
                  自動同步您的姓名、學號、系所等資訊
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {ssoConfig?.ssoConfig && (
          <Card title="技術資訊" subtitle="開發者參考">
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>協議類型</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                  {ssoConfig.ssoConfig.provider.toUpperCase()}
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.muted }}>開通狀態</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                  {ssoStatusLabel}
                </Text>
              </View>
              {ssoConfig.ssoConfig.authorizationEndpoint && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.muted }}>認證端點</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 11 }} numberOfLines={1}>
                    {ssoConfig.ssoConfig.authorizationEndpoint.replace(/https?:\/\//, "").slice(0, 30)}...
                  </Text>
                </View>
              )}
              {ssoAvailability.missingFields.length > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.muted }}>缺少欄位</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 11 }}>
                    {ssoAvailability.missingFields.join(", ")}
                  </Text>
                </View>
              )}
              {ssoConfig.ssoConfig.casServerUrl && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.muted }}>CAS 伺服器</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 11 }} numberOfLines={1}>
                    {ssoConfig.ssoConfig.casServerUrl.replace(/https?:\/\//, "").slice(0, 30)}...
                  </Text>
                </View>
              )}
              {ssoConfig.ssoConfig.scopes && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.muted }}>Scopes</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 11 }}>
                    {ssoConfig.ssoConfig.scopes.join(", ")}
                  </Text>
                </View>
              )}
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
