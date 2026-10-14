import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { School } from '@campus/shared/src';
import { searchSchools } from '@campus/shared/src/schools';
import { useSchool } from '../state/school';
import { fetchSchoolDirectory } from '../services/schoolDirectory';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';

export function SchoolBrowsingControl() {
  const { school, setSelection } = useSchool();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState<School[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setDirectory(null);
    setError(false);
    void fetchSchoolDirectory().then(
      (schools) => {
        if (active) setDirectory(schools);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => { active = false; };
  }, [open, attempt]);

  const matches = useMemo(() => searchSchools(query, directory ?? []), [query, directory]);

  return (
    <>
      <AICard title="瀏覽校園">
        <View style={{ gap: 10 }}>
          <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '600' }}>{school.name}</Text>
          <Text style={{ color: aiTokens.muted, lineHeight: 21 }}>
            切換後，公開校園資訊會依學校更新。已登入的帳號、課班資格及校務資料權限不會跟著改變。
          </Text>
          <AIButton label="選擇其他學校" onPress={() => { setQuery(''); setOpen(true); }} />
        </View>
      </AICard>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: aiTokens.surface }}>
          <View style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: aiTokens.text, fontSize: 21, fontWeight: '700' }}>選擇瀏覽校園</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="關閉校園選擇"
              onPress={() => setOpen(false)}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}
            >
              <Text style={{ color: aiTokens.text }}>完成</Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="搜尋學校"
            placeholder="搜尋學校名稱或代碼"
            placeholderTextColor={aiTokens.muted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              marginHorizontal: 20, paddingHorizontal: 14, minHeight: 48,
              borderRadius: 8, borderColor: aiTokens.border, borderWidth: 1,
              color: aiTokens.text,
            }}
          />
          {directory === null && !error ? (
            <View style={{ padding: 28, gap: 12 }}>
              <ActivityIndicator />
              <Text style={{ color: aiTokens.muted, textAlign: 'center' }}>正在讀取學校目錄…</Text>
            </View>
          ) : error ? (
            <View style={{ padding: 28, gap: 14 }}>
              <Text accessibilityRole="alert" style={{ color: aiTokens.text }}>無法讀取學校目錄，請檢查網路後重試。</Text>
              <AIButton label="重新讀取" onPress={() => setAttempt((value) => value + 1)} />
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 42 }}>
              {matches.length === 0 ? (
                <Text style={{ color: aiTokens.muted }}>找不到符合的學校，請換個關鍵字。</Text>
              ) : matches.map((entry) => (
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
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 17, borderBottomWidth: 1, borderColor: aiTokens.border,
                    minHeight: 56,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: aiTokens.text, fontWeight: '600', fontSize: 15 }}>{entry.name}</Text>
                    <Text style={{ color: aiTokens.muted, marginTop: 3 }}>{entry.code}</Text>
                  </View>
                  {entry.id === school.id ? <Text style={{ color: aiTokens.text }}>目前選擇</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}
