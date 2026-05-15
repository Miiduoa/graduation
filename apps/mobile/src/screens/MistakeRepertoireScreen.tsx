/**
 * Mistake Repertoire Screen — 錯題本（TronClass 沒有）
 *
 * 學生看到所有錯題、今天該複習的、按 box 分類；
 * 一鍵開始 daily practice，答對 → box+1，答錯 → box reset。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  dueToday as mistakesDueToday,
  recordPractice,
  recommendDailyPracticeSet,
  statsOf,
  addMistake,
  type MistakeEntry,
} from '@campus/shared';
import { theme } from '../ui/theme';
import { Card, Pill, EmptyState } from '../ui/components';
import { useAuth } from '../state/auth';
import { getScopedStorageKey } from '../services/scopedStorage';

const STORAGE_KEY_BASE = 'mistake_repertoire_v1';

const SEED_MISTAKES: MistakeEntry[] = [
  {
    id: 'demo_q1',
    courseId: '71378',
    courseName: '機器學習',
    examId: 'mid',
    examTitle: '期中考',
    questionText: 'Bias-variance trade-off 中，過擬合是 high bias 還是 high variance？',
    kind: 'mcq',
    studentAnswer: 'high bias',
    correctAnswer: 'high variance',
    explanation: '過擬合是模型對訓練資料記得太牢、無法泛化 → high variance / low bias。',
    tags: ['期中', '理論'],
    box: 0,
    lastPracticedAt: new Date(Date.now() - 86_400_000 * 5).toISOString(),
    correctCount: 0,
    wrongCount: 1,
    retired: false,
  },
  {
    id: 'demo_q2',
    courseId: '71393',
    courseName: '作業研究',
    examId: 'mid',
    examTitle: '作研期中考',
    questionText: 'LP 問題的對偶（dual）變數代表什麼經濟意義？',
    kind: 'short_answer',
    studentAnswer: '不知道',
    correctAnswer: '影子價格 (shadow price)：增加 1 單位約束資源能讓目標函數變化的量',
    tags: ['期中', '對偶'],
    box: 1,
    lastPracticedAt: new Date(Date.now() - 86_400_000 * 7).toISOString(),
    correctCount: 1,
    wrongCount: 1,
    retired: false,
  },
  {
    id: 'demo_q3',
    courseId: '71378',
    courseName: '機器學習',
    examId: 'mid',
    examTitle: '期中考',
    questionText: 'K-means 與 GMM 的關鍵差異？',
    kind: 'short_answer',
    studentAnswer: 'K-means 比較快',
    correctAnswer: 'K-means 假設群是球形且大小相似；GMM 用 Gaussian 機率分布，群可以橢圓且大小不同。',
    explanation: 'K-means 是 GMM 的特例（共變異矩陣 = σI）',
    tags: ['分群'],
    box: 0,
    lastPracticedAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
    correctCount: 0,
    wrongCount: 2,
    retired: false,
  },
];

export default function MistakeRepertoireScreen() {
  const auth = useAuth();
  const storageKey = useMemo(
    () => getScopedStorageKey(STORAGE_KEY_BASE, { uid: auth.user?.uid ?? 'demo', schoolId: auth.profile?.schoolId ?? null }),
    [auth.user?.uid, auth.profile?.schoolId],
  );
  const [entries, setEntries] = useState<MistakeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'due' | 'all' | 'retired'>('due');
  const [practiceEntry, setPracticeEntry] = useState<MistakeEntry | null>(null);
  const [practiceAnswer, setPracticeAnswer] = useState('');
  const [practiceRevealed, setPracticeRevealed] = useState(false);
  const now = new Date().toISOString();

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setEntries(parsed);
          } else {
            // 第一次：seed demo data 讓使用者立刻看到內容
            setEntries(SEED_MISTAKES);
            await AsyncStorage.setItem(storageKey, JSON.stringify(SEED_MISTAKES));
          }
        } else {
          setEntries(SEED_MISTAKES);
          await AsyncStorage.setItem(storageKey, JSON.stringify(SEED_MISTAKES));
        }
      } catch {
        setEntries(SEED_MISTAKES);
      } finally {
        setLoading(false);
      }
    })();
  }, [storageKey]);

  const persist = useCallback(async (next: MistakeEntry[]) => {
    setEntries(next);
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* swallow */
    }
  }, [storageKey]);

  const stats = useMemo(() => statsOf(entries, now), [entries, now]);
  const visible = useMemo(() => {
    if (view === 'due') return recommendDailyPracticeSet(entries, now, 50);
    if (view === 'retired') return entries.filter((e) => e.retired);
    return entries.filter((e) => !e.retired);
  }, [entries, view, now]);

  const startPractice = (e: MistakeEntry) => {
    setPracticeEntry(e);
    setPracticeAnswer('');
    setPracticeRevealed(false);
  };

  const submitPractice = useCallback(
    async (isCorrect: boolean) => {
      if (!practiceEntry) return;
      const next = recordPractice(entries, {
        entryId: practiceEntry.id,
        isCorrect,
        attemptedAt: new Date().toISOString(),
      });
      await persist(next);
      setPracticeEntry(null);
      setPracticeAnswer('');
      setPracticeRevealed(false);
    },
    [practiceEntry, entries, persist],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      contentContainerStyle={{ padding: 16, paddingBottom: 80, gap: 14 }}
    >
      {/* 統計 */}
      <View
        style={{
          backgroundColor: theme.colors.primary,
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ color: theme.colors.onAccent, fontSize: 12, opacity: 0.85 }}>🧠 錯題本</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <View>
            <Text style={{ color: theme.colors.onAccent, fontSize: 30, fontWeight: '800' }}>
              {stats.dueTodayCount}
            </Text>
            <Text style={{ color: theme.colors.onAccent, opacity: 0.8, fontSize: 11 }}>今天該練</Text>
          </View>
          <View>
            <Text style={{ color: theme.colors.onAccent, fontSize: 22, fontWeight: '700' }}>
              {stats.active}
            </Text>
            <Text style={{ color: theme.colors.onAccent, opacity: 0.8, fontSize: 11 }}>進行中</Text>
          </View>
          <View>
            <Text style={{ color: theme.colors.onAccent, fontSize: 22, fontWeight: '700' }}>
              {stats.retired}
            </Text>
            <Text style={{ color: theme.colors.onAccent, opacity: 0.8, fontSize: 11 }}>已熟練</Text>
          </View>
          <View>
            <Text style={{ color: theme.colors.onAccent, fontSize: 22, fontWeight: '700' }}>
              {Math.round(stats.masteryRate * 100)}%
            </Text>
            <Text style={{ color: theme.colors.onAccent, opacity: 0.8, fontSize: 11 }}>吸收率</Text>
          </View>
        </View>
      </View>

      {/* Tab 切換 */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(
          [
            { key: 'due', label: '今日該練', count: stats.dueTodayCount },
            { key: 'all', label: '全部', count: stats.active },
            { key: 'retired', label: '已熟練', count: stats.retired },
          ] as const
        ).map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setView(tab.key)}
            style={({ pressed }) => ({
              flex: 1,
              padding: 10,
              borderRadius: 10,
              backgroundColor: view === tab.key ? theme.colors.primary : theme.colors.surface,
              borderWidth: 1,
              borderColor: view === tab.key ? theme.colors.primary : theme.colors.border,
              alignItems: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: view === tab.key ? theme.colors.onAccent : theme.colors.text,
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {tab.label} ({tab.count})
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 列表 */}
      {visible.length === 0 ? (
        <EmptyState
          icon="trophy-outline"
          title={view === 'due' ? '今天沒有要複習的錯題' : view === 'retired' ? '還沒有熟練的題目' : '錯題本是空的'}
          subtitle={view === 'due' ? '繼續加油，明天還有題目該練' : '考試後系統會自動匯入錯題'}
        />
      ) : (
        visible.map((e) => (
          <Card
            key={e.id}
            title={`Box ${e.box} · ${e.courseName}`}
            subtitle={e.examTitle}
          >
            <Text style={{ color: theme.colors.text, fontSize: 14, marginBottom: 8 }}>
              {e.questionText}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {e.tags.map((t) => (
                <Pill key={t} text={`#${t}`} kind="default" />
              ))}
              <Pill text={`對 ${e.correctCount}/錯 ${e.wrongCount}`} kind="warning" />
              {e.retired && <Pill text="已熟練" kind="success" />}
            </View>
            {!e.retired && (
              <Pressable
                onPress={() => startPractice(e)}
                style={({ pressed }) => ({
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>練習這題</Text>
              </Pressable>
            )}
          </Card>
        ))
      )}

      {/* 練習 modal */}
      <Modal visible={!!practiceEntry} animationType="slide" transparent>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'flex-end',
          }}
        >
          {practiceEntry && (
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 18,
                maxHeight: '90%',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
                  Box {practiceEntry.box} · {practiceEntry.courseName}
                </Text>
                <Pressable onPress={() => setPracticeEntry(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={24} color={theme.colors.muted} />
                </Pressable>
              </View>
              <ScrollView style={{ marginTop: 12 }}>
                <Text style={{ color: theme.colors.text, fontSize: 15, lineHeight: 22 }}>
                  {practiceEntry.questionText}
                </Text>
                <TextInput
                  multiline
                  placeholder="寫下你的答案"
                  placeholderTextColor={theme.colors.muted}
                  value={practiceAnswer}
                  onChangeText={setPracticeAnswer}
                  style={{
                    marginTop: 14,
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    minHeight: 80,
                    textAlignVertical: 'top',
                  }}
                />
                {practiceRevealed ? (
                  <View
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 10,
                      backgroundColor: '#DCFCE7',
                    }}
                  >
                    <Text style={{ color: '#15803D', fontWeight: '700', marginBottom: 4 }}>正解</Text>
                    <Text style={{ color: '#166534', lineHeight: 20 }}>
                      {practiceEntry.correctAnswer}
                    </Text>
                    {practiceEntry.explanation && (
                      <>
                        <Text style={{ color: '#15803D', fontWeight: '700', marginTop: 8, marginBottom: 4 }}>
                          講解
                        </Text>
                        <Text style={{ color: '#166534', lineHeight: 20 }}>
                          {practiceEntry.explanation}
                        </Text>
                      </>
                    )}
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setPracticeRevealed(true)}
                    style={({ pressed }) => ({
                      marginTop: 12,
                      padding: 10,
                      borderRadius: 8,
                      alignItems: 'center',
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>顯示正解</Text>
                  </Pressable>
                )}
              </ScrollView>
              {practiceRevealed && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Pressable
                    onPress={() => submitPractice(false)}
                    style={({ pressed }) => ({
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      backgroundColor: '#FEE2E2',
                      alignItems: 'center',
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ color: '#991B1B', fontWeight: '700' }}>還沒記熟</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => submitPractice(true)}
                    style={({ pressed }) => ({
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      backgroundColor: '#16A34A',
                      alignItems: 'center',
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>會了 ✓</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}
