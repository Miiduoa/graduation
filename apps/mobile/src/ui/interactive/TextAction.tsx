import React from 'react';
import { Pressable, Text } from 'react-native';
import { theme } from '../theme';
import { useThemeVersion } from '../useThemeStyleSheet';

export function TextAction({
  label,
  onPress,
  accessibilityLabel = label,
  accessibilityRole = 'button',
  tone = 'accent',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  tone?: 'accent' | 'neutral' | 'danger';
  disabled?: boolean;
}) {
  useThemeVersion();
  const color = tone === 'neutral' ? theme.colors.textSecondary : theme.colors[tone];
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
