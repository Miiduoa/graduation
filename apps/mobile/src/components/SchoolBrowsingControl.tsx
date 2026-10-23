import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { School } from '@campus/shared/src';
import { searchSchools } from '@campus/shared/src/schools';
import { useSchool } from '../state/school';
import { fetchSchoolDirectory } from '../services/schoolDirectory';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

export function SchoolBrowsingControl() {
  const s = useThemeStyleSheet(createStyles);
  const { school, setSelection } = useSchool();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState<School[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetchSchoolDirectory().then(
      (schools) => {
        if (active) setDirectory(schools);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [open, attempt]);

  const matches = useMemo(() => searchSchools(query, directory ?? []), [query, directory]);

  return (
    <>
      <View style={s.browsing}>
        <Text accessibilityRole="header" style={s.eyebrow}>
          瀏覽校園
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`目前瀏覽${school.name}，選擇其他學校`}
          onPress={() => {
            setQuery('');
            setDirectory(null);
            setError(false);
            setOpen(true);
          }}
          style={({ pressed }) => [s.schoolChoice, pressed && s.pressed]}
        >
          <Text style={s.schoolName}>{school.name}</Text>
          <Text style={s.changeSchool}>選擇其他學校</Text>
        </Pressable>
        <Text style={s.browsingNote}>
          切換後，公開校園資訊會依學校更新。已登入的帳號、課班資格及校務資料權限不會跟著改變。
        </Text>
      </View>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={s.modal}>
          <View style={s.modalHeading}>
            <Text accessibilityRole="header" style={s.modalTitle}>
              選擇瀏覽校園
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="關閉校園選擇"
              onPress={() => setOpen(false)}
              style={({ pressed }) => [s.button, pressed && s.pressed]}
            >
              <Text style={s.buttonText}>完成</Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="搜尋學校"
            placeholder="搜尋學校名稱或代碼"
            placeholderTextColor={theme.colors.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            style={s.search}
          />
          {directory === null && !error ? (
            <View style={{ padding: 28, gap: 12 }}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, textAlign: 'center' }}>
                正在讀取學校目錄…
              </Text>
            </View>
          ) : error ? (
            <View style={{ padding: 28, gap: 14 }}>
              <Text accessibilityRole="alert" style={{ color: theme.colors.text }}>
                無法讀取學校目錄，請檢查網路後重試。
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDirectory(null);
                  setError(false);
                  setAttempt((value) => value + 1);
                }}
                style={({ pressed }) => [s.button, pressed && s.pressed]}
              >
                <Text style={s.buttonText}>重新讀取</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, paddingBottom: 42 }}
            >
              {matches.length === 0 ? (
                <Text style={{ color: theme.colors.muted }}>找不到符合的學校，請換個關鍵字。</Text>
              ) : (
                matches.map((entry) => (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={`選擇${entry.name}`}
                    accessibilityState={{ selected: entry.id === school.id }}
                    onPress={() => {
                      setSelection({
                        schoolId: entry.id,
                        code: entry.code,
                        schoolName: entry.name,
                        shortName: entry.shortName ?? null,
                        themeColor: entry.themeColor ?? null,
                        domains: entry.domains ?? null,
                      });
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      s.schoolRow,
                      entry.id === school.id && s.selectedSchool,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 15 }}>
                        {entry.name}
                      </Text>
                      <Text style={{ color: theme.colors.muted, marginTop: 3, fontSize: 12 }}>
                        {entry.code}
                      </Text>
                    </View>
                    {entry.id === school.id ? <Text style={s.selectedLabel}>目前選擇</Text> : null}
                  </Pressable>
                ))
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const createStyles = () =>
  StyleSheet.create({
    browsing: {
      paddingVertical: 18,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
    },
    eyebrow: { color: theme.colors.muted, fontSize: 12, fontWeight: '500' },
    schoolChoice: {
      minHeight: 50,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderRadius: 6,
    },
    schoolName: {
      color: theme.colors.text,
      fontSize: 19,
      lineHeight: 28,
      fontWeight: '600',
      flexShrink: 1,
    },
    changeSchool: { color: theme.colors.accent, fontSize: 13, lineHeight: 22, fontWeight: '600' },
    browsingNote: { color: theme.colors.muted, fontSize: 12, lineHeight: 21 },
    pressed: { opacity: 0.65 },
    modal: { flex: 1, backgroundColor: theme.colors.bg },
    modalHeading: {
      padding: 20,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
    },
    modalTitle: {
      color: theme.colors.text,
      fontSize: 22,
      lineHeight: 30,
      fontWeight: '600',
      flex: 1,
    },
    button: {
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 6,
    },
    buttonText: { color: theme.colors.accent, fontSize: 14, lineHeight: 22, fontWeight: '600' },
    search: {
      marginHorizontal: 20,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 50,
      fontSize: 16,
      borderRadius: 10,
      borderColor: theme.colors.border,
      borderWidth: 1,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
    },
    schoolRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 17,
      paddingHorizontal: 12,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderColor: theme.colors.border,
      minHeight: 70,
      borderRadius: 8,
    },
    selectedSchool: { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
    selectedLabel: { color: theme.colors.accent, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  });
