import React, { useMemo, useState, useEffect } from "react";
import { ScrollView, Text, TextInput, View, Alert, Linking, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Screen, Card, Button, Pill, SectionTitle, AnimatedCard, ListItem, SegmentedControl, ToggleSwitch, Divider } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { useDemo, type DemoMode } from "../state/demo";
import { useThemeMode } from "../state/theme";
import { findSchoolsByCode, mockSchools, normalizeSchoolCode } from "@campus/shared/src/schools";
import { useSchool } from "../state/school";
import { clearAllCache, getCacheSize } from "../data/cachedSource";
import { getHybridSourceStatus } from "../data/hybridSource";
import { formatFileSize } from "../utils/format";

const APP_VERSION = Constants.expoConfig?.version ?? Constants.manifest?.version ?? "1.0.0";

function getLegalUrl(type: "privacy" | "terms"): string {
  const extra = (Constants.expoConfig as any)?.extra ?? {};
  const baseUrl = extra.legalBaseUrl ?? "https://your-campus-app.com";
  return type === "privacy" ? `${baseUrl}/privacy` : `${baseUrl}/terms`;
}

const modes: Array<{ key: DemoMode; label: string; hint: string }> = [
  { key: "normal", label: "正常", hint: "顯示 mock 列表" },
  { key: "loading", label: "Loading", hint: "顯示載入中" },
  { key: "empty", label: "Empty", hint: "顯示空狀態" },
  { key: "error", label: "Error", hint: "顯示錯誤" },
];

export function SettingsScreen(props: any) {
  const nav = props?.navigation;
  const demo = useDemo();
  const themeMode = useThemeMode();
  const { selection, setSelection, school } = useSchool();

  const [codeInput, setCodeInput] = useState(selection.code);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; approximateBytes: number } | null>(null);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [hybridStatus, setHybridStatus] = useState<{
    preferRealApi: boolean;
    fallbackToMock: boolean;
    registeredSchools: string[];
    schoolContextId: string | null;
  } | null>(null);

  const normalized = useMemo(() => normalizeSchoolCode(codeInput), [codeInput]);
  const matches = useMemo(() => findSchoolsByCode(normalized), [normalized]);

  useEffect(() => {
    getCacheSize().then(setCacheInfo);
  }, []);

  useEffect(() => {
    if (!showDeveloper) return;
    setHybridStatus(getHybridSourceStatus());
  }, [showDeveloper, school?.id]);

  const handleClearCache = async () => {
    Alert.alert(
      "清除快取",
      "確定要清除所有快取資料嗎？這會使 App 在下次開啟時重新載入所有資料。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清除",
          style: "destructive",
          onPress: async () => {
            await clearAllCache();
            setCacheInfo({ count: 0, approximateBytes: 0 });
            Alert.alert("完成", "快取已清除");
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="外觀設定" subtitle="個人化你的 App 外觀">
          <View style={{ gap: 16 }}>
            <View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 8, fontWeight: "500" }}>
                主題模式
              </Text>
              <SegmentedControl
                options={[
                  { key: "dark", label: "深色" },
                  { key: "light", label: "淺色" },
                ]}
                selected={themeMode.mode}
                onChange={(k) => themeMode.setMode(k as "dark" | "light")}
              />
            </View>
            <Divider spacing={0} />
            <ListItem
              icon="language-outline"
              title="語言設定"
              subtitle="繁體中文 / English / 日本語 / 한국어"
              onPress={() => nav?.navigate?.("LanguageSettings")}
            />
            <ListItem
              icon="accessibility-outline"
              title="無障礙設定"
              subtitle="文字大小、對比度、螢幕閱讀器"
              onPress={() => nav?.navigate?.("AccessibilitySettings")}
            />
            <ListItem
              icon="color-palette-outline"
              title="主題預覽"
              subtitle="查看各學校品牌主題色"
              onPress={() => nav?.navigate?.("ThemePreview")}
            />
          </View>
        </AnimatedCard>

        <AnimatedCard title="學校設定" subtitle={`目前：${school.name}`} delay={100}>
          {school.themeColor && (
            <View style={{
              marginBottom: 12,
              padding: 14,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              ...softShadowStyle(theme.shadows.soft),
            }}>
              <View style={{
                width: 42,
                height: 42,
                borderRadius: theme.radius.full,
                backgroundColor: school.themeColor,
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                  {school.name.charAt(0)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 15 }}>
                  {school.name}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  主題色：{school.themeColor}
                </Text>
              </View>
              <View style={{
                width: 24,
                height: 24,
                borderRadius: theme.radius.xs,
                backgroundColor: theme.colors.accent,
              }} />
            </View>
          )}

          <Text style={{ color: theme.colors.textSecondary, marginBottom: 8, fontSize: 13, fontWeight: "500" }}>
            輸入學校代碼切換
          </Text>
          <TextInput
            value={codeInput}
            onChangeText={(t) => {
              setCodeInput(t);
              setSelection({ code: t, schoolId: null });
            }}
            autoCapitalize="characters"
            placeholder="例如 NCHU"
            placeholderTextColor={theme.colors.muted}
            style={{
              paddingVertical: 13,
              paddingHorizontal: 16,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              color: theme.colors.text,
              fontSize: 15,
            }}
          />

          {normalized.length > 0 && matches.length === 0 && (
            <View style={{ marginTop: 10 }}>
              <Pill text="找不到此代碼（可先用 DEMO 測試）" size="sm" />
            </View>
          )}

          {normalized.length > 0 && matches.length === 1 && (
            <View style={{ marginTop: 12 }}>
              <View style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 10,
                gap: 8,
              }}>
                {matches[0].themeColor && (
                  <View style={{
                    width: 16,
                    height: 16,
                    borderRadius: theme.radius.full,
                    backgroundColor: matches[0].themeColor,
                  }} />
                )}
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  {matches[0].themeColor ? `主題色：${matches[0].themeColor}` : "無自訂主題色"}
                </Text>
              </View>
              <Button
                text={`切換至 ${matches[0].name}`}
                kind="primary"
                onPress={() => setSelection({ code: matches[0].code, schoolId: matches[0].id })}
              />
            </View>
          )}

          {normalized.length > 0 && matches.length > 1 && (
            <View style={{ marginTop: 12, gap: 10 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>選擇學校：</Text>
              {matches.map((s) => (
                <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {s.themeColor && (
                    <View style={{
                      width: 12,
                      height: 12,
                      borderRadius: theme.radius.full,
                      backgroundColor: s.themeColor,
                    }} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Button
                      text={s.name}
                      onPress={() => setSelection({ code: s.code, schoolId: s.id })}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{
            marginTop: 14,
            padding: 12,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accentSoft,
          }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
              示範代碼：{mockSchools.map((s) => s.code).join(" / ")}
            </Text>
          </View>
        </AnimatedCard>

        <AnimatedCard title="儲存空間" subtitle="管理 App 快取" delay={200}>
          <View style={{ gap: 12 }}>
            <ListItem
              icon="folder-outline"
              title="快取資料"
              rightText={cacheInfo ? `${cacheInfo.count} 項 · ${formatFileSize(cacheInfo.approximateBytes)}` : "計算中..."}
            />
            <Button text="清除快取" kind="accent-ghost" icon="trash-outline" onPress={handleClearCache} />
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 10, lineHeight: 18 }}>
            清除快取可以釋放儲存空間，但會使 App 需要重新下載資料。
          </Text>
        </AnimatedCard>

        <AnimatedCard title="帳號與隱私" subtitle="管理您的資料" delay={300}>
          <View style={{ gap: 2 }}>
            <ListItem
              icon="download-outline"
              title="匯出我的資料"
              subtitle="下載您的所有資料"
              onPress={() => nav?.navigate?.("DataExport")}
            />
            <Divider spacing={0} />
            <ListItem
              icon="trash-outline"
              title="刪除帳號"
              subtitle="永久刪除您的帳號和資料"
              danger
              onPress={() => nav?.navigate?.("AccountDeletion")}
            />
          </View>
        </AnimatedCard>

        <AnimatedCard title="關於" subtitle="App 資訊與連結" delay={400}>
          <View style={{ gap: 2 }}>
            <ListItem
              icon="information-circle-outline"
              title="版本"
              rightText={APP_VERSION}
            />
            <ListItem
              icon="school-outline"
              title="開發團隊"
              rightText="畢業專題團隊"
            />
            <Divider spacing={4} />
            <ListItem
              icon="chatbubble-outline"
              title="意見回饋"
              onPress={() => nav?.navigate?.("Feedback")}
            />
            <ListItem
              icon="bug-outline"
              title="回報問題"
              subtitle="發現 Bug？告訴我們"
              onPress={() => nav?.navigate?.("BugReport")}
            />
            <ListItem
              icon="help-circle-outline"
              title="幫助中心"
              onPress={() => nav?.navigate?.("Help")}
            />
            <Divider spacing={4} />
            <ListItem
              icon="document-text-outline"
              title="隱私政策"
              onPress={() => {
                const url = getLegalUrl("privacy");
                Linking.canOpenURL(url).then((supported) => {
                  if (supported) {
                    Linking.openURL(url);
                  } else {
                    Alert.alert("無法開啟", "請稍後再試或聯繫開發團隊");
                  }
                });
              }}
            />
            <ListItem
              icon="shield-checkmark-outline"
              title="使用條款"
              onPress={() => {
                const url = getLegalUrl("terms");
                Linking.canOpenURL(url).then((supported) => {
                  if (supported) {
                    Linking.openURL(url);
                  } else {
                    Alert.alert("無法開啟", "請稍後再試或聯繫開發團隊");
                  }
                });
              }}
            />
          </View>
        </AnimatedCard>

        <AnimatedCard title="開發者選項" subtitle="點擊展開進階設定" delay={500}>
          <ListItem
            icon="code-slash-outline"
            title="顯示開發者選項"
            rightIcon={showDeveloper ? "chevron-up" : "chevron-down"}
            onPress={() => setShowDeveloper(!showDeveloper)}
          />

          {showDeveloper && (
            <View style={{ marginTop: 14, gap: 16 }}>
              <View>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 8, fontWeight: "500" }}>
                  Demo 模式
                </Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <Pill text={`目前：${demo.mode}`} kind="accent" size="sm" />
                </View>
                <View style={{ gap: 8 }}>
                  {modes.map((m) => (
                    <Button
                      key={m.key}
                      text={`${m.label}：${m.hint}`}
                      kind={demo.mode === m.key ? "primary" : "ghost"}
                      onPress={() => demo.setMode(m.key)}
                    />
                  ))}
                </View>
              </View>

              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
                Demo 模式用於展示不同的 UI 狀態（載入中、空狀態、錯誤）。正式版本應將此功能隱藏。
              </Text>

              <View
                style={{
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  padding: 14,
                  gap: 8,
                  ...softShadowStyle(theme.shadows.soft),
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>資料來源診斷</Text>
                <Divider spacing={4} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  mode: {process.env.EXPO_PUBLIC_DATA_SOURCE_MODE ?? "auto"}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  schoolContext: {hybridStatus?.schoolContextId ?? "null"}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  preferRealApi: {String(hybridStatus?.preferRealApi ?? false)}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  fallbackToMock: {String(hybridStatus?.fallbackToMock ?? true)}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  adapters: {hybridStatus?.registeredSchools.join(", ") || "(none)"}
                </Text>
                <View style={{ marginTop: 4 }}>
                  <Button
                    text="重新整理診斷資訊"
                    kind="accent-ghost"
                    icon="refresh-outline"
                    onPress={() => setHybridStatus(getHybridSourceStatus())}
                  />
                </View>
              </View>
            </View>
          )}
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
