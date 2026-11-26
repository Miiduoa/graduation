/**
 * Data Flow Debug Screen — TronClass 資料抓取診斷工具
 *
 * 給開發者 / 測試人員看：每個 endpoint 實際呼叫回了什麼。
 * 方便找出「TronClass 有資料但系統沒抓到」的破口。
 *
 * 不對外公開；建議從 我的 → 開發者選單 進入。
 */
import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

import {
  tcFetchCourses,
  tcFetchModules,
  tcFetchActivities,
  tcFetchCourseActivities,
  tcFetchCourseExams,
  tcFetchHomeworkActivities,
  tcFetchHomeworkScores,
  tcFetchScoreItems,
  tcFetchSelfScore,
  tcFetchAttendance,
  tcFetchAnnouncements,
  tcFetchCourseAnnouncements,
  tcFetchDiscussions,
  tcFetchCourseMembers,
  tcFetchSyllabus,
  tcFetchExams,
  tcFetchTodos,
} from '../services/tronClassClient';

type EndpointSpec = {
  key: string;
  label: string;
  /** 是否需要 courseId */
  needsCourseId: boolean;
  call: (courseId: number) => Promise<unknown>;
};

const ENDPOINTS: EndpointSpec[] = [
  { key: 'courses', label: '我的課程列表', needsCourseId: false, call: () => tcFetchCourses() },
  { key: 'modules', label: '課程模組（章節）', needsCourseId: true, call: (id) => tcFetchModules(id) },
  { key: 'activities', label: '課程活動（全部）', needsCourseId: true, call: (id) => tcFetchActivities(id) },
  { key: 'courseActivities', label: '教材活動（含 uploads）', needsCourseId: true, call: (id) => tcFetchCourseActivities(id) },
  { key: 'courseExams', label: '課程考試', needsCourseId: true, call: (id) => tcFetchCourseExams(id) },
  { key: 'homeworkActivities', label: '作業活動（含繳交狀態）', needsCourseId: true, call: (id) => tcFetchHomeworkActivities(id) },
  { key: 'homeworkScores', label: '作業分數', needsCourseId: true, call: (id) => tcFetchHomeworkScores(id) },
  { key: 'scoreItems', label: '成績項目（加權設定）', needsCourseId: true, call: (id) => tcFetchScoreItems(id) },
  { key: 'selfScore', label: '我的分數總覽', needsCourseId: true, call: (id) => tcFetchSelfScore(id) },
  { key: 'attendance', label: '出缺席記錄', needsCourseId: false, call: () => tcFetchAttendance() },
  { key: 'announcements', label: '全校公告', needsCourseId: false, call: () => tcFetchAnnouncements() },
  { key: 'courseAnnouncements', label: '課程公告', needsCourseId: true, call: (id) => tcFetchCourseAnnouncements(id) },
  { key: 'discussions', label: '課程討論', needsCourseId: true, call: (id) => tcFetchDiscussions(id) },
  { key: 'courseMembers', label: '課程成員', needsCourseId: true, call: (id) => tcFetchCourseMembers(id) },
  { key: 'syllabus', label: '課程大綱', needsCourseId: true, call: (id) => tcFetchSyllabus(id) },
  { key: 'exams', label: '考試列表', needsCourseId: true, call: (id) => tcFetchExams(id) },
  { key: 'todos', label: '待辦列表', needsCourseId: false, call: () => tcFetchTodos() },
];

interface Result {
  loading: boolean;
  ms?: number;
  ok?: boolean;
  count?: number;
  raw?: unknown;
  error?: string;
}

export default function DataFlowDebugScreen() {
  useThemeVersion();
  const [courseId, setCourseId] = useState('');
  const [results, setResults] = useState<Record<string, Result>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const runOne = async (e: EndpointSpec) => {
    const id = Number(courseId) || 0;
    if (e.needsCourseId && !id) {
      Alert.alert('需要 course ID', '請先在頂部輸入');
      return;
    }
    setResults((r) => ({ ...r, [e.key]: { loading: true } }));
    const t0 = Date.now();
    try {
      const data = await e.call(id);
      const ms = Date.now() - t0;
      const count = Array.isArray(data) ? data.length : data === null ? 0 : 1;
      setResults((r) => ({
        ...r,
        [e.key]: { loading: false, ok: true, ms, count, raw: data },
      }));
    } catch (err) {
      setResults((r) => ({
        ...r,
        [e.key]: {
          loading: false,
          ok: false,
          ms: Date.now() - t0,
          error: String((err as Error)?.message ?? err),
        },
      }));
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    for (const e of ENDPOINTS) {
      if (e.needsCourseId && !Number(courseId)) continue;
      await runOne(e);
    }
    setRunningAll(false);
  };

  const monoFont = Platform.select({ ios: 'Menlo', default: 'monospace' });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: theme.layout.screenHorizontalPadding,
        paddingTop: theme.space.md,
        paddingBottom: 64,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.text, fontSize: 24, fontWeight: '700', lineHeight: 30 }}
      >
        資料流診斷
      </Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
        逐一打 TronClass endpoint，看哪些回資料、哪些回空、哪些失敗
      </Text>

      <View style={{ marginTop: 16 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>
          Course ID
        </Text>
        <TextInput
          value={courseId}
          onChangeText={setCourseId}
          placeholder="例如 71240"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Course ID"
          keyboardType="number-pad"
          style={{
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: theme.radius.md,
            fontSize: 16,
            minHeight: 44,
          }}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="一鍵跑全部"
        accessibilityState={{ disabled: runningAll, busy: runningAll }}
        onPress={runAll}
        disabled={runningAll}
        style={({ pressed }) => ({
          marginTop: 12,
          minHeight: 48,
          paddingVertical: 12,
          paddingHorizontal: theme.space.md,
          borderRadius: theme.radius.md,
          backgroundColor: runningAll ? theme.colors.disabledBg : theme.colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed && !runningAll ? 0.85 : 1,
        })}
      >
        {runningAll ? (
          <ActivityIndicator color={theme.colors.muted} />
        ) : (
          <Text style={{ color: theme.colors.onAccent, fontSize: 15, fontWeight: '700' }}>
            一鍵跑全部
          </Text>
        )}
      </Pressable>

      <View
        style={{
          marginTop: 16,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
        }}
      >
        {ENDPOINTS.map((e, idx) => {
          const r = results[e.key] ?? { loading: false };
          const expand = expanded === e.key;
          const statusColor =
            r.ok === true
              ? theme.colors.success
              : r.ok === false
                ? theme.colors.danger
                : theme.colors.muted;

          return (
            <View
              key={e.key}
              style={{
                paddingHorizontal: theme.space.md,
                paddingVertical: 12,
                borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.separator,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: statusColor,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>
                      {e.label}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                      {e.key}
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`呼叫 ${e.label}`}
                  onPress={() => runOne(e)}
                  style={({ pressed }) => ({
                    minHeight: 36,
                    minWidth: 56,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: theme.radius.sm,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  {r.loading ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>
                      呼叫
                    </Text>
                  )}
                </Pressable>
              </View>

              {r.ok !== undefined && (
                <View style={{ marginTop: 8, paddingLeft: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                  <Text style={{ color: statusColor, fontSize: 12, fontWeight: '600' }}>
                    {r.ok ? '成功' : '失敗'} · {r.ms}ms
                  </Text>
                  {r.count !== undefined && (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                      {r.count} 筆
                    </Text>
                  )}
                  {r.raw !== undefined && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={expand ? `收起 ${e.label} JSON` : `檢視 ${e.label} raw JSON`}
                      onPress={() => setExpanded(expand ? null : e.key)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
                    >
                      <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
                        {expand ? '收起' : '看 raw JSON'}
                      </Text>
                      <Ionicons
                        name={expand ? 'chevron-up' : 'chevron-down'}
                        size={13}
                        color={theme.colors.accent}
                      />
                    </Pressable>
                  )}
                </View>
              )}

              {r.error && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 6, paddingLeft: 18 }}>
                  {r.error}
                </Text>
              )}

              {expand && r.raw !== undefined && (
                <ScrollView
                  horizontal
                  style={{
                    marginTop: 8,
                    padding: 10,
                    backgroundColor: theme.colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.sm,
                    maxHeight: 250,
                  }}
                >
                  <Text
                    selectable
                    style={{ color: theme.colors.text, fontFamily: monoFont, fontSize: 11, lineHeight: 16 }}
                  >
                    {JSON.stringify(r.raw, null, 2).slice(0, 3000)}
                    {JSON.stringify(r.raw).length > 3000 ? '\n…(truncated)' : ''}
                  </Text>
                </ScrollView>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
