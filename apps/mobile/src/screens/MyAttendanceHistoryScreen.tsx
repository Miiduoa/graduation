/**
 * My Attendance History — 學生個人所有課程的點名紀錄總覽
 *
 * 跨所有課程列：出席率、缺席請假紀錄、遲到分佈、智慧分析（attendanceEngine.analyzePattern）
 * 資料源：tcFetchCourses → listAttendanceSessions(courseId) → records 子集合
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
  analyzeAttendancePattern,
  type AttendancePatternSnapshot,
} from '@campus/shared';
import { tcFetchCourses } from '../services/tronClassClient';
import { listAttendanceSessions } from '../data/courseSpaceSource';
import {
  demoFetchCourses,
  demoListAttendanceSessions,
  isDemoCourseId,
} from '../data/demoCoursesAdapter';

interface CourseAttendance {
  courseId: number;
  courseName: string;
  totalSessions: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  pattern: ReturnType<typeof analyzeAttendancePattern>;
}

export default function MyAttendanceHistoryScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<CourseAttendance[]>([]);

  const load = useCallback(async () => {
    try {
      // 先試 TronClass；若沒有任何課程，fallback 到 5 門 demo
      let courses: Array<{ id: number; name: string }> = [];
      try {
        const tcCourses = await tcFetchCourses();
        courses = tcCourses.map((c) => ({ id: c.id, name: c.name }));
      } catch {
        /* fall through to demo */
      }
      if (courses.length === 0) {
        courses = demoFetchCourses().map((c) => ({ id: c.id, name: c.name }));
      }

      const all: CourseAttendance[] = [];
      for (const c of courses) {
        try {
          // demo course → 用 mock attendance；否則打 TronClass workspace
          const useDemo = isDemoCourseId(c.id);
          const sessions = useDemo
            ? demoListAttendanceSessions(c.id).map((s) => ({
                id: s.id,
                startedAt: s.startedAt,
                active: s.active,
                attendeeCount: s.attendeeCount,
                myStatus: s.myStatus,
              }))
            : (await listAttendanceSessions(String(c.id))).map((s) => ({
                id: s.id,
                startedAt: s.startedAt,
                active: s.active,
                attendeeCount: s.attendeeCount,
                myStatus: null,
              }));

          const records: AttendancePatternSnapshot[] = sessions.map((s) => ({
            sessionId: s.id,
            classStartAt: s.startedAt?.toISOString() ?? new Date().toISOString(),
            status: (s.myStatus as 'present' | 'late' | 'absent' | 'excused' | null) ?? 'present',
          }));
          const pattern = analyzeAttendancePattern(records);
          all.push({
            courseId: c.id,
            courseName: c.name,
            totalSessions: sessions.length,
            presentCount: records.filter((r) => r.status === 'present').length,
            lateCount: records.filter((r) => r.status === 'late').length,
            absentCount: records.filter((r) => r.status === 'absent').length,
            pattern,
          });
        } catch {
          /* skip */
        }
      }
      setData(all);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalStats = useMemo(() => {
    let total = 0;
    let present = 0;
    let late = 0;
    let absent = 0;
    const allAlerts: ReturnType<typeof analyzeAttendancePattern>['alerts'] = [];
    for (const c of data) {
      total += c.totalSessions;
      present += c.presentCount;
      late += c.lateCount;
      absent += c.absentCount;
      allAlerts.push(...c.pattern.alerts.map((a) => ({ ...a, message: `${c.courseName}：${a.message}` })));
    }
    const rate = total > 0 ? Math.round(((present + late) / total) * 1000) / 10 : null;
    return { total, present, late, absent, rate, alerts: allAlerts };
  }, [data]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: '#8E8E93' }}>正在拉所有課的點名紀錄⋯⋯</Text>
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
      {/* 總覽卡 */}
      <View
        style={{
          backgroundColor: '#003F8A',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <Text style={{ color: '#E5F2FF', fontSize: 12 }}>✅ 我的點名紀錄總覽</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>
              {totalStats.rate ?? '—'}
              {totalStats.rate !== null && <Text style={{ fontSize: 14 }}>%</Text>}
            </Text>
            <Text style={{ color: '#E5E5EA', fontSize: 11 }}>整體出席率</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>
              {totalStats.total}
            </Text>
            <Text style={{ color: '#E5E5EA', fontSize: 11 }}>總點名次數</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
          <Text style={{ color: '#86efac', fontSize: 12 }}>✓ 出席 {totalStats.present}</Text>
          <Text style={{ color: '#fcd34d', fontSize: 12 }}>⏰ 遲到 {totalStats.late}</Text>
          <Text style={{ color: '#fca5a5', fontSize: 12 }}>✗ 缺席 {totalStats.absent}</Text>
        </View>
      </View>

      {/* 智慧分析警示 */}
      {totalStats.alerts.length > 0 && (
        <View
          style={{
            marginTop: 16,
            padding: 12,
            backgroundColor: '#fef3c7',
            borderRadius: 12,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#92400e' }}>
            🧠 智慧分析提醒
          </Text>
          {totalStats.alerts.map((a, i) => (
            <Text
              key={i}
              style={{
                fontSize: 12,
                color: a.severity === 'high' ? '#991b1b' : '#78350f',
                marginTop: 4,
              }}
            >
              {a.severity === 'high' ? '🔥 ' : a.severity === 'medium' ? '⚠️ ' : '・'}
              {a.message}
            </Text>
          ))}
        </View>
      )}

      {/* 各課明細 */}
      <Text style={{ marginTop: 20, marginBottom: 8, fontSize: 16, fontWeight: '700', color: '#1C1C1E' }}>
        各課程出席狀況
      </Text>

      {data.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 32, gap: 8 }}>
          <Text style={{ fontSize: 48 }}>📋</Text>
          <Text style={{ color: '#8E8E93', fontSize: 14, textAlign: 'center' }}>
            目前還沒有任何點名紀錄
          </Text>
        </View>
      ) : (
        data.map((c) => {
          const rate = c.totalSessions > 0
            ? (c.presentCount + c.lateCount) / c.totalSessions
            : 0;
          const tone = rate >= 0.9 ? '#34C759' : rate >= 0.7 ? '#FF9500' : '#D70015';
          return (
            <Pressable
              key={c.courseId}
              onPress={() =>
                safeNavigate(navigation, 'AttendanceMultiMethod', {
                  courseId: String(c.courseId),
                  sessionId: `demo-${c.courseId}`,
                }, { fallbackMessage: '即將跳到簽到頁' })
              }
              style={{
                marginTop: 8,
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 14,
                borderWidth: 1,
                borderColor: '#E5E5EA',
                borderLeftWidth: 4,
                borderLeftColor: tone,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E', flex: 1 }} numberOfLines={1}>
                  {c.courseName}
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: tone }}>
                  {Math.round(rate * 100)}%
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                <Text style={{ fontSize: 11, color: '#34C759' }}>✓ {c.presentCount}</Text>
                <Text style={{ fontSize: 11, color: '#FF9500' }}>⏰ {c.lateCount}</Text>
                <Text style={{ fontSize: 11, color: '#D70015' }}>✗ {c.absentCount}</Text>
                <Text style={{ fontSize: 11, color: '#8E8E93' }}>共 {c.totalSessions} 次</Text>
              </View>
              {c.pattern.alerts.length > 0 && (
                <Text style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                  {c.pattern.alerts[0].message}
                </Text>
              )}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}
