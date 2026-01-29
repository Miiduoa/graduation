import React, { useMemo, useState } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaView, ScrollView, Text, View, TextInput, Pressable } from "react-native";
import {
  mockAnnouncements,
  mockClubEvents,
  mockMenus,
  mockPois,
} from "@campus/shared/src/mockData";
import {
  findSchoolsByCode,
  mockSchools,
  normalizeSchoolCode,
  resolveSchool,
} from "@campus/shared/src/schools";

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#0b1220",
    card: "#101a33",
    text: "#eaf0ff",
    border: "rgba(234,240,255,0.14)",
    primary: "#6ee7ff",
  },
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#101a33" },
          headerTitleStyle: { color: "#eaf0ff", fontWeight: "700" },
          tabBarStyle: { backgroundColor: "#0f1830", borderTopColor: "rgba(234,240,255,0.14)" },
          tabBarActiveTintColor: "#6ee7ff",
          tabBarInactiveTintColor: "rgba(234,240,255,0.65)",
        }}
      >
        <Tab.Screen name="公告" component={AnnouncementsScreen} />
        <Tab.Screen name="活動" component={EventsScreen} />
        <Tab.Screen name="地圖" component={MapScreen} />
        <Tab.Screen name="餐廳" component={CafeteriaScreen} />
        <Tab.Screen name="我的" component={MeScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function ScreenShell(props: { title?: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {props.title ? (
          <Text style={{ fontSize: 18, fontWeight: "800", color: "#eaf0ff" }}>{props.title}</Text>
        ) : null}
        {props.children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Card(props: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(234,240,255,0.14)",
        backgroundColor: "rgba(255,255,255,0.06)",
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "800", color: "#eaf0ff" }}>{props.title}</Text>
      {props.subtitle ? <Text style={{ color: "rgba(234,240,255,0.72)" }}>{props.subtitle}</Text> : null}
      {props.children}
    </View>
  );
}

function AnnouncementsScreen() {
  return (
    <ScreenShell title="公告">
      {mockAnnouncements.map((a) => (
        <Card key={a.id} title={a.title} subtitle={new Date(a.publishedAt).toLocaleString()}>
          <Text style={{ color: "rgba(234,240,255,0.85)", lineHeight: 20 }}>{a.body}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}

function EventsScreen() {
  return (
    <ScreenShell title="社團活動">
      {mockClubEvents.map((e) => (
        <Card key={e.id} title={e.title} subtitle={`${e.startsAt} ~ ${e.endsAt}`}>
          <Text style={{ color: "rgba(234,240,255,0.85)", lineHeight: 20 }}>{e.description}</Text>
          <Pressable
            disabled
            style={{
              marginTop: 6,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: "rgba(255,255,255,0.10)",
              borderWidth: 1,
              borderColor: "rgba(234,240,255,0.14)",
            }}
          >
            <Text style={{ color: "rgba(234,240,255,0.75)", fontWeight: "700" }}>報名（待接後端）</Text>
          </Pressable>
        </Card>
      ))}
    </ScreenShell>
  );
}

function MapScreen() {
  return (
    <ScreenShell title="校園地圖（點位）">
      {mockPois.map((p) => (
        <Card key={p.id} title={p.name} subtitle={`${p.lat}, ${p.lng}`}>
          <Text style={{ color: "rgba(234,240,255,0.85)", lineHeight: 20 }}>{p.description}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}

function CafeteriaScreen() {
  return (
    <ScreenShell title="餐廳/菜單">
      {mockMenus.map((m) => (
        <Card key={m.id} title={m.name} subtitle={`${m.availableOn}｜${m.cafeteria}｜$${m.price ?? "-"}`} />
      ))}
    </ScreenShell>
  );
}

function MeScreen() {
  const [codeInput, setCodeInput] = useState("NCHU");
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeSchoolCode(codeInput), [codeInput]);
  const matches = useMemo(() => findSchoolsByCode(normalized), [normalized]);
  const school = useMemo(
    () => resolveSchool({ school: normalized, schoolId: selectedSchoolId }),
    [normalized, selectedSchoolId]
  );

  return (
    <ScreenShell title="我的">
      <Card title="目前學校" subtitle={`${school.name}（${school.code}）`}>
        <Text style={{ color: "rgba(234,240,255,0.72)" }}>
          用學校縮寫代碼加入。若代碼撞碼，會列出清單讓你選。
        </Text>
      </Card>

      <Card title="加入/切換學校">
        <Text style={{ color: "rgba(234,240,255,0.72)" }}>學校代碼（A-Z0-9，3~10碼）</Text>
        <TextInput
          value={codeInput}
          onChangeText={(t) => {
            setCodeInput(t);
            setSelectedSchoolId(null);
          }}
          autoCapitalize="characters"
          placeholder="例如 NCHU"
          placeholderTextColor="rgba(234,240,255,0.35)"
          style={{
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "rgba(234,240,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.06)",
            color: "#eaf0ff",
          }}
        />

        {normalized.length > 0 && matches.length === 0 ? (
          <Text style={{ marginTop: 8, color: "rgba(234,240,255,0.72)" }}>找不到此代碼（可先用 DEMO 測試）</Text>
        ) : null}

        {normalized.length > 0 && matches.length === 1 ? (
          <Pressable
            style={{
              marginTop: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: "rgba(110,231,255,0.14)",
              borderWidth: 1,
              borderColor: "rgba(110,231,255,0.35)",
            }}
            onPress={() => setSelectedSchoolId(matches[0].id)}
          >
            <Text style={{ color: "#eaf0ff", fontWeight: "800" }}>加入：{matches[0].name}</Text>
          </Pressable>
        ) : null}

        {normalized.length > 0 && matches.length > 1 ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <Text style={{ color: "#eaf0ff", fontWeight: "800" }}>此代碼有多所學校，請選一個：</Text>
            {matches.map((s) => (
              <Pressable
                key={s.id}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: "rgba(255,255,255,0.10)",
                  borderWidth: 1,
                  borderColor: "rgba(234,240,255,0.14)",
                }}
                onPress={() => setSelectedSchoolId(s.id)}
              >
                <Text style={{ color: "#eaf0ff", fontWeight: "800" }}>{s.name}</Text>
                <Text style={{ color: "rgba(234,240,255,0.65)", marginTop: 3 }}>code: {s.code} ｜ id: {s.id}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={{ marginTop: 10, color: "rgba(234,240,255,0.65)" }}>
          示範代碼：{mockSchools.map((s) => s.code).join(" / ")}
        </Text>
      </Card>

      <Card title="登入（SSO placeholder）" subtitle="之後接 Firebase Auth + 各校 SSO（OIDC/SAML/CAS）">
        <Pressable
          disabled
          style={{
            marginTop: 6,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: "rgba(255,255,255,0.10)",
            borderWidth: 1,
            borderColor: "rgba(234,240,255,0.14)",
          }}
        >
          <Text style={{ color: "rgba(234,240,255,0.75)", fontWeight: "700" }}>用學校帳號登入（待接）</Text>
        </Pressable>
      </Card>
    </ScreenShell>
  );
}
