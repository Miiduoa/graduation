import React, { useMemo } from "react";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { calculateCredits } from "@campus/shared/src/creditAudit";
import { demoEnrollments, mockCourses, mockGradRuleTemplateV1 } from "@campus/shared/src/mockData";

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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#eaf0ff" }}>學分試算</Text>
        <Text style={{ color: "rgba(234,240,255,0.72)" }}>
          目前用示範課程與修課紀錄。之後會加：手動輸入、CSV 匯入、以及 Firebase 同步。
        </Text>

        <Card title="總學分">
          <Row label="已修" value={`${res.total.earned}`} />
          <Row label="門檻" value={`${res.total.required}`} />
          <Row label="尚缺" value={`${res.total.remaining}`} />
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
            return (
              <View key={k} style={{ marginBottom: 10 }}>
                <Text style={{ color: "#eaf0ff", fontWeight: "800" }}>{label}</Text>
                <Text style={{ color: "rgba(234,240,255,0.72)", marginTop: 2 }}>
                  已修 {b.earned} / 需求 {b.required}（尚缺 {b.remaining}）
                </Text>
                <ProgressBar value={b.earned} max={b.required} />
              </View>
            );
          })}
        </Card>

        <Card title="狀態">
          <Text style={{ color: res.satisfied ? "#6ee7ff" : "rgba(234,240,255,0.85)", fontWeight: "800" }}>
            {res.satisfied ? "已達畢業門檻" : "尚未達畢業門檻"}
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(234,240,255,0.14)",
        backgroundColor: "rgba(255,255,255,0.06)",
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "800", color: "#eaf0ff" }}>{props.title}</Text>
      {props.children}
    </View>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: "rgba(234,240,255,0.72)" }}>{props.label}</Text>
      <Text style={{ color: "#eaf0ff", fontWeight: "800" }}>{props.value}</Text>
    </View>
  );
}

function ProgressBar(props: { value: number; max: number }) {
  const pct = props.max <= 0 ? 1 : Math.max(0, Math.min(1, props.value / props.max));
  return (
    <View
      style={{
        marginTop: 8,
        height: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.10)",
        borderWidth: 1,
        borderColor: "rgba(234,240,255,0.14)",
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: 10,
          width: `${Math.round(pct * 100)}%`,
          backgroundColor: "rgba(110,231,255,0.55)",
        }}
      />
    </View>
  );
}
