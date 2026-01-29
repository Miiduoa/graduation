import React, { useMemo, useState } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text, View, TextInput, ScrollView } from "react-native";

import { CreditAuditScreen } from "./src/screens/CreditAuditScreen";
import { Screen, Card, Button, Pill } from "./src/ui/components";
import { theme } from "./src/ui/theme";

import { mockAnnouncements, mockClubEvents, mockMenus, mockPois } from "@campus/shared/src/mockData";
import { findSchoolsByCode, mockSchools, normalizeSchoolCode, resolveSchool } from "@campus/shared/src/schools";

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.bg,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.accent,
  },
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTitleStyle: { color: theme.colors.text, fontWeight: "700" },
          tabBarStyle: { backgroundColor: theme.colors.bg, borderTopColor: theme.colors.border },
          tabBarActiveTintColor: theme.colors.accent,
          tabBarInactiveTintColor: theme.colors.muted,
        }}
      >
        <Tab.Screen name="公告" component={AnnouncementsScreen} />
        <Tab.Screen name="活動" component={EventsScreen} />
        <Tab.Screen name="地圖" component={MapScreen} />
        <Tab.Screen name="餐廳" component={CafeteriaScreen} />
        <Tab.Screen name="我的" component={MeScreen} />
        <Tab.Screen name="試算" component={CreditAuditScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function AnnouncementsScreen() {
  return (
    <Screen title="公告" subtitle="重要通知一眼看懂：卡片式資訊 + 清楚時間。"></Screen>
  );
}

function EventsScreen() {
  return (
    <Screen title="活動" subtitle="社團活動與報名（後續接 Firebase）。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        {mockClubEvents.map((e) => (
          <Card key={e.id} title={e.title} subtitle={`${e.startsAt} ~ ${e.endsAt}`}>
            <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{e.description}</Text>
            <View style={{ marginTop: 8 }}>
              <Button text="報名（待接後端）" disabled />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

function MapScreen() {
  return (
    <Screen title="地圖" subtitle="先做點位列表，之後再上地圖元件。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        {mockPois.map((p) => (
          <Card key={p.id} title={p.name} subtitle={`${p.lat}, ${p.lng}`}>
            <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>{p.description}</Text>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

function CafeteriaScreen() {
  return (
    <Screen title="餐廳" subtitle="菜單與營業資訊（後續接 Firebase）。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        {mockMenus.map((m) => (
          <Card key={m.id} title={m.name} subtitle={`${m.availableOn}｜${m.cafeteria}`}>
            <Pill text={`$${m.price ?? "-"}`} kind="accent" />
          </Card>
        ))}
      </ScrollView>
    </Screen>
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
    <Screen title="我的" subtitle="學校、登入、個人設定集中在這裡。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        <Card title="目前學校" subtitle={`${school.name}（${school.code}）`}>
          <Pill text={`schoolId: ${school.id}`} />
        </Card>

        <Card title="加入/切換學校" subtitle="輸入縮寫代碼；若撞碼，會列出清單讓你選。">
          <Text style={{ color: theme.colors.muted }}>學校代碼（A-Z0-9，3~10碼）</Text>
          <TextInput
            value={codeInput}
            onChangeText={(t) => {
              setCodeInput(t);
              setSelectedSchoolId(null);
            }}
            autoCapitalize="characters"
            placeholder="例如 NCHU"
            placeholderTextColor="rgba(168,176,194,0.6)"
            style={{
              marginTop: 10,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: "rgba(255,255,255,0.04)",
              color: theme.colors.text,
            }}
          />

          {normalized.length > 0 && matches.length === 0 ? (
            <View style={{ marginTop: 10 }}>
              <Pill text="找不到此代碼（可先用 DEMO 測試）" />
            </View>
          ) : null}

          {normalized.length > 0 && matches.length === 1 ? (
            <View style={{ marginTop: 10 }}>
              <Button text={`加入：${matches[0].name}`} kind="primary" onPress={() => setSelectedSchoolId(matches[0].id)} />
            </View>
          ) : null}

          {normalized.length > 0 && matches.length > 1 ? (
            <View style={{ marginTop: 12, gap: 10 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800" }}>此代碼有多所學校，請選一個：</Text>
              {matches.map((s) => (
                <Button key={s.id} text={s.name} onPress={() => setSelectedSchoolId(s.id)} />
              ))}
            </View>
          ) : null}

          <View style={{ marginTop: 10 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              示範代碼：{mockSchools.map((s) => s.code).join(" / ")}
            </Text>
          </View>
        </Card>

        <Card title="登入（SSO placeholder）" subtitle="後續接 Firebase Auth + 各校 SSO（OIDC/SAML/CAS）。">
          <Button text="用學校帳號登入（待接）" disabled />
        </Card>
      </ScrollView>
    </Screen>
  );
}
