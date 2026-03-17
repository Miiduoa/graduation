import React from "react";
import { ScrollView, View, Text, StyleSheet } from "react-native";
import { Screen, Card, Button, Pill, Badge, SectionTitle, AnimatedCard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { useTheme } from "../state/theme";
import { useSchool } from "../state/school";
import { mockSchools } from "@campus/shared/src/schools";

export function ThemePreviewScreen() {
  const theme = useTheme();
  const { school } = useSchool();

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <AnimatedCard title="目前主題" subtitle={`${school.name} · ${theme.mode === "dark" ? "深色" : "淺色"}模式`}>
          <View style={styles.colorGrid}>
            <ColorSwatch label="主色" color={theme.colors.accent} />
            <ColorSwatch label="主色柔" color={theme.colors.accentSoft} />
            <ColorSwatch label="背景" color={theme.colors.background} />
            <ColorSwatch label="表面" color={theme.colors.surface} />
            <ColorSwatch label="表面2" color={theme.colors.surface2} />
            <ColorSwatch label="文字" color={theme.colors.text} />
            <ColorSwatch label="次文字" color={theme.colors.textSecondary} />
            <ColorSwatch label="邊框" color={theme.colors.border} />
            <ColorSwatch label="成功" color={theme.colors.success} />
            <ColorSwatch label="警告" color={theme.colors.warning} />
            <ColorSwatch label="錯誤" color={theme.colors.error} />
            <ColorSwatch label="資訊" color={theme.colors.info} />
          </View>
        </AnimatedCard>

        <AnimatedCard title="元件預覽" subtitle="查看主題在不同元件上的效果" delay={100}>
          <View style={{ gap: 16 }}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>按鈕</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button text="主要按鈕" kind="primary" />
                <Button text="次要按鈕" kind="outline" />
                <Button text="一般按鈕" />
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>標籤</Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pill text="標籤" />
                <Badge text="徽章" />
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>卡片</Text>
              <Card>
                <View style={{ padding: 16 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>範例卡片</Text>
                  <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>
                    這是一個範例卡片，展示在當前主題下的樣式效果。
                  </Text>
                </View>
              </Card>
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="可用學校主題" subtitle="各學校的品牌色" delay={200}>
          <View style={{ gap: 12 }}>
            {mockSchools.map((s) => (
              <View 
                key={s.id} 
                style={[
                  styles.schoolItem,
                  { 
                    backgroundColor: theme.colors.surface2,
                    borderColor: s.id === school.id ? theme.colors.accent : "transparent",
                    borderWidth: s.id === school.id ? 2 : 0,
                  }
                ]}
              >
                <View style={[styles.schoolColor, { backgroundColor: s.themeColor || theme.colors.accent }]}>
                  <Text style={styles.schoolInitial}>{s.name.charAt(0)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{s.name}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    {s.code} · {s.themeColor || "預設主題色"}
                  </Text>
                </View>
                {s.id === school.id && (
                  <View style={[styles.currentBadge, { backgroundColor: theme.colors.accent }]}>
                    <Text style={styles.currentBadgeText}>目前</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </AnimatedCard>

        <AnimatedCard title="主題資訊" subtitle="技術細節" delay={300}>
          <View style={{ gap: 8 }}>
            <InfoRow label="模式" value={theme.mode} />
            <InfoRow label="學校 ID" value={theme.schoolId || "無"} />
            <InfoRow label="主色 HEX" value={theme.colors.accent} />
            <InfoRow label="品牌主色" value={theme.brand?.primary || "無"} />
            <InfoRow label="品牌次色" value={theme.brand?.secondary || "無"} />
          </View>
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}

function ColorSwatch({ label, color }: { label: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={styles.swatch}>
      <View style={[styles.swatchColor, { backgroundColor: color }]} />
      <Text style={[styles.swatchLabel, { color: theme.colors.muted }]}>{label}</Text>
      <Text style={[styles.swatchValue, { color: theme.colors.textSecondary }]}>{color}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 13, fontFamily: "monospace" }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  colorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  swatch: {
    width: 80,
    alignItems: "center",
    gap: 4,
  },
  swatchColor: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  swatchLabel: {
    fontSize: 10,
  },
  swatchValue: {
    fontSize: 8,
    fontFamily: "monospace",
  },
  schoolItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  schoolColor: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  schoolInitial: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  currentBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
});
