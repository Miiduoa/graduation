import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIDetailScreen, AICard } from '../ui/aiFirst';
import { useTheme } from '../state/theme';
import { useI18n, LANGUAGE_OPTIONS } from '../i18n';

type Props = { navigation?: { goBack?: () => void } };

export function LanguageSettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const { language, setLanguage, t } = useI18n();
  return (
    <AIDetailScreen title={t.settings.language} onBack={() => navigation?.goBack?.()}>
      <AICard title="介面語言">
        <View style={{ gap: theme.space.sm }}>
          {LANGUAGE_OPTIONS.map((option) => {
            const selected = language === option.code;
            return (
              <Pressable
                key={option.code}
                onPress={() => void setLanguage(option.code)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                accessibilityLabel={option.nativeName}
                style={({ pressed }) => ({
                  minHeight: 56,
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
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      ...theme.typography.body,
                      color: theme.colors.text,
                      fontWeight: selected ? '600' : '400',
                    }}
                  >
                    {option.nativeName}
                  </Text>
                  {option.nativeName !== option.name ? (
                    <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                      {option.name}
                    </Text>
                  ) : null}
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </AICard>
      <AICard title="翻譯範圍">
        <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
          選擇會套用至已提供翻譯的介面。尚未翻譯的頁面仍會顯示繁體中文；課程、公告與活動內容維持發布時的語言。
        </Text>
      </AICard>
    </AIDetailScreen>
  );
}
