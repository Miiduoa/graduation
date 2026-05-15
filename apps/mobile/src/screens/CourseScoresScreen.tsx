/**
 * Course Scores Screen — 學生看「某一門課」的成績清單（直接走 TronClass）
 *
 * 不經過 AcademicScreen 也不被 RouteGuard 擋。從 TronClass 真實拉：
 *   - tcFetchSelfScore(courseId)：個人整體成績
 *   - tcFetchScoreItems(courseId)：每個評量項與加權
 *   - tcFetchHomeworkScores(courseId)：作業分數
 *   - tcFetchCourseExams(courseId) + tcFetchExamSubmissions：測驗分數
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import {
  tcFetchSelfScore,
  tcFetchScoreItems,
  tcFetchCourseExams,
  tcFetchExamSubmissions,
  tcFetchHomeworkActivities,
} from '../services/tronClassClient';

type RouteProps = {
  route?: {
    params?: {
      groupId?: string;
      groupName?: string;
      courseSpaceId?: string;
    };
  };
};

interface ScoreRow {
  id: string;
  title: string;
  category: 'homework' | 'exam' | 'quiz' | 'item';
  score: number | null;
  totalScore: number | null;
  weight: number | null;
  status: 'graded' | 'pending' | 'missing';
}

export default function CourseScoresScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const groupName = props.route?.params?.groupName ?? '課內成績';
  const groupIdStr = props.route?.params?.groupId ?? props.route?.params?.courseSpaceId ?? '';
  const courseId = Number(groupIdStr.replace(/^tc:/, '')) || 0;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfScore, setSelfScore] = useState<unknown>(null);
  const [rows, setRows] = useState<ScoreRow[]>([]);

  const load = useCallback(async () => {
    setError(null);
    if (!courseId) {
      setError('沒有提供課程 ID');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const [self, items, exams, homeworks] = await Promise.all([
        tcFetchSelfScore(courseId).catch(() => null),
        tcFetchScoreItems(courseId).catch(() => []),
        tcFetchCourseExams(courseId).catch(() => []),
        tcFetchHomeworkActivities(courseId).catch(() => []),
      ]);

      setSelfScore(self);

      const out: ScoreRow[] = [];

      // 作業分數
      for (const hw of homeworks) {
        const score = (hw as { student_score?: number | null }).student_score ?? null;
        out.push({
          id: `hw-${hw.id}`,
          title: hw.title ?? '作業',
          category: 'homework',
          score,
          totalScore: hw.total_score ?? null,
          weight: hw.weight ?? null,
          status: score !== null ? 'graded' : hw.submitted ? 'pending' : 'missing',
        });
      }

      // 測驗分數
      for (const e of exams) {
        const sub = await tcFetchExamSubmissions(e.id).catch(() => null);
        const score = sub?.exam_final_score ?? sub?.exam_score ?? null;
        out.push({
          id: `exam-${e.id}`,
          title: e.title,
          category: e.type === 'exam' ? 'exam' : 'quiz',
          score,
          totalScore: e.total_score,
          weight: null,
          status: score !== null ? 'graded' : e.submitted_times > 0 ? 'pending' : 'missing',
        });
      }

      // 其他評分項目（從 scoreItems）
      for (const item of items) {
        const itemAny = item as Record<string, unknown>;
        const itemId = String(itemAny.id ?? '');
        // 已經有對應的 exam/hw 就跳過
        if (out.some((r) => r.id.endsWith(itemId))) continue;
        out.push({
          id: `item-${itemId}`,
          title: String(itemAny.title ?? itemAny.name ?? '評分項'),
          category: 'item',
          score: typeof itemAny.score === 'number' ? itemAny.score : null,
          totalScore: typeof itemAny.total_score === 'number' ? itemAny.total_score : null,
          weight: typeof itemAny.weight === 'number' ? itemAny.weight : null,
          status: typeof itemAny.score === 'number' ? 'graded' : 'pending',
        });
      }

      setRows(out);
    } catch (e) {
      setError((e as Error)?.message ?? '載入失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const graded = rows.filter((r) => r.status === 'graded' && r.score !== null && r.totalScore);
    if (graded.length === 0) return { count: rows.length, gradedCount: 0, avgPct: null };
    const totalPct = graded.reduce((acc, r) => acc + (r.score! / r.totalScore!) * 100, 0);
    return {
      count: rows.length,
      gradedCount: graded.length,
      avgPct: Math.round((totalPct / graded.length) * 10) / 10,
    };
  }, [rows]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: '#6b7280' }}>正在載入課程成績⋯⋯</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      contentContainerStyle={{ padding: 16, paddingBottom: 64 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      {/* 頂部統計 */}
      <View style={{ backgroundColor: '#1F4E78', borderRadius: 12, padding: 16 }}>
        <Text style={{ color: '#dbeafe', fontSize: 12 }}>📊 {groupName}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>
              {stats.avgPct ?? '—'}
              {stats.avgPct !== null && <Text style={{ fontSize: 14 }}>%</Text>}
            </Text>
            <Text style={{ color: '#cbd5e1', fontSize: 11 }}>已批改項目平均</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>
              {stats.gradedCount} / {stats.count}
            </Text>
            <Text style={{ color: '#cbd5e1', fontSize: 11 }}>已批改 / 總項</Text>
          </View>
        </View>
      </View>

      {error && (
        <View style={{ marginTop: 12, padding: 12, backgroundColor: '#fee2e2', borderRadius: 8 }}>
          <Text style={{ color: '#991b1b' }}>⚠️ {error}</Text>
        </View>
      )}

      {rows.length === 0 && !error ? (
        <View style={{ alignItems: 'center', padding: 32 }}>
          <Text style={{ fontSize: 48 }}>📊</Text>
          <Text style={{ color: '#6b7280', marginTop: 12, textAlign: 'center' }}>
            這門課目前還沒有任何評分項目。{'\n'}有的話會自動出現在這裡。
          </Text>
        </View>
      ) : (
        rows.map((r) => {
          const pct = r.score !== null && r.totalScore ? (r.score / r.totalScore) * 100 : null;
          const tone =
            r.status === 'graded'
              ? pct !== null && pct >= 60
                ? '#16a34a'
                : '#dc2626'
              : r.status === 'pending'
              ? '#6b7280'
              : '#dc2626';
          const catLabel =
            r.category === 'homework'
              ? '作業'
              : r.category === 'exam'
              ? '考試'
              : r.category === 'quiz'
              ? '小考'
              : '評量項';
          return (
            <View
              key={r.id}
              style={{
                marginTop: 8,
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 14,
                borderLeftWidth: 4,
                borderLeftColor: tone,
                borderWidth: 1,
                borderColor: '#e5e7eb',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <Text style={{ fontSize: 11, color: '#6b7280' }}>{catLabel}</Text>
                    {r.weight !== null && (
                      <Text style={{ fontSize: 11, color: '#6b7280' }}>權重 {r.weight}%</Text>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {r.score !== null ? (
                    <>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: tone }}>
                        {r.score}
                        {r.totalScore ? <Text style={{ fontSize: 12 }}> / {r.totalScore}</Text> : null}
                      </Text>
                      {pct !== null && (
                        <Text style={{ fontSize: 11, color: tone }}>{Math.round(pct)}%</Text>
                      )}
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>
                      {r.status === 'pending' ? '待批改' : '未繳交'}
                    </Text>
                  )}
                </View>
              </View>
              {pct !== null && (
                <View
                  style={{
                    marginTop: 6,
                    height: 4,
                    backgroundColor: '#e5e7eb',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      height: 4,
                      backgroundColor: tone,
                    }}
                  />
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}
