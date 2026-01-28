import React from "react";
import { SafeAreaView, ScrollView, Text, View, Pressable } from "react-native";
import {
  mockAnnouncements,
  mockCourses,
  mockPois,
  mockClubEvents,
  mockMenus,
} from "@campus/shared/src/mockData";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>畢業專題｜校園應用（Mobile）</Text>
        <Text style={{ opacity: 0.7 }}>
          目前是骨架（假資料）。之後會接 Firebase + 學校 SSO。
        </Text>

        <Section title="公告">
          {mockAnnouncements.map((a) => (
            <Card key={a.id} title={a.title} subtitle={a.publishedAt} body={a.body} />
          ))}
        </Section>

        <Section title="課表">
          {mockCourses.map((c) => (
            <Text key={c.id}>
              {c.name}｜週{c.dayOfWeek} {c.startTime}-{c.endTime}｜{c.location}
            </Text>
          ))}
        </Section>

        <Section title="校園地圖（先用點位列表代替）">
          {mockPois.map((p) => (
            <Text key={p.id}>
              {p.name} ({p.lat}, {p.lng})
            </Text>
          ))}
        </Section>

        <Section title="社團活動">
          {mockClubEvents.map((e) => (
            <View key={e.id} style={{ gap: 6 }}>
              <Text style={{ fontWeight: "700" }}>{e.title}</Text>
              <Text style={{ opacity: 0.7, fontSize: 12 }}>
                {e.startsAt} ~ {e.endsAt}
              </Text>
              <Text>{e.location}</Text>
              <Text>{e.description}</Text>
              <Pressable style={{ padding: 10, backgroundColor: "#eee", borderRadius: 8 }} disabled>
                <Text>報名（待接後端）</Text>
              </Pressable>
            </View>
          ))}
        </Section>

        <Section title="餐廳">
          {mockMenus.map((m) => (
            <Text key={m.id}>
              {m.availableOn}｜{m.cafeteria}｜{m.name}（{m.price ?? "-"}）
            </Text>
          ))}
        </Section>

        <Section title="登入（SSO placeholder）">
          <Pressable style={{ padding: 10, backgroundColor: "#eee", borderRadius: 8 }} disabled>
            <Text>用學校帳號登入（待接 SSO）</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>{props.title}</Text>
      {props.children}
    </View>
  );
}

function Card(props: { title: string; subtitle?: string; body: string }) {
  return (
    <View style={{ padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 10, gap: 6 }}>
      <Text style={{ fontWeight: "700" }}>{props.title}</Text>
      {!!props.subtitle && <Text style={{ opacity: 0.6, fontSize: 12 }}>{props.subtitle}</Text>}
      <Text>{props.body}</Text>
    </View>
  );
}
