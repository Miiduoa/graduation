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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0f172a' }} contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
      <Text style={{ color: '#fbbf24', fontSize: 24, fontWeight: '700' }}>🔍 資料流診斷</Text>
      <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>
        逐一打 TronClass endpoint，看哪些回資料、哪些回空、哪些失敗
      </Text>

      <View style={{ marginTop: 16 }}>
        <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 4 }}>Course ID</Text>
        <TextInput
          value={courseId}
          onChangeText={setCourseId}
          placeholder="例如 71240"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          style={{
            backgroundColor: '#1e293b',
            color: '#fff',
            padding: 10,
            borderRadius: 8,
            fontSize: 16,
          }}
        />
      </View>

      <Pressable
        onPress={runAll}
        disabled={runningAll}
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 8,
          backgroundColor: runningAll ? '#475569' : '#fbbf24',
          alignItems: 'center',
        }}
      >
        {runningAll ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={{ color: '#0f172a', fontWeight: '700' }}>一鍵跑全部</Text>
        )}
      </Pressable>

      {ENDPOINTS.map((e) => {
        const r = results[e.key] ?? { loading: false };
        const expand = expanded === e.key;
        return (
          <View
            key={e.key}
            style={{
              marginTop: 10,
              backgroundColor: '#1e293b',
              borderRadius: 10,
              padding: 12,
              borderLeftWidth: 4,
              borderLeftColor: r.ok === true ? '#22c55e' : r.ok === false ? '#dc2626' : '#64748b',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{e.label}</Text>
                <Text style={{ color: '#64748b', fontSize: 11 }}>{e.key}</Text>
              </View>
              <Pressable
                onPress={() => runOne(e)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: '#334155',
                }}
              >
                {r.loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontSize: 12 }}>呼叫</Text>
                )}
              </Pressable>
            </View>

            {r.ok !== undefined && (
              <View style={{ marginTop: 8, flexDirection: 'row', gap: 12 }}>
                <Text style={{ color: r.ok ? '#22c55e' : '#dc2626', fontSize: 12 }}>
                  {r.ok ? '✓' : '✗'} {r.ms}ms
                </Text>
                {r.count !== undefined && (
                  <Text style={{ color: '#cbd5e1', fontSize: 12 }}>
                    📊 {r.count} 筆
                  </Text>
                )}
                {r.raw && (
                  <Pressable onPress={() => setExpanded(expand ? null : e.key)}>
                    <Text style={{ color: '#fbbf24', fontSize: 12 }}>
                      {expand ? '收起' : '看 raw JSON'} ▾
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {r.error && (
              <Text style={{ color: '#fca5a5', fontSize: 11, marginTop: 6 }}>{r.error}</Text>
            )}

            {expand && r.raw && (
              <ScrollView
                horizontal
                style={{
                  marginTop: 8,
                  padding: 8,
                  backgroundColor: '#0f172a',
                  borderRadius: 6,
                  maxHeight: 250,
                }}
              >
                <Text
                  selectable
                  style={{ color: '#86efac', fontFamily: 'Menlo', fontSize: 10 }}
                >
                  {JSON.stringify(r.raw, null, 2).slice(0, 3000)}
                  {JSON.stringify(r.raw).length > 3000 ? '\n…(truncated)' : ''}
                </Text>
              </ScrollView>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
