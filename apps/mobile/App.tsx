import React, { useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  View,
  TextInput,
  Pressable,
} from "react-native";
import {
  mockAnnouncements,
  mockCourses,
  mockPois,
  mockClubEvents,
  mockMenus,
} from "@campus/shared/src/mockData";
import {
  findSchoolsByCode,
  mockSchools,
  normalizeSchoolCode,
  resolveSchool,
} from "@campus/shared/src/schools";

export default function App() {
  const [codeInput, setCodeInput] = useState("NCHU");
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeSchoolCode(codeInput), [codeInput]);
  const matches = useMemo(() => findSchoolsByCode(normalized), [normalized]);

  const school = useMemo(
    () => resolveSchool({ school: normalized, schoolId: selectedSchoolId }),
    [normalized, selectedSchoolId]
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>畢業專題｜校園應用（Mobile）</Text>
        <Text style={{ opacity: 0.7 }}>
          平台型多校通用：用「學校縮寫代碼」加入。代碼可能撞碼，因此會請你選正確學校。
        </Text>

        <Section title="加入學校（代碼）">
          <Text style={{ marginBottom: 6, opacity: 0.85 }}>
            目前：{school.name}（{school.code}）
          </Text>

          <TextInput
            value={codeInput}
            onChangeText={(t) => {
              setCodeInput(t);
              setSelectedSchoolId(null); // reset explicit selection when code changes
            }}
            autoCapitalize="characters"
            placeholder="例如 NCHU"
            style={{ padding: 10, borderWidth: 1, borderColor: "#ddd", borderRadius: 10 }}
          />

          {normalized.length > 0 && matches.length === 0 && (
            <Text style={{ marginTop: 8, opacity: 0.7 }}>找不到此代碼（可先用 DEMO 測試）</Text>
          )}

          {normalized.length > 0 && matches.length === 1 && (
            <Pressable
              style={{ marginTop: 10, padding: 10, backgroundColor: "#eee", borderRadius: 10 }}
              onPress={() => setSelectedSchoolId(matches[0].id)}
            >
              <Text>加入：{matches[0].name}</Text>
            </Pressable>
          )}

          {normalized.length > 0 && matches.length > 1 && (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={{ fontWeight: "700" }}>此代碼有多所學校，請選一個：</Text>
              {matches.map((s) => (
                <Pressable
                  key={s.id}
                  style={{ padding: 10, backgroundColor: "#eee", borderRadius: 10 }}
                  onPress={() => setSelectedSchoolId(s.id)}
                >
                  <Text>{s.name}</Text>
                  <Text style={{ opacity: 0.6, fontSize: 12 }}>code: {s.code} ｜ id: {s.id}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={{ marginTop: 10, opacity: 0.7 }}>
            示範代碼：{mockSchools.map((s) => s.code).join(" / ")}
          </Text>
        </Section>

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
