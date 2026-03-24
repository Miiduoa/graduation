/* eslint-disable */
import React, { useState, useEffect } from "react";
import { ScrollView, Text, View, AccessibilityInfo, Alert, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
  ListItem,
  ToggleSwitch,
  SegmentedControl,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";

type TextSize = "small" | "medium" | "large" | "xlarge";
type ContrastMode = "normal" | "high";

type AccessibilitySettings = {
  textSize: TextSize;
  contrastMode: ContrastMode;
  reduceMotion: boolean;
  boldText: boolean;
  hapticFeedback: boolean;
  screenReaderHints: boolean;
  autoReadAnnouncements: boolean;
  colorBlindMode: "none" | "protanopia" | "deuteranopia" | "tritanopia";
};

const STORAGE_KEY = "@accessibility_settings";

const DEFAULT_SETTINGS: AccessibilitySettings = {
  textSize: "medium",
  contrastMode: "normal",
  reduceMotion: false,
  boldText: false,
  hapticFeedback: true,
  screenReaderHints: true,
  autoReadAnnouncements: false,
  colorBlindMode: "none",
};

const TEXT_SIZE_LABELS: Record<TextSize, { label: string; scale: number }> = {
  small: { label: "小", scale: 0.85 },
  medium: { label: "標準", scale: 1 },
  large: { label: "大", scale: 1.2 },
  xlarge: { label: "特大", scale: 1.4 },
};

const COLOR_BLIND_OPTIONS = [
  { key: "none", label: "無" },
  { key: "protanopia", label: "紅色盲" },
  { key: "deuteranopia", label: "綠色盲" },
  { key: "tritanopia", label: "藍色盲" },
];

export function AccessibilitySettingsScreen(props: any) {
  const nav = props?.navigation;

  const [settings, setSettings] = useState<AccessibilitySettings>(DEFAULT_SETTINGS);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    loadSettings();
    checkSystemAccessibility();
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      }
    } catch (e) {
      console.error("Failed to load accessibility settings:", e);
    }
  };

  const saveSettings = async (newSettings: AccessibilitySettings) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (e) {
      console.error("Failed to save accessibility settings:", e);
    }
  };

  const checkSystemAccessibility = async () => {
    const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
    const screenReader = await AccessibilityInfo.isScreenReaderEnabled();
    setSystemReduceMotion(reduceMotion);
    setScreenReaderEnabled(screenReader);

    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setSystemReduceMotion
    );
    const screenReaderSubscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled
    );

    return () => {
      reduceMotionSubscription.remove();
      screenReaderSubscription.remove();
    };
  };

  const updateSetting = <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  };

  const resetToDefaults = () => {
    Alert.alert("重設設定", "確定要將所有無障礙設定恢復為預設值嗎？", [
      { text: "取消", style: "cancel" },
      {
        text: "重設",
        style: "destructive",
        onPress: () => saveSettings(DEFAULT_SETTINGS),
      },
    ]);
  };

  const getPreviewTextStyle = () => ({
    fontSize: 14 * TEXT_SIZE_LABELS[settings.textSize].scale,
    fontWeight: settings.boldText ? ("700" as const) : ("400" as const),
    color:
      settings.contrastMode === "high"
        ? "#FFFFFF"
        : theme.colors.text,
  });

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="系統偵測" subtitle="目前系統無障礙狀態">
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons
                  name="eye-outline"
                  size={20}
                  color={screenReaderEnabled ? theme.colors.success : theme.colors.muted}
                />
                <Text style={{ color: theme.colors.text }}>螢幕閱讀器</Text>
              </View>
              <Pill
                text={screenReaderEnabled ? "已啟用" : "未啟用"}
                kind={screenReaderEnabled ? "success" : "muted"}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons
                  name="pause-outline"
                  size={20}
                  color={systemReduceMotion ? theme.colors.success : theme.colors.muted}
                />
                <Text style={{ color: theme.colors.text }}>減少動態效果</Text>
              </View>
              <Pill
                text={systemReduceMotion ? "已啟用" : "未啟用"}
                kind={systemReduceMotion ? "success" : "muted"}
              />
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="文字大小" subtitle="調整 App 內文字顯示大小" delay={50}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(Object.keys(TEXT_SIZE_LABELS) as TextSize[]).map((size) => (
                <Pressable
                  key={size}
                  onPress={() => updateSetting("textSize", size)}
                  accessibilityRole="button"
                  accessibilityLabel={`設定文字大小為${TEXT_SIZE_LABELS[size].label}`}
                  accessibilityState={{ selected: settings.textSize === size }}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: theme.radius.md,
                    backgroundColor:
                      settings.textSize === size
                        ? theme.colors.accent
                        : theme.colors.surface2,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: settings.textSize === size ? "#fff" : theme.colors.text,
                      fontWeight: "600",
                      fontSize: 12 + (TEXT_SIZE_LABELS[size].scale - 1) * 8,
                    }}
                  >
                    {TEXT_SIZE_LABELS[size].label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View
              style={{
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
                預覽效果
              </Text>
              <Text style={getPreviewTextStyle()}>
                這是一段範例文字，用來展示目前的文字大小設定。您可以根據自己的閱讀習慣調整文字大小。
              </Text>
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="顯示選項" subtitle="調整視覺呈現方式" delay={100}>
          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }}>
                對比度模式
              </Text>
              <SegmentedControl
                options={[
                  { key: "normal", label: "標準" },
                  { key: "high", label: "高對比" },
                ]}
                selected={settings.contrastMode}
                onChange={(k) => updateSetting("contrastMode", k as ContrastMode)}
              />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>粗體文字</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  讓所有文字更粗以提高可讀性
                </Text>
              </View>
              <ToggleSwitch
                value={settings.boldText}
                onToggle={() => updateSetting("boldText", !settings.boldText)}
              />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>減少動態效果</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  減少動畫和過場效果
                </Text>
              </View>
              <ToggleSwitch
                value={settings.reduceMotion}
                onToggle={() => updateSetting("reduceMotion", !settings.reduceMotion)}
              />
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="色盲輔助" subtitle="調整色彩顯示模式" delay={150}>
          <View style={{ gap: 10 }}>
            {COLOR_BLIND_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() =>
                  updateSetting("colorBlindMode", option.key as AccessibilitySettings["colorBlindMode"])
                }
                accessibilityRole="radio"
                accessibilityState={{ selected: settings.colorBlindMode === option.key }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor:
                    settings.colorBlindMode === option.key
                      ? theme.colors.accentSoft
                      : theme.colors.surface2,
                  borderWidth: 2,
                  borderColor:
                    settings.colorBlindMode === option.key
                      ? theme.colors.accent
                      : "transparent",
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor:
                      settings.colorBlindMode === option.key
                        ? theme.colors.accent
                        : theme.colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                  }}
                >
                  {settings.colorBlindMode === option.key && (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: theme.colors.accent,
                      }}
                    />
                  )}
                </View>
                <Text style={{ color: theme.colors.text, flex: 1 }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 10, lineHeight: 18 }}>
            選擇您的色盲類型，App 會調整圖表和狀態顏色以提高辨識度。
          </Text>
        </AnimatedCard>

        <AnimatedCard title="觸覺與聲音" subtitle="回饋設定" delay={200}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>觸覺回饋</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  按下按鈕時產生震動
                </Text>
              </View>
              <ToggleSwitch
                value={settings.hapticFeedback}
                onToggle={() => updateSetting("hapticFeedback", !settings.hapticFeedback)}
              />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>自動朗讀公告</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  開啟公告時自動使用語音朗讀
                </Text>
              </View>
              <ToggleSwitch
                value={settings.autoReadAnnouncements}
                onToggle={() => updateSetting("autoReadAnnouncements", !settings.autoReadAnnouncements)}
              />
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="螢幕閱讀器" subtitle="VoiceOver / TalkBack 設定" delay={250}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>顯示操作提示</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  為每個元素提供詳細的操作說明
                </Text>
              </View>
              <ToggleSwitch
                value={settings.screenReaderHints}
                onToggle={() => updateSetting("screenReaderHints", !settings.screenReaderHints)}
              />
            </View>
          </View>

          <View
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accentSoft,
              flexDirection: "row",
              gap: 10,
            }}
          >
            <Ionicons name="information-circle" size={20} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.muted, flex: 1, fontSize: 12, lineHeight: 18 }}>
              本 App 支援 iOS VoiceOver 和 Android TalkBack。所有互動元素都有適當的無障礙標籤。
            </Text>
          </View>
        </AnimatedCard>

        <AnimatedCard title="鍵盤快捷鍵" subtitle="使用外接鍵盤操作" delay={300}>
          <View style={{ gap: 8 }}>
            {[
              { keys: "Tab", action: "切換到下一個元素" },
              { keys: "Shift + Tab", action: "切換到上一個元素" },
              { keys: "Enter / Space", action: "啟動目前元素" },
              { keys: "Escape", action: "關閉對話框/返回" },
              { keys: "Cmd/Ctrl + F", action: "搜尋" },
            ].map((shortcut, i) => (
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
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {shortcut.keys}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{shortcut.action}</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        <View style={{ gap: 10, marginTop: 8 }}>
          <Button text="重設為預設值" onPress={resetToDefaults} />
          <Button
            text="系統無障礙設定"
            kind="primary"
            onPress={() => {
              Alert.alert(
                "開啟系統設定",
                "請到系統設定中調整更多無障礙選項",
                [{ text: "好" }]
              );
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
