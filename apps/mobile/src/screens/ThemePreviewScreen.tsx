import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIDetailScreen, AICard } from '../ui/aiFirst';
import { useThemeMode } from '../state/theme';
import type { ThemeMode } from '../ui/theme';

type Props = { navigation?: { goBack?: () => void } };
const modes: Array<{ key: ThemeMode; label: string; description: string }> = [
  { key: 'light', label: '淺色', description: '紙白底色與墨綠文字，適合日間閱讀。' },
  { key: 'dark', label: '深色', description: '降低畫面亮度，適合光線較暗的環境。' },
];

export function ThemePreviewScreen({ navigation }: Props) {
  const { theme, mode, setMode } = useThemeMode();
  return (
    <AIDetailScreen
      title="外觀"
      subtitle="選擇適合你的閱讀方式。"
      onBack={() => navigation?.goBack?.()}
    >
      <AICard title="介面主題">
        <View style={{ gap: theme.space.sm }}>
          {modes.map((option) => {
            const selected = option.key === mode;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                onPress={() => setMode(option.key)}
                style={({ pressed }) => ({
                  minHeight: 72,
                  padding: theme.layout.cardPadding,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surface,
                  opacity: pressed ? 0.75 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.md,
                })}
              >
                <Ionicons
                  name={option.key === 'light' ? 'sunny-outline' : 'moon-outline'}
                  size={24}
                  color={theme.colors.accent}
                />
                <View style={{ flex: 1, gap: theme.space.xs }}>
                  <Text
                    style={{
                      ...theme.typography.body,
                      color: theme.colors.text,
                      fontWeight: '600',
                    }}
                  >
                    {option.label}
                  </Text>
                  <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                    {option.description}
                  </Text>
                </View>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={selected ? theme.colors.accent : theme.colors.muted}
                />
              </Pressable>
            );
          })}
          <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
            選擇後會立即套用，並保留在這台裝置。
          </Text>
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
