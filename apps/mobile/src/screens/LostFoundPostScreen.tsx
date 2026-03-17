import React, { useState, useMemo } from "react";
import { ScrollView, Text, View, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  AnimatedCard,
  Card,
  Button,
  Pill,
  SectionTitle,
  SegmentedControl,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";

type ItemType = "lost" | "found";
type ItemCategory = "electronics" | "cards" | "clothing" | "accessories" | "books" | "keys" | "other";

const CATEGORY_INFO: Record<ItemCategory, { label: string; icon: string; color: string }> = {
  electronics: { label: "電子產品", icon: "phone-portrait", color: "#3B82F6" },
  cards: { label: "證件/卡片", icon: "card", color: "#8B5CF6" },
  clothing: { label: "衣物", icon: "shirt", color: "#EC4899" },
  accessories: { label: "配件", icon: "glasses", color: "#F59E0B" },
  books: { label: "書籍", icon: "book", color: "#10B981" },
  keys: { label: "鑰匙", icon: "key", color: "#6366F1" },
  other: { label: "其他", icon: "help-circle", color: "#6B7280" },
};

const COMMON_LOCATIONS = [
  "圖書館",
  "學生餐廳",
  "體育館",
  "工程館",
  "文學院",
  "理學院",
  "行政大樓",
  "宿舍區",
  "停車場",
  "公車站",
];

function InputField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  maxLength,
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>{label}</Text>
        {required && <Text style={{ color: theme.colors.danger, marginLeft: 4 }}>*</Text>}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        multiline={multiline}
        maxLength={maxLength}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          paddingVertical: multiline ? 12 : 14,
          paddingHorizontal: 14,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          color: theme.colors.text,
          fontSize: 15,
          minHeight: multiline ? 120 : undefined,
        }}
      />
      {hint && (
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>{hint}</Text>
      )}
      {maxLength && (
        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4, textAlign: "right" }}>
          {value.length}/{maxLength}
        </Text>
      )}
    </View>
  );
}

export function LostFoundPostScreen(props: any) {
  const nav = props?.navigation;
  const route = props?.route;
  const editId = route?.params?.id;
  const initialType = route?.params?.type ?? "lost";
  const isEditing = !!editId;

  const auth = useAuth();
  const { school } = useSchool();

  const [type, setType] = useState<ItemType>(initialType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ItemCategory | null>(null);
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [dateStr, setDateStr] = useState(new Date().toISOString().split("T")[0]);
  const [contactInfo, setContactInfo] = useState("");
  const [characteristics, setCharacteristics] = useState<string[]>([]);
  const [newCharacteristic, setNewCharacteristic] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const finalLocation = location === "custom" ? customLocation : location;

  const isValid = useMemo(() => {
    return (
      title.trim().length >= 2 &&
      description.trim().length >= 10 &&
      category !== null &&
      finalLocation.trim().length > 0 &&
      dateStr.trim().length > 0
    );
  }, [title, description, category, finalLocation, dateStr]);

  const handleAddCharacteristic = () => {
    if (!newCharacteristic.trim()) return;
    if (characteristics.length >= 6) {
      Alert.alert("上限", "最多只能新增 6 個特徵");
      return;
    }
    setCharacteristics([...characteristics, newCharacteristic.trim()]);
    setNewCharacteristic("");
  };

  const handleRemoveCharacteristic = (idx: number) => {
    setCharacteristics(characteristics.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能發布失物招領");
      return;
    }

    if (!isValid) {
      Alert.alert("資料不完整", "請填寫所有必填欄位");
      return;
    }

    setSubmitting(true);

    try {
      await new Promise((r) => setTimeout(r, 1000));

      Alert.alert(
        isEditing ? "更新成功" : "發布成功",
        type === "lost"
          ? "您的遺失物品資訊已發布，希望能盡快找回！"
          : "感謝您的熱心幫助，願物品早日回到主人身邊！",
        [
          {
            text: "確定",
            onPress: () => nav?.goBack?.(),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert("發布失敗", error?.message ?? "請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  if (!auth.user) {
    return (
      <Screen>
        <AnimatedCard title="請先登入" subtitle="發布失物招領需要登入">
          <Text style={{ color: theme.colors.muted, marginBottom: 16 }}>
            登入後才能發布失物招領資訊，以便他人聯繫您。
          </Text>
          <Button text="前往登入" kind="primary" onPress={() => nav?.navigate?.("MeHome")} />
        </AnimatedCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AnimatedCard
            title={isEditing ? "編輯失物招領" : "發布失物招領"}
            subtitle={type === "lost" ? "告訴大家您遺失了什麼" : "告訴大家您拾獲了什麼"}
          >
            <View style={{ marginBottom: 20 }}>
              <SegmentedControl
                options={[
                  { key: "lost", label: "我遺失了" },
                  { key: "found", label: "我拾獲了" },
                ]}
                selected={type}
                onChange={(k) => setType(k as ItemType)}
              />
            </View>

            <View
              style={{
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: type === "lost" ? `${theme.colors.danger}15` : `${theme.colors.success}15`,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <Ionicons
                name={type === "lost" ? "search" : "gift"}
                size={22}
                color={type === "lost" ? theme.colors.danger : theme.colors.success}
              />
              <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
                {type === "lost"
                  ? "詳細描述您遺失的物品，有助於拾獲者辨認"
                  : "詳細描述您拾獲的物品，但請保留部分特徵以便確認失主身份"}
              </Text>
            </View>

            <InputField
              label="物品名稱"
              value={title}
              onChange={setTitle}
              placeholder="例如：黑色 AirPods Pro 耳機盒"
              maxLength={50}
              required
              hint="簡潔明瞭地描述物品"
            />

            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>物品類別</Text>
                <Text style={{ color: theme.colors.danger, marginLeft: 4 }}>*</Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {Object.entries(CATEGORY_INFO).map(([key, info]) => (
                  <Pressable
                    key={key}
                    onPress={() => setCategory(key as ItemCategory)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: theme.radius.md,
                      backgroundColor: category === key ? `${info.color}20` : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: category === key ? info.color : theme.colors.border,
                      gap: 6,
                    }}
                  >
                    <Ionicons
                      name={info.icon as any}
                      size={18}
                      color={category === key ? info.color : theme.colors.muted}
                    />
                    <Text
                      style={{
                        color: category === key ? info.color : theme.colors.muted,
                        fontWeight: "600",
                      }}
                    >
                      {info.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <InputField
              label="詳細描述"
              value={description}
              onChange={setDescription}
              placeholder={
                type === "lost"
                  ? "描述物品的外觀、特徵、遺失情況等。越詳細越有助於找回。"
                  : "描述物品的外觀（請保留部分特徵不公開，以便確認失主）"
              }
              multiline
              maxLength={500}
              required
            />

            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>物品特徵</Text>
                <Text style={{ color: theme.colors.muted, marginLeft: 8, fontSize: 12 }}>（選填，最多 6 個）</Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                <TextInput
                  value={newCharacteristic}
                  onChangeText={setNewCharacteristic}
                  placeholder="例如：黑色、有貼紙"
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 15,
                  }}
                  onSubmitEditing={handleAddCharacteristic}
                />
                <Pressable
                  onPress={handleAddCharacteristic}
                  style={{
                    width: 48,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="add" size={24} color="#fff" />
                </Pressable>
              </View>

              {characteristics.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {characteristics.map((char, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => handleRemoveCharacteristic(idx)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingLeft: 12,
                        paddingRight: 8,
                        paddingVertical: 6,
                        borderRadius: 999,
                        backgroundColor: theme.colors.accentSoft,
                        gap: 4,
                      }}
                    >
                      <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{char}</Text>
                      <Ionicons name="close-circle" size={16} color={theme.colors.accent} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>
                  {type === "lost" ? "遺失地點" : "拾獲地點"}
                </Text>
                <Text style={{ color: theme.colors.danger, marginLeft: 4 }}>*</Text>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {COMMON_LOCATIONS.map((loc) => (
                    <Pressable
                      key={loc}
                      onPress={() => setLocation(loc)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: location === loc ? theme.colors.accentSoft : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: location === loc ? theme.colors.accent : theme.colors.border,
                      }}
                    >
                      <Text
                        style={{
                          color: location === loc ? theme.colors.accent : theme.colors.muted,
                          fontWeight: "600",
                          fontSize: 13,
                        }}
                      >
                        {loc}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setLocation("custom")}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: location === "custom" ? theme.colors.accentSoft : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: location === "custom" ? theme.colors.accent : theme.colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: location === "custom" ? theme.colors.accent : theme.colors.muted,
                        fontWeight: "600",
                        fontSize: 13,
                      }}
                    >
                      其他地點
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>

              {location === "custom" && (
                <TextInput
                  value={customLocation}
                  onChangeText={setCustomLocation}
                  placeholder="請輸入詳細地點"
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 15,
                  }}
                />
              )}
            </View>

            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>
                  {type === "lost" ? "遺失日期" : "拾獲日期"}
                </Text>
                <Text style={{ color: theme.colors.danger, marginLeft: 4 }}>*</Text>
              </View>
              <TextInput
                value={dateStr}
                onChangeText={setDateStr}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                  fontSize: 15,
                }}
              />
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                格式：2026-03-01
              </Text>
            </View>

            <InputField
              label="聯絡方式"
              value={contactInfo}
              onChange={setContactInfo}
              placeholder="例如：LINE ID、Email、電話（僅登入用戶可見）"
              hint="請提供方便聯繫的方式。此資訊只有登入用戶才能看到。"
            />
          </AnimatedCard>

          <AnimatedCard title="預覽" subtitle="發布前確認資訊" delay={100}>
            <View
              style={{
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Pill text={type === "lost" ? "遺失" : "拾獲"} kind={type === "lost" ? "accent" : "default"} />
                {category && <Pill text={CATEGORY_INFO[category].label} />}
              </View>
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
                {title || "(尚未填寫標題)"}
              </Text>
              <Text style={{ color: theme.colors.muted, marginTop: 8, lineHeight: 20 }} numberOfLines={3}>
                {description || "(尚未填寫描述)"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    {finalLocation || "(未選擇)"}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="calendar-outline" size={14} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{dateStr}</Text>
                </View>
              </View>
            </View>
          </AnimatedCard>

          <View style={{ gap: 12, marginTop: 20 }}>
            <Button
              text={submitting ? "發布中..." : isEditing ? "更新" : "發布"}
              kind="primary"
              onPress={handleSubmit}
              disabled={!isValid || submitting}
            />
            <Button text="取消" onPress={() => nav?.goBack?.()} disabled={submitting} />
          </View>

          <View style={{ marginTop: 20, padding: 14, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              發布說明：{"\n"}
              • 請如實描述物品，勿發布虛假資訊{"\n"}
              • 刊登資訊將在 30 天後自動下架{"\n"}
              • 如物品已找回，請記得更新狀態{"\n"}
              • 交接物品時請在公共場所進行
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
