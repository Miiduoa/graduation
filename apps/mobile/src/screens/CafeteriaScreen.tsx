import React from "react";
import { ScrollView } from "react-native";
import { mockMenus } from "@campus/shared/src/mockData";
import { Screen, Card, Pill } from "../ui/components";

export function CafeteriaScreen() {
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
