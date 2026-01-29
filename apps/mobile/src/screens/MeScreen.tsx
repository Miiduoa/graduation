import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { findSchoolsByCode, mockSchools, normalizeSchoolCode, resolveSchool } from "@campus/shared/src/schools";
import { Screen, Card, Button, Pill } from "../ui/components";
import { theme } from "../ui/theme";

export function MeScreen() {
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
