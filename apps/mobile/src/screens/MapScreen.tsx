import React from "react";
import { ScrollView, Text } from "react-native";
import { mockPois } from "@campus/shared/src/mockData";
import { Screen, Card, Pill } from "../ui/components";
import { theme } from "../ui/theme";

export function MapScreen() {
  return (
    <Screen title="地圖" subtitle="先做點位列表，之後再上地圖元件（Mapbox/Google Maps）。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        {mockPois.map((p) => (
          <Card key={p.id} title={p.name} subtitle={`${p.lat}, ${p.lng}`}>
            <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>{p.description}</Text>
            <Pill text={p.category} kind="accent" />
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
