import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { safeNavigate } from '../utils/safeNavigate';
import { calendarScopes, calendarScopeDestination } from '../features/calendarScope';
import { PersonalImportSummary } from '../components/PersonalImportSummary';
import { CalendarPanel } from './unifiedCalendar/CalendarPanel';

type CalendarScreenProps = {
  navigation?: Parameters<typeof safeNavigate>[0];
};

export function UnifiedCalendarScreen(props: CalendarScreenProps) {
  useThemeMode();
  const styles = useThemeStyleSheet(createStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <CalendarPanel
        {...props}
        header={
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              校園行事曆
            </Text>
            <Text style={styles.description}>
              校園活動、作業截止，以及在這裡匯入的 iCal。個人行程與每週課表分開查看。
            </Text>
            <View style={styles.options}>
              {calendarScopes.map((scope) => {
                const selected = scope.id === 'campus';
                return (
                  <Pressable
                    key={scope.id}
                    accessibilityRole="button"
                    accessibilityLabel={scope.label}
                    accessibilityHint={scope.hint}
                    accessibilityState={{ selected, disabled: selected }}
                    disabled={selected}
                    onPress={() => {
                      const destination = calendarScopeDestination('campus', scope.id);
                      if (destination) {
                        safeNavigate(props.navigation, destination, undefined, {
                          fallbackMessage: `「${scope.label}」目前無法開啟，請返回後再試一次。`,
                        });
                      }
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      selected && styles.selectedOption,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.optionText, selected && styles.selectedText]}>
                      {scope.label}
                      {selected ? ' · 目前頁面' : ' →'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.personalSummary}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                另外查看個人行程
              </Text>
              <Text style={styles.description}>自己新增或匯入的活動與考試，請開啟個人行事曆。</Text>
              <PersonalImportSummary kind="events" />
            </View>
          </View>
        }
      />
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    header: { gap: 12 },
    title: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
    description: { fontSize: 14, color: theme.colors.textSecondary },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: {
      minHeight: 48,
      minWidth: 48,
      maxWidth: '100%',
      flexShrink: 1,
      paddingHorizontal: 12,
      paddingVertical: 12,
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    selectedOption: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    optionText: { fontSize: 14, color: theme.colors.accent, flexShrink: 1 },
    selectedText: { fontWeight: '700' },
    pressed: { opacity: 0.7 },
    personalSummary: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      paddingTop: 12,
    },
    sectionTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  });

export default UnifiedCalendarScreen;
