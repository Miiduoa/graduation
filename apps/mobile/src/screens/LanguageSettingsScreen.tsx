/* eslint-disable */
import React from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  Screen,
  Card,
  AnimatedCard,
  Pill,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useI18n, LANGUAGE_OPTIONS, type Language } from "../i18n";

export function LanguageSettingsScreen(props: any) {
  const nav = props?.navigation;
  const { language, setLanguage, t } = useI18n();

  const handleSelectLanguage = async (lang: Language) => {
    await setLanguage(lang);
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title={t.settings.language} subtitle="選擇 App 顯示語言">
          <View style={{ alignItems: "center", paddingVertical: 16 }}>
            <View
              style={{
                width: 70,
                height: 70,
                borderRadius: 35,
                backgroundColor: theme.colors.accentSoft,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Ionicons name="language" size={36} color={theme.colors.accent} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>
              多語言支援
            </Text>
            <Text
              style={{
                color: theme.colors.muted,
                textAlign: "center",
                marginTop: 8,
                lineHeight: 20,
              }}
            >
              選擇您偏好的語言，App 將以該語言顯示
            </Text>
          </View>
        </AnimatedCard>

        <Card title="可用語言" subtitle={`目前：${LANGUAGE_OPTIONS.find((l) => l.code === language)?.nativeName}`}>
          <View style={{ gap: 8 }}>
            {LANGUAGE_OPTIONS.map((option, index) => {
              const isSelected = language === option.code;
              return (
                <Pressable
                  key={option.code}
                  onPress={() => handleSelectLanguage(option.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`選擇${option.nativeName}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 14,
                    borderRadius: theme.radius.md,
                    backgroundColor: isSelected
                      ? theme.colors.accentSoft
                      : theme.colors.surface2,
                    borderWidth: 2,
                    borderColor: isSelected ? theme.colors.accent : "transparent",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontWeight: isSelected ? "700" : "500",
                        fontSize: 16,
                      }}
                    >
                      {option.nativeName}
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.muted,
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {option.name}
                    </Text>
                  </View>
                  {isSelected && (
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: theme.colors.accent,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="checkmark" size={18} color="#fff" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Card>

        <AnimatedCard title="說明" delay={100}>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Ionicons name="information-circle" size={20} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                更改語言後，App 會立即更新顯示。部分來自伺服器的內容（如公告、活動）將維持原始語言。
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Ionicons name="globe" size={20} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                如果您希望貢獻其他語言的翻譯，歡迎透過意見回饋功能與我們聯繫。
              </Text>
            </View>
          </View>
        </AnimatedCard>

        <Card title="翻譯貢獻者">
          <View style={{ gap: 8 }}>
            {[
              { lang: "繁體中文", contributors: "開發團隊" },
              { lang: "简体中文", contributors: "開發團隊" },
              { lang: "English", contributors: "開發團隊" },
              { lang: "日本語", contributors: "志工翻譯" },
              { lang: "한국어", contributors: "志工翻譯" },
            ].map((item, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 8,
                  borderBottomWidth: i < 4 ? 1 : 0,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.text }}>{item.lang}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{item.contributors}</Text>
              </View>
            ))}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
