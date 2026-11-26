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
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { safeNavigate } from '../utils/safeNavigate';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

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
  useThemeVersion();
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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={{ marginTop: 8, color: theme.colors.muted, fontSize: 13 }}>
          正在從所有課程拉測驗成績⋯⋯
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: theme.layout.screenHorizontalPadding,
        paddingTop: 16,
        paddingBottom: 64,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.accent}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      {/* 成績總覽 */}
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.textSecondary,
            fontSize: 12,
            fontWeight: '600',
            letterSpacing: 0.4,
          }}
        >
          我的測驗成績總覽
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginTop: 10,
          }}
        >
          <View>
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}>
              {stats.avg ?? '—'}
              {stats.avg !== null && (
                <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}> 分</Text>
              )}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              平均（百分比）
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>
              {stats.gradedCount} / {stats.count}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              已批改 / 總數
            </Text>
          </View>
        </View>
      </View>

      {/* 類型篩選 */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        {(['all', 'quiz', 'exam'] as const).map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: theme.radius.md,
                backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                borderWidth: 1,
                borderColor: active ? theme.colors.accent : theme.colors.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: active ? theme.colors.onAccent : theme.colors.text,
                  fontWeight: active ? '700' : '600',
                  fontSize: 13,
                }}
              >
                {f === 'all' ? '全部' : f === 'quiz' ? '小考' : '考試'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 測驗紀錄列表 */}
      <Text
        accessibilityRole="header"
        style={{
          marginTop: 20,
          marginBottom: 8,
          color: theme.colors.textSecondary,
          fontSize: 12,
          fontWeight: '600',
          letterSpacing: 0.4,
        }}
      >
        測驗紀錄（{filtered.length}）
      </Text>

      {filtered.length === 0 ? (
        <View
          style={{
            alignItems: 'center',
            paddingVertical: 32,
            paddingHorizontal: 16,
            gap: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.separator,
          }}
        >
          <Ionicons name="document-text-outline" size={32} color={theme.colors.muted} />
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 21,
            }}
          >
            還沒有任何測驗成績。{'\n'}有的話會自動出現在這裡。
          </Text>
        </View>
      ) : (
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            overflow: 'hidden',
          }}
        >
          {filtered.map((r, i) => {
            const pass = (r.percentage ?? 0) >= 60;
            const tone =
              r.percentage === null
                ? theme.colors.muted
                : pass
                  ? theme.colors.success
                  : theme.colors.danger;
            return (
              <Pressable
                key={`${r.courseId}-${r.exam.id}`}
                onPress={() =>
                  safeNavigate(
                    navigation,
                    'CourseModules',
                    {
                      groupId: String(r.courseId),
                      groupName: r.courseName,
                    },
                    { fallbackMessage: '即將跳到課程教材' },
                  )
                }
                accessibilityRole="button"
                style={({ pressed }) => ({
                  padding: 14,
                  backgroundColor: pressed ? theme.colors.surfaceInteractive : theme.colors.surface,
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.separator,
                })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}
                      numberOfLines={1}
                    >
                      {r.exam.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                      {r.courseName} · {r.exam.type === 'exam' ? '考試' : '小考'}
                    </Text>
                    {r.exam.end_time && (
                      <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 2 }}>
                        截止 {new Date(r.exam.end_time).toLocaleString('zh-TW')}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {r.score !== null ? (
                      <>
                        <Text style={{ fontSize: 20, fontWeight: '700', color: tone }}>
                          {r.score}
                          {r.total ? (
                            <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                              {' '}
                              / {r.total}
                            </Text>
                          ) : null}
                        </Text>
                        {r.percentage !== null && (
                          <Text style={{ fontSize: 11, color: tone, fontWeight: '600' }}>
                            {Math.round(r.percentage)}%
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                        {r.exam.is_closed ? '未繳' : '待批改'}
                      </Text>
                    )}
                  </View>
                </View>
                {/* 進度條 */}
                {r.percentage !== null && (
                  <View
                    style={{
                      marginTop: 10,
                      height: 4,
                      backgroundColor: theme.colors.surface3,
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
          })}
        </View>
      )}
    </ScrollView>
  );
}
