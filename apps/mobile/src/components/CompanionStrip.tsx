/* eslint-disable */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import type { CompanionPublicSnapshot } from '../services/companionEngine';

export function CompanionStrip(props: {
  snapshot: CompanionPublicSnapshot;
  onPressExpand: () => void;
}) {
  const { snapshot, onPressExpand } = props;

  return (
    <Pressable
      testID="companion-strip-today"
      onPress={onPressExpand}
      style={({ pressed }) => ({
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.md,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: `${theme.colors.accent}33`,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: `${theme.colors.accent}18`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="happy-outline" size={26} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>
            {snapshot.petStageTitle}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {snapshot.dailyProgressText} · 心情 {snapshot.moodLabel}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }} numberOfLines={2}>
            {snapshot.quote}
          </Text>
        </View>
        <Ionicons name="leaf-outline" size={22} color={theme.colors.success} />
      </View>
      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 8 }}>
        花圃：{snapshot.cropStageLabel} · 成長 {snapshot.cropGrowth}% · 點進『校園園地』看詳情
      </Text>
    </Pressable>
  );
}
