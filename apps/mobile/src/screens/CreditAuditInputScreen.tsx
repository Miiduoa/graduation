import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Screen, Card, Button, Pill } from "../ui/components";
import { theme } from "../ui/theme";
import { calculateCredits, type CreditCategory } from "@campus/shared/src/creditAudit";
import { mockGradRuleTemplateV1, mockCourses, demoEnrollments } from "@campus/shared/src/mockData";

const categories: Array<{ key: CreditCategory; label: string }> = [
  { key: "required", label: "必修" },
  { key: "elective", label: "選修" },
  { key: "general", label: "通識" },
  { key: "english", label: "英文" },
  { key: "other", label: "其他" },
];

export function CreditAuditInputScreen(props: any) {
  const onAdded: ((x: any) => void) | undefined = props?.route?.params?.onAdded;

  const [name, setName] = useState("");
  const [credits, setCredits] = useState("3");
  const [category, setCategory] = useState<CreditCategory>("elective");
  const [passed, setPassed] = useState(true);

  const preview = useMemo(() => {
    const id = `manual-${Date.now()}`;
    const course = { id, departmentId: "dept-demo-cs", name: name || "（未命名課程）", credits: Number(credits) || 0, category };
    const coursesById = Object.fromEntries([...mockCourses, course].map((c) => [c.id, c]));
    const enrollments = [...demoEnrollments, { id: `en-${id}`, uid: "demo", courseId: id, status: "completed", passed }];
    return calculateCredits({ template: mockGradRuleTemplateV1, coursesById, enrollments });
  }, [name, credits, category, passed]);

  return (
    <Screen title="新增修課" subtitle="先手動輸入一筆，下一步再做 CSV 匯入與 Firebase 同步。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        <Card title="課程資訊">
          <Text style={{ color: theme.colors.muted }}>課程名稱</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例如：資料庫系統"
            placeholderTextColor="rgba(168,176,194,0.6)"
            style={{
              marginTop: 8,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: "rgba(255,255,255,0.04)",
              color: theme.colors.text,
            }}
          />

          <View style={{ height: 10 }} />

          <Text style={{ color: theme.colors.muted }}>學分</Text>
          <TextInput
            value={credits}
            onChangeText={setCredits}
            keyboardType="number-pad"
            style={{
              marginTop: 8,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: "rgba(255,255,255,0.04)",
              color: theme.colors.text,
            }}
          />

          <View style={{ height: 10 }} />

          <Text style={{ color: theme.colors.muted }}>分類</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {categories.map((c) => (
              <View key={c.key}>
                <Button
                  text={c.label}
                  kind={category === c.key ? "primary" : "secondary"}
                  onPress={() => setCategory(c.key)}
                />
              </View>
            ))}
          </View>

          <View style={{ height: 10 }} />

          <Text style={{ color: theme.colors.muted }}>是否通過</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button text="通過" kind={passed ? "primary" : "secondary"} onPress={() => setPassed(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button text="未通過" kind={!passed ? "primary" : "secondary"} onPress={() => setPassed(false)} />
            </View>
          </View>

          <View style={{ marginTop: 12 }}>
            <Button
              text="新增並返回"
              kind="primary"
              onPress={() => {
                onAdded?.({ name, credits: Number(credits) || 0, category, passed });
                props?.navigation?.goBack?.();
              }}
            />
          </View>
        </Card>

        <Card title="即時試算預覽" subtitle="加入這門課後，總學分/分類進度的變化。">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted }}>總學分</Text>
            <Pill text={`${preview.total.earned}/${preview.total.required}（缺 ${preview.total.remaining}）`} kind="accent" />
          </View>
          <Text style={{ color: theme.colors.muted, marginTop: 8 }}>
            提示：這裡目前只是 demo 版，下一步會把你的新增資料存到本地/Firestore。
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
