import React, { useState, useEffect } from "react";
import { ScrollView, Text, View, Pressable, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
  SectionTitle,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import {
  getSchoolSSOConfig,
  performSSOLogin,
  linkSSOToFirebase,
  isSSOAvailable,
  getSSOProviderName,
  SSOError,
  type SchoolSSOConfig,
  type SSOUserInfo,
} from "../services/sso";

type LoginStep = "idle" | "checking" | "authenticating" | "linking" | "success" | "error";

export function SSOLoginScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();

  const [ssoConfig, setSsoConfig] = useState<SchoolSSOConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);
  const [ssoUserInfo, setSsoUserInfo] = useState<SSOUserInfo | null>(null);

  useEffect(() => {
    loadSSOConfig();
  }, [school.id]);

  const loadSSOConfig = async () => {
    setLoading(true);
    setConfigError(null);
    try {
      const config = await getSchoolSSOConfig(school.id);
      setSsoConfig(config);
    } catch (e: any) {
      console.error("Failed to load SSO config:", e);
      setConfigError(e?.message || "無法載入 SSO 設定，請檢查網路連線後重試");
    } finally {
      setLoading(false);
    }
  };

  const handleSSOLogin = async () => {
    setError(null);
    setErrorCode(null);
    setIsRetryable(false);
    setStep("checking");

    try {
      if (!isSSOAvailable(ssoConfig)) {
        throw new SSOError("此學校尚未設定 SSO 登入", "SSO_NOT_CONFIGURED");
      }

      setStep("authenticating");
      const userInfo = await performSSOLogin(school.id);

      if (!userInfo) {
        setStep("idle");
        return;
      }

      setSsoUserInfo(userInfo);
      setStep("linking");

      const { uid, isNewUser } = await linkSSOToFirebase(school.id, userInfo);

      setStep("success");

      await auth.refreshProfile();

      setTimeout(() => {
        Alert.alert(
          isNewUser ? "歡迎加入！" : "登入成功",
          isNewUser
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
    } catch (e: any) {
      console.error("SSO login error:", e);
      
      if (e instanceof SSOError) {
        // 如果是使用者取消，靜默返回 idle 狀態
        if (e.code === "SSO_CANCELLED") {
          setStep("idle");
          return;
        }
        
        setError(e.userFriendlyMessage);
        setErrorCode(e.code);
        setIsRetryable(e.isRetryable);
      } else {
        setError(e?.message || "登入失敗，請稍後再試");
        setIsRetryable(true);
      }
      
      setStep("error");
    }
  };

  const handleRetry = () => {
    setStep("idle");
    setError(null);
    setErrorCode(null);
    setIsRetryable(false);
    setSsoUserInfo(null);
  };

  const handleRetryLogin = () => {
    handleSSOLogin();
  };

  const getStepIcon = (): string => {
    switch (step) {
      case "checking":
        return "shield-checkmark-outline";
      case "authenticating":
        return "key-outline";
      case "linking":
        return "link-outline";
      case "success":
        return "checkmark-circle";
      case "error":
        return "alert-circle";
      default:
        return "log-in-outline";
    }
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

  const getProviderIcon = (): string => {
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

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入 SSO 設定...</Text>
        </View>
      </Screen>
    );
  }

  if (configError) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: theme.colors.error + "20",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <Ionicons name="cloud-offline-outline" size={40} color={theme.colors.error} />
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
            無法載入 SSO 設定
          </Text>
          <Text style={{ color: theme.colors.muted, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
            {configError}
          </Text>
          <View style={{ marginTop: 24, gap: 12, width: "100%" }}>
            <Button text="重新載入" kind="primary" onPress={loadSSOConfig} />
            <Button text="返回" onPress={() => nav?.goBack?.()} />
          </View>
        </View>
      </Screen>
    );
  }

  const ssoAvailable = isSSOAvailable(ssoConfig);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="學校單一登入" subtitle={school.name}>
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: ssoAvailable ? theme.colors.accentSoft : theme.colors.surface2,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons
                name={getProviderIcon() as any}
                size={40}
                color={ssoAvailable ? theme.colors.accent : theme.colors.muted}
              />
            </View>

            {ssoAvailable ? (
              <>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
                  {getSSOProviderName(ssoConfig)}
                </Text>
                <Text style={{ color: theme.colors.muted, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                  {getProviderDescription()}
                </Text>
              </>
            ) : (
              <>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
                  SSO 尚未設定
                </Text>
                <Text style={{ color: theme.colors.muted, marginTop: 8, textAlign: "center", lineHeight: 20 }}>
                  此學校目前尚未啟用單一登入功能{"\n"}請使用 Email/Password 登入
                </Text>
              </>
            )}
          </View>

          {ssoAvailable && ssoConfig?.ssoConfig?.provider && (
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
              {ssoConfig.emailDomain && (
                <Pill text={`@${ssoConfig.emailDomain}`} />
              )}
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
              {ssoAvailable && (
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
                      使用 {getSSOProviderName(ssoConfig)} 登入
                    </Text>
                    <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 }}>
                      使用學校帳號快速登入
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color="#fff" />
                </Pressable>
              )}

              {ssoConfig?.allowEmailLogin !== false && (
                <Pressable
                  onPress={() => nav?.goBack?.()}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 16,
                    borderRadius: theme.radius.lg,
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
                      backgroundColor: theme.colors.accentSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="mail" size={24} color={theme.colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>
                      使用 Email 登入
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      使用 Email 和密碼登入或註冊
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color={theme.colors.muted} />
                </Pressable>
              )}
            </View>
          </Card>
        )}

        <Card title="關於 SSO 登入" subtitle="什麼是單一登入？">
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
                  使用學校認證系統，您的密碼不會傳送給第三方
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
              {ssoConfig.ssoConfig.authorizationEndpoint && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.muted }}>認證端點</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 11 }} numberOfLines={1}>
                    {ssoConfig.ssoConfig.authorizationEndpoint.replace(/https?:\/\//, "").slice(0, 30)}...
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
