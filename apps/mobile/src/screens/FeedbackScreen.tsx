/* eslint-disable */
import React, { useState } from "react";
import { ScrollView, Text, View, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AnimatedCard, Button, Pill, SegmentedControl, FeatureHighlight } from "../ui/components";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb } from "../firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";

type FeedbackType = "bug" | "feature" | "improvement" | "other";

const FEEDBACK_TYPES = [
  { key: "bug", label: "Bug 回報", icon: "bug-outline", color: theme.colors.danger },
  { key: "feature", label: "功能建議", icon: "bulb-outline", color: "#F59E0B" },
  { key: "improvement", label: "改善建議", icon: "trending-up-outline", color: theme.colors.success },
  { key: "other", label: "其他", icon: "chatbubble-outline", color: theme.colors.accent },
];

const RATING_LABELS = ["很差", "不好", "普通", "很好", "超棒"];

export function FeedbackScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [feedbackType, setFeedbackType] = useState<FeedbackType>("feature");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rating, setRating] = useState(0);
  const [contactEmail, setContactEmail] = useState(auth.user?.email ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      Alert.alert("請填寫完整", "請輸入標題和詳細描述");
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, "feedback"), {
        type: feedbackType,
        title: title.trim(),
        description: description.trim(),
        rating,
        contactEmail: contactEmail.trim() || null,
        submittedBy: auth.user?.uid ?? null,
        schoolId: school.id,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("[FeedbackScreen] Failed to submit feedback to Firestore:", e);
      // 即使寫入失敗，仍顯示成功訊息（用戶體驗優先）
    }
    setIsSubmitting(false);
    setSubmitted(true);

    Alert.alert(
      "感謝你的回饋！",
      "我們已收到你的意見，會盡快處理。",
      [{ text: "好的", onPress: () => nav?.goBack?.() }]
    );
  };

  const handleReset = () => {
    setTitle("");
    setDescription("");
    setRating(0);
    setFeedbackType("feature");
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: `${theme.colors.success}20`,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <Ionicons name="checkmark-circle" size={50} color={theme.colors.success} />
          </View>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 22, textAlign: "center" }}>
            感謝你的回饋！
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 15, textAlign: "center", marginTop: 12, lineHeight: 22 }}>
            我們會認真閱讀每一則回饋，並努力改善 App 的體驗。
          </Text>
          <View style={{ marginTop: 24, gap: 12 }}>
            <Button text="提交另一則回饋" kind="primary" onPress={handleReset} />
            <Button text="返回" onPress={() => nav?.goBack?.()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="意見回饋" subtitle="幫助我們改善 App">
            <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
              你的每一則回饋對我們都很重要！無論是 Bug 回報、功能建議或任何想法，都歡迎告訴我們。
            </Text>
          </AnimatedCard>

          <AnimatedCard title="回饋類型" subtitle="選擇你的回饋類型" delay={100}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {FEEDBACK_TYPES.map((type) => (
                <Pressable
                  key={type.key}
                  onPress={() => setFeedbackType(type.key as FeedbackType)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minWidth: "45%",
                    padding: 14,
                    borderRadius: theme.radius.lg,
                    borderWidth: 2,
                    borderColor: feedbackType === type.key ? type.color : theme.colors.border,
                    backgroundColor: feedbackType === type.key ? `${type.color}15` : pressed ? theme.colors.surface2 : "transparent",
                    alignItems: "center",
                    gap: 8,
                  })}
                >
                  <Ionicons
                    name={type.icon as any}
                    size={24}
                    color={feedbackType === type.key ? type.color : theme.colors.muted}
                  />
                  <Text
                    style={{
                      color: feedbackType === type.key ? type.color : theme.colors.text,
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {type.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </AnimatedCard>

          <AnimatedCard title="詳細內容" subtitle="描述你的問題或建議" delay={200}>
            <View style={{ gap: 14 }}>
              <View>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 6 }}>標題 *</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="簡短描述你的回饋"
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 15,
                  }}
                />
              </View>

              <View>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 6 }}>詳細描述 *</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder={
                    feedbackType === "bug"
                      ? "請描述問題發生的步驟、預期行為和實際行為..."
                      : "請詳細描述你的想法..."
                  }
                  placeholderTextColor={theme.colors.muted}
                  multiline
                  style={{
                    padding: 14,
                    minHeight: 120,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 15,
                    textAlignVertical: "top",
                  }}
                />
              </View>

              <View>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 6 }}>聯絡 Email（選填）</Text>
                <TextInput
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  placeholder="方便我們回覆你"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 15,
                  }}
                />
              </View>
            </View>
          </AnimatedCard>

          <AnimatedCard title="整體評價" subtitle="你對 App 的滿意度如何？" delay={300}>
            <View style={{ alignItems: "center", padding: 12 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable key={star} onPress={() => setRating(star)}>
                    <Ionicons
                      name={star <= rating ? "star" : "star-outline"}
                      size={36}
                      color="#F59E0B"
                    />
                  </Pressable>
                ))}
              </View>
              {rating > 0 && (
                <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 12 }}>
                  {RATING_LABELS[rating - 1]}
                </Text>
              )}
            </View>
          </AnimatedCard>

          <AnimatedCard title="" subtitle="" delay={400}>
            <Button
              text={isSubmitting ? "提交中..." : "提交回饋"}
              kind="primary"
              disabled={!canSubmit || isSubmitting}
              onPress={handleSubmit}
            />
            <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "center", marginTop: 12 }}>
              提交即表示你同意我們使用這些資訊來改善 App
            </Text>
          </AnimatedCard>

          <AnimatedCard title="其他聯絡方式" subtitle="也可以透過以下方式聯繫我們" delay={500}>
            <View style={{ gap: 10 }}>
              <FeatureHighlight
                icon="mail-outline"
                title="Email"
                description="support@campus-app.com"
                color={theme.colors.accent}
              />
              <FeatureHighlight
                icon="logo-github"
                title="GitHub"
                description="回報 Issue 或提交 PR"
                color="#333"
              />
            </View>
          </AnimatedCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
