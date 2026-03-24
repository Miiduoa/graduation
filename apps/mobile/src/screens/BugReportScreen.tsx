/* eslint-disable */
import React, { useState } from "react";
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
  SegmentedControl,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb } from "../firebase";

type BugCategory = "crash" | "ui" | "performance" | "data" | "feature" | "other";
type BugSeverity = "low" | "medium" | "high" | "critical";

const CATEGORY_OPTIONS: Array<{ key: BugCategory; label: string; icon: string }> = [
  { key: "crash", label: "閃退/當機", icon: "skull-outline" },
  { key: "ui", label: "介面問題", icon: "layers-outline" },
  { key: "performance", label: "效能緩慢", icon: "speedometer-outline" },
  { key: "data", label: "資料錯誤", icon: "alert-circle-outline" },
  { key: "feature", label: "功能異常", icon: "construct-outline" },
  { key: "other", label: "其他", icon: "ellipsis-horizontal" },
];

const SEVERITY_OPTIONS: Array<{ key: BugSeverity; label: string; color: string }> = [
  { key: "low", label: "輕微", color: "#22C55E" },
  { key: "medium", label: "中等", color: "#F59E0B" },
  { key: "high", label: "嚴重", color: "#F97316" },
  { key: "critical", label: "緊急", color: "#EF4444" },
];

export function BugReportScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [category, setCategory] = useState<BugCategory>("feature");
  const [severity, setSeverity] = useState<BugSeverity>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [includeDeviceInfo, setIncludeDeviceInfo] = useState(true);
  const [includeUserInfo, setIncludeUserInfo] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const getDeviceInfo = () => ({
    platform: Platform.OS,
    osVersion: Platform.Version,
    deviceName: Device.deviceName,
    deviceModel: Device.modelName,
    deviceBrand: Device.brand,
    isDevice: Device.isDevice,
    appVersion: Constants.expoConfig?.version || "unknown",
    sdkVersion: Constants.expoConfig?.sdkVersion || "unknown",
  });

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert("錯誤", "請填寫問題標題");
      return;
    }

    if (!description.trim()) {
      Alert.alert("錯誤", "請填寫問題描述");
      return;
    }

    setSubmitting(true);

    try {
      const reportData: Record<string, any> = {
        category,
        severity,
        title: title.trim(),
        description: description.trim(),
        stepsToReproduce: steps.trim() || null,
        expectedBehavior: expected.trim() || null,
        status: "new",
        createdAt: serverTimestamp(),
        schoolId: school.id,
      };

      if (includeDeviceInfo) {
        reportData.deviceInfo = getDeviceInfo();
      }

      if (includeUserInfo && auth.user) {
        reportData.reporterId = auth.user.uid;
        reportData.reporterEmail = auth.user.email;
      }

      await addDoc(collection(db, "bugReports"), reportData);

      setSubmitted(true);
      setTimeout(() => {
        Alert.alert("感謝回報", "我們已收到您的問題回報，將盡快處理。", [
          { text: "確定", onPress: () => nav?.goBack?.() },
        ]);
      }, 500);
    } catch (error: any) {
      console.error("Bug report error:", error);
      Alert.alert("提交失敗", error?.message || "無法提交回報，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="" subtitle="">
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: theme.colors.success + "20",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Ionicons name="checkmark-circle" size={48} color={theme.colors.success} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: "700" }}>
                回報已送出
              </Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  textAlign: "center",
                  marginTop: 12,
                  lineHeight: 22,
                }}
              >
                感謝您的回報！{"\n"}
                我們會盡快處理並改善問題。
              </Text>
            </View>
          </AnimatedCard>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="回報問題" subtitle="幫助我們改善 App">
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <Ionicons name="bug-outline" size={40} color={theme.colors.accent} />
            <Text
              style={{
                color: theme.colors.muted,
                textAlign: "center",
                marginTop: 8,
                lineHeight: 20,
              }}
            >
              發現 Bug？請詳細描述問題，{"\n"}我們會盡快修復。
            </Text>
          </View>
        </AnimatedCard>

        <Card title="問題類型" subtitle="選擇最符合的類別">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CATEGORY_OPTIONS.map((option) => (
              <Button
                key={option.key}
                text={option.label}
                kind={category === option.key ? "primary" : "secondary"}
                onPress={() => setCategory(option.key)}
              />
            ))}
          </View>
        </Card>

        <Card title="嚴重程度">
          <View style={{ flexDirection: "row", gap: 8 }}>
            {SEVERITY_OPTIONS.map((option) => (
              <Button
                key={option.key}
                text={option.label}
                kind={severity === option.key ? "primary" : "secondary"}
                onPress={() => setSeverity(option.key)}
              />
            ))}
          </View>
        </Card>

        <Card title="問題描述">
          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }}>
                標題 *
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="簡短描述問題"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                }}
              />
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }}>
                詳細描述 *
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="請詳細描述您遇到的問題"
                placeholderTextColor={theme.colors.muted}
                multiline
                numberOfLines={4}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                  minHeight: 100,
                  textAlignVertical: "top",
                }}
              />
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }}>
                重現步驟（選填）
              </Text>
              <TextInput
                value={steps}
                onChangeText={setSteps}
                placeholder="1. 先做什麼&#10;2. 再做什麼&#10;3. 然後..."
                placeholderTextColor={theme.colors.muted}
                multiline
                numberOfLines={3}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
              />
            </View>

            <View>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }}>
                預期行為（選填）
              </Text>
              <TextInput
                value={expected}
                onChangeText={setExpected}
                placeholder="您原本期望會發生什麼？"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                }}
              />
            </View>
          </View>
        </Card>

        <Card title="附加資訊">
          <View style={{ gap: 12 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                  包含裝置資訊
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  型號、系統版本、App 版本
                </Text>
              </View>
              <Button
                text={includeDeviceInfo ? "已啟用" : "已停用"}
                kind={includeDeviceInfo ? "primary" : "secondary"}
                onPress={() => setIncludeDeviceInfo(!includeDeviceInfo)}
              />
            </View>

            {auth.user && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                    包含帳號資訊
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    方便我們聯繫您了解更多細節
                  </Text>
                </View>
                <Button
                  text={includeUserInfo ? "已啟用" : "已停用"}
                  kind={includeUserInfo ? "primary" : "secondary"}
                  onPress={() => setIncludeUserInfo(!includeUserInfo)}
                />
              </View>
            )}

            {includeDeviceInfo && (
              <View
                style={{
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: "monospace" }}>
                  {Platform.OS} {Platform.Version} · {Device.modelName}
                  {"\n"}App v{Constants.expoConfig?.version || "?"}
                </Text>
              </View>
            )}
          </View>
        </Card>

        {submitting ? (
          <Card title="">
            <View style={{ alignItems: "center", paddingVertical: 20 }}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, marginTop: 12 }}>
                正在提交回報...
              </Text>
            </View>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            <Button text="提交回報" kind="primary" onPress={handleSubmit} />
            <Button text="取消" onPress={() => nav?.goBack?.()} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
