import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { mockAnnouncements } from "@campus/shared/src/mockData";
import { Screen, Card, Pill } from "../ui/components";
import { theme } from "../ui/theme";

export function AnnouncementDetailScreen(props: any) {
  const id: string | undefined = props?.route?.params?.id;

  const item = useMemo(() => {
    return mockAnnouncements.find((a) => a.id === id) ?? mockAnnouncements[0];
  }, [id]);

  return (
    <Screen title="公告詳情" subtitle="(MVP) 之後接 Firebase 就能看完整公告內容。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        <Card title={item.title} subtitle={`${new Date(item.publishedAt).toLocaleString()}${item.source ? `｜${item.source}` : ""}`}>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Pill text="公告" kind="accent" />
            <Pill text="AI 摘要（待接）" />
          </View>
          <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{item.body}</Text>
        </Card>

        <Card title="AI（下一步）" subtitle="先做可用流程，再加 AI。">
          <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
            這裡之後會加：一鍵摘要、重點日期擷取、與相關公告/課程推薦。
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
