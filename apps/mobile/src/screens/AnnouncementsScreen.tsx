import React from "react";
import { ScrollView, Text, View } from "react-native";
import { mockAnnouncements } from "@campus/shared/src/mockData";
import { Screen, Card, Pill } from "../ui/components";
import { theme } from "../ui/theme";

export function AnnouncementsScreen() {
  return (
    <Screen title="公告" subtitle="重要通知一眼看懂：卡片式資訊 + 清楚時間。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        {mockAnnouncements.map((a) => (
          <Card
            key={a.id}
            title={a.title}
            subtitle={new Date(a.publishedAt).toLocaleString() + (a.source ? `｜${a.source}` : "")}
          >
            <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{a.body}</Text>
            <View style={{ marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pill text="可接 Firebase" kind="accent" />
              <Pill text="可做 AI 摘要" />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
