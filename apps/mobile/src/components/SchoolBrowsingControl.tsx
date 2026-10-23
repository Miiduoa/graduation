import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const resultsList = useRef<FlatList<School>>(null);

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

  const matches = useMemo(() => {
    const found = searchSchools(query, directory ?? []);
    return query.trim()
      ? found
      : [...found].sort((a, b) => Number(b.id === school.id) - Number(a.id === school.id));
  }, [query, directory, school.id]);
  useEffect(() => {
    resultsList.current?.scrollToOffset({ offset: 0, animated: false });
  }, [query]);
  const closePicker = () => {
    Keyboard.dismiss();
    setOpen(false);
  };

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
            setSearchFocused(false);
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
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closePicker}
      >
        <SafeAreaView style={s.modal}>
          <KeyboardAvoidingView
            style={s.modalContent}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={s.modalHeading}>
              <Text accessibilityRole="header" style={s.modalTitle}>
                選擇瀏覽校園
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="關閉校園選擇"
                onPress={closePicker}
                style={({ pressed }) => [s.button, pressed && s.pressed]}
              >
                <Text style={s.buttonText}>關閉</Text>
              </Pressable>
            </View>
            <View style={[s.searchBox, searchFocused && s.searchFocused]}>
              <TextInput
                ref={searchInput}
                accessibilityLabel="搜尋學校"
                placeholder="搜尋學校名稱或代碼"
                placeholderTextColor={theme.colors.muted}
                value={query}
                onChangeText={setQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onSubmitEditing={() => Keyboard.dismiss()}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance={theme.mode}
                selectionColor={theme.colors.accent}
                returnKeyType="search"
                style={s.search}
              />
              {query.length ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清除學校搜尋"
                  onPress={() => {
                    setQuery('');
                    searchInput.current?.focus();
                  }}
                  style={({ pressed }) => [s.clearSearch, pressed && s.pressed]}
                >
                  <Text style={s.buttonText}>清除</Text>
                </Pressable>
              ) : null}
            </View>
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
              <View style={s.results}>
                <Text accessibilityLiveRegion="polite" style={s.resultCaption}>
                  {matches.length} 所學校 · 點選後切換公開資訊
                </Text>
                <FlatList
                  ref={resultsList}
                  data={matches}
                  keyExtractor={(entry) => entry.id}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  contentContainerStyle={s.resultList}
                  ListEmptyComponent={
                    <Text style={s.emptyResult}>找不到符合的學校，請換個關鍵字。</Text>
                  }
                  renderItem={({ item: entry }) => (
                    <Pressable
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
                        closePicker();
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
                      {entry.id === school.id ? (
                        <Text style={s.selectedLabel}>目前選擇</Text>
                      ) : (
                        <Text
                          style={s.rowArrow}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        >
                          →
                        </Text>
                      )}
                    </Pressable>
                  )}
                />
              </View>
            )}
            <View style={s.modalFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="完成校園選擇"
                onPress={closePicker}
                style={({ pressed }) => [s.doneButton, pressed && s.donePressed]}
              >
                <Text style={s.doneText}>完成</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const createStyles = () =>
  StyleSheet.create({
    browsing: {
      paddingVertical: 14,
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
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    modal: { flex: 1, backgroundColor: theme.colors.bg },
    modalContent: { flex: 1 },
    modalHeading: {
      padding: 18,
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
    searchBox: {
      marginHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      borderRadius: 10,
      borderColor: theme.colors.border,
      borderWidth: 1,
      backgroundColor: theme.colors.surface,
    },
    searchFocused: { borderColor: theme.colors.accent },
    search: {
      flex: 1,
      minWidth: 0,
      minHeight: 50,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.colors.text,
    },
    clearSearch: {
      minHeight: 44,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 7,
      marginRight: 4,
    },
    results: { flex: 1 },
    resultCaption: {
      marginHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 8,
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 20,
    },
    resultList: { paddingHorizontal: 18, paddingBottom: 20 },
    emptyResult: { color: theme.colors.muted, fontSize: 14, lineHeight: 23, paddingVertical: 20 },
    schoolRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 15,
      paddingHorizontal: 12,
      marginBottom: 4,
      borderWidth: 1,
      borderColor: 'transparent',
      borderBottomColor: theme.colors.border,
      minHeight: 68,
      borderRadius: 8,
    },
    selectedSchool: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.accent },
    selectedLabel: { color: theme.colors.accent, fontSize: 12, fontWeight: '600', flexShrink: 1 },
    rowArrow: { color: theme.colors.muted, fontSize: 21 },
    modalFooter: {
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 12,
      marginTop: 'auto',
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    doneButton: {
      minHeight: 50,
      padding: 14,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 9,
    },
    donePressed: { backgroundColor: theme.colors.accentHover },
    doneText: { color: theme.colors.onAccent, fontSize: 15, lineHeight: 23, fontWeight: '600' },
  });
