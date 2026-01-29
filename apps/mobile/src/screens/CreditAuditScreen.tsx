import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { calculateCredits } from "@campus/shared/src/creditAudit";
import { demoEnrollments, mockCourses, mockGradRuleTemplateV1 } from "@campus/shared/src/mockData";
import { Screen, Card, Pill } from "../ui/components";
import { theme } from "../ui/theme";

export function CreditAuditScreen() {
  const res = useMemo(() => {
    const coursesById = Object.fromEntries(mockCourses.map((c) => [c.id, c]));
    return calculateCredits({
      template: mockGradRuleTemplateV1,
      coursesById,
      enrollments: demoEnrollments,
    });
  }, []);

  return (
    <Screen title="學分試算" subtitle="先用示範資料跑通；之後加手動輸入、CSV 匯入與 Firebase 同步。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        <Card title="總學分">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted }}>進度</Text>
            <Pill text={res.satisfied ? "已達畢業門檻" : "尚未達畢業門檻"} kind="accent" />
          </View>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 28, marginTop: 4 }}>
            {res.total.earned}
            <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 16 }}> / {res.total.required}</Text>
          </Text>
          <Text style={{ color: theme.colors.muted, marginTop: 2 }}>尚缺 {res.total.remaining} 學分</Text>
        </Card>

        <Card title="分類進度">
          {(
            [
              ["required", "必修"],
              ["elective", "選修"],
              ["general", "通識"],
              ["english", "英文"],
              ["other", "其他必備"],
            ] as const
          ).map(([k, label]) => {
            const b = res.byCategory[k];
            const pct = b.required <= 0 ? 1 : Math.max(0, Math.min(1, b.earned / b.required));

            return (
              <View key={k} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "800" }}>{label}</Text>
                  <Text style={{ color: theme.colors.muted }}>
                    {b.earned}/{b.required}（缺 {b.remaining}）
                  </Text>
                </View>
                <View
                  style={{
                    marginTop: 8,
                    height: 10,
                    borderRadius: 999,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 10,
                      width: `${Math.round(pct * 100)}%`,
                      backgroundColor: theme.colors.accent,
                      opacity: 0.55,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </Card>

        <Card title="下一步（之後會接 AI）" subtitle="AI 會根據缺口，建議你下學期該補哪些分類與課程。">
          <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
            目前先把計算邏輯與 UI 跑通。下一步會做：手動新增修課、CSV 匯入、與 Firebase 同步。
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
