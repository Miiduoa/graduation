/**
 * My Quiz Scores Screen — 學生個人所有測驗成績總覽
 *
 * 跨所有課程列每份 quiz / exam 的：分數 / 滿分 / 提交時間 / 通過與否 / 加權佔比
 * 資料源：tcFetchCourses → 對每門課呼 tcFetchCourseExams → tcFetchExamSubmissions
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { safeNavigate } from '../utils/safeNavigate';

import {
  tcFetchCourses,
  tcFetchCourseExams,
  tcFetchExamSubmissions,
  type TCExamInfo,
} from '../services/tronClassClient';

interface ExamRow {
  courseName: string;
  courseId: number;
  exam: TCExamInfo;
  score: number | null;
  percentage: number | null;
  total: number | null;
}

export default function MyQuizScoresScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ExamRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'quiz' | 'exam'>('all');

  const load = useCallback(async () => {
    try {
      const courses = await tcFetchCourses();
      const collected: ExamRow[] = [];
      for (const c of courses) {
        try {
          const exams = await tcFetchCourseExams(c.id);
          for (const e of exams) {
            const sub = await tcFetchExamSubmissions(e.id).catch(() => null);
            const score = sub?.exam_final_score ?? sub?.exam_score ?? null;
            collected.push({
              courseName: c.name,
              courseId: c.id,
              exam: e,
              score,
              total: e.total_score,
              percentage: typeof score === 'number' && e.total_score ? (score / e.total_score) * 100 : null,
            });
          }
        } catch {
          /* 跳過該課 */
        }
      }
      setRows(collected);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.exam.type === filter);
  }, [rows, filter]);

  const stats = useMemo(() => {
    const graded = filtered.filter((r) => r.percentage !== null);
    if (graded.length === 0) return { count: filtered.length, gradedCount: 0, avg: null };
    const avg = graded.reduce((acc, r) => acc + (r.percentage ?? 0), 0) / graded.length;
    return {
      count: filtered.length,
      gradedCount: graded.length,
      avg: Math.round(avg * 10) / 10,
    };
  }, [filtered]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: '#8E8E93' }}>正在從所有課程拉測驗成績⋯⋯</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#F2F2F7' }}
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
      {/* 統計卡 */}
      <View
        style={{
          backgroundColor: '#003F8A',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <Text style={{ color: '#E5F2FF', fontSize: 12 }}>📊 我的測驗成績總覽</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>
              {stats.avg ?? '—'}
              {stats.avg !== null && <Text style={{ fontSize: 14 }}>分</Text>}
            </Text>
            <Text style={{ color: '#E5E5EA', fontSize: 11 }}>平均（百分比）</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>
              {stats.gradedCount} / {stats.count}
            </Text>
            <Text style={{ color: '#E5E5EA', fontSize: 11 }}>已批改 / 總數</Text>
          </View>
        </View>
      </View>

      {/* filter tabs */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        {(['all', 'quiz', 'exam'] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              backgroundColor: filter === f ? '#003F8A' : '#fff',
              borderWidth: 1,
              borderColor: filter === f ? '#003F8A' : '#E5E5EA',
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: filter === f ? '#fff' : '#1C1C1E',
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {f === 'all' ? '全部' : f === 'quiz' ? '小考' : '考試'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 32, gap: 8 }}>
          <Text style={{ fontSize: 48 }}>📝</Text>
          <Text style={{ color: '#8E8E93', fontSize: 14, textAlign: 'center' }}>
            還沒有任何測驗成績。{'\n'}有的話會自動出現在這裡。
          </Text>
        </View>
      ) : (
        filtered.map((r, i) => {
          const pass = (r.percentage ?? 0) >= 60;
          const tone =
            r.percentage === null ? '#8E8E93' : pass ? '#34C759' : '#D70015';
          return (
            <Pressable
              key={`${r.courseId}-${r.exam.id}`}
              onPress={() =>
                safeNavigate(navigation, 'CourseModules', {
                  groupId: String(r.courseId),
                  groupName: r.courseName,
                }, { fallbackMessage: '即將跳到課程教材' })
              }
              style={{
                marginTop: 10,
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 14,
                borderWidth: 1,
                borderColor: '#E5E5EA',
                borderLeftWidth: 4,
                borderLeftColor: tone,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }} numberOfLines={1}>
                    {r.exam.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                    {r.courseName} ・ {r.exam.type === 'exam' ? '考試' : '小考'}
                  </Text>
                  {r.exam.end_time && (
                    <Text style={{ fontSize: 11, color: '#AEAEB2', marginTop: 2 }}>
                      截止 {new Date(r.exam.end_time).toLocaleString('zh-TW')}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {r.score !== null ? (
                    <>
                      <Text style={{ fontSize: 24, fontWeight: '700', color: tone }}>
                        {r.score}
                        {r.total ? <Text style={{ fontSize: 12 }}> / {r.total}</Text> : null}
                      </Text>
                      {r.percentage !== null && (
                        <Text style={{ fontSize: 11, color: tone }}>
                          {Math.round(r.percentage)}%
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#AEAEB2' }}>
                      {r.exam.is_closed ? '未繳' : '待批改'}
                    </Text>
                  )}
                </View>
              </View>
              {/* 進度條 */}
              {r.percentage !== null && (
                <View
                  style={{
                    marginTop: 8,
                    height: 4,
                    backgroundColor: '#E5E5EA',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(100, r.percentage)}%`,
                      height: 4,
                      backgroundColor: tone,
                    }}
                  />
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}
