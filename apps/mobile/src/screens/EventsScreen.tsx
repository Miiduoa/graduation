import React from "react";
import { ScrollView, Text, View } from "react-native";
import { mockClubEvents } from "@campus/shared/src/mockData";
import { Screen, Card, Button, Pill } from "../ui/components";
import { theme } from "../ui/theme";

export function EventsScreen() {
  return (
    <Screen title="活動" subtitle="社團活動與報名（後續接 Firebase）。">
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }}>
        {mockClubEvents.map((e) => (
          <Card key={e.id} title={e.title} subtitle={`${e.startsAt} ~ ${e.endsAt}` + (e.location ? `｜${e.location}` : "")}>
            <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{e.description}</Text>
            <View style={{ marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {e.capacity ? <Pill text={`名額 ${e.capacity}`} kind="accent" /> : <Pill text="名額待定" />}
            </View>
            <View style={{ marginTop: 10 }}>
              <Button text="報名（待接後端）" disabled />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
