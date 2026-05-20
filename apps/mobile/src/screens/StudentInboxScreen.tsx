/**
 * Student Inbox — 學生收件匣
 *
 * 集中顯示所有跨角色 RoleEvent：
 *  - 老師 → 學生：新成績、評語、作業提醒、開點名
 *  - 助教 → 學生：輔導回覆
 *  - 餐廳 → 學生：訂單狀態
 *  - 主任 → 全體：系所公告
 *
 * 點 row 跳對應 screen（成績、課程、餐廳、AI 觀察台）。
 * 「全部已讀」+ 個別 dismiss。
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
} from '../ui/cockpitShell';
import {
  loadVisibleRoleEventInbox,
  clearRoleEventInbox,
  subscribeAllRoleEvents,
  type RoleEvent,
  type RoleEventKind,
} from '../services/roleEventBus';
import { safeNavigate } from '../utils/safeNavigate';

type Filter = 'all' | 'teacher' | 'vendor' | 'department';

function eventMeta(kind: RoleEventKind): { emoji: string; label: string; source: 'teacher' | 'vendor' | 'department' | 'other' } {
  switch (kind) {
    case 'grade_published': return { emoji: '📊', label: '新成績', source: 'teacher' };
    case 'feedback_drafted': return { emoji: '✏️', label: '老師評語', source: 'teacher' };
    case 'bulk_reminder_sent': return { emoji: '⏰', label: '作業提醒', source: 'teacher' };
    case 'attendance_session_opened': return { emoji: '✅', label: '老師開點名中', source: 'teacher' };
    case 'announcement_posted': return { emoji: '📣', label: '課程公告', source: 'teacher' };
    case 'homework_published': return { emoji: '📋', label: '新作業', source: 'teacher' };
    case 'peer_review_assigned': return { emoji: '🤝', label: '互評指派', source: 'teacher' };
    case 'order_status_changed': return { emoji: '🍱', label: '訂單狀態', source: 'vendor' };
    case 'order_placed': return { emoji: '🛒', label: '訂單已下', source: 'vendor' };
    case 'department_broadcast': return { emoji: '🏛', label: '系所廣播', source: 'department' };
    default: return { emoji: '🔔', label: '通知', source: 'other' };
  }
}

export default function StudentInboxScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const [events, setEvents] = useState<RoleEvent<unknown>[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const reload = useCallback(async () => {
    if (!auth.user?.uid) return;
    const e = await loadVisibleRoleEventInbox({
      uid: auth.user.uid,
      role: auth.profile?.role,
    });
    setEvents(e);
  }, [auth.profile?.role, auth.user?.uid]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 即時訂閱新事件
  useEffect(() => {
    const unsub = subscribeAllRoleEvents(() => {
      reload();
    });
    return () => { try { unsub(); } catch { /* noop */ } };
  }, [reload]);

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const handleClear = async () => {
    if (!auth.user?.uid) return;
    await clearRoleEventInbox(auth.user.uid);
    setEvents([]);
  };

  const filtered = events.filter((e) => {
    if (filter === 'all') return true;
    return eventMeta(e.kind).source === filter;
  });

  // 統計
  const counts = {
    teacher: events.filter((e) => eventMeta(e.kind).source === 'teacher').length,
    vendor: events.filter((e) => eventMeta(e.kind).source === 'vendor').length,
    department: events.filter((e) => eventMeta(e.kind).source === 'department').length,
  };

  const onPressEvent = (evt: RoleEvent<unknown>) => {
    const p = evt.payload as any;
    switch (evt.kind) {
      case 'grade_published':
        safeNavigate(navigation, 'CourseScores', {
          groupId: String(evt.courseId),
          groupName: evt.courseName,
        }, { fallbackMessage: '即將跳到成績頁' });
        break;
      case 'feedback_drafted':
        safeNavigate(navigation, 'CourseScores', {
          groupId: String(evt.courseId),
          groupName: evt.courseName,
        }, { fallbackMessage: '即將跳到課程' });
        break;
      case 'attendance_session_opened':
        safeNavigate(navigation, 'AttendanceLive', {
          sessionId: p.sessionId,
          isTeacher: false,
        }, { fallbackMessage: '即將跳到簽到頁' });
        break;
      case 'order_status_changed':
      case 'order_placed':
        safeNavigate(navigation, '校園生活', undefined, { fallbackMessage: '即將跳到校園生活' });
        break;
      case 'department_broadcast':
        navigation.navigate?.('Announcements');
        break;
      case 'bulk_reminder_sent':
      case 'homework_published':
        safeNavigate(navigation, 'HomeworkSubmit', {
          courseId: String(evt.courseId),
          hwId: String(p.homeworkId ?? '1'),
          hwTitle: p.homeworkTitle ?? '作業',
        }, { fallbackMessage: '即將跳到作業頁' });
        break;
      default:
        break;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow="跨角色收件匣"
          title={`📥 我的 Inbox`}
          summary={
            events.length === 0
              ? '目前沒有新動態。試著切到老師 / 餐廳 demo 帳號做點動作再回來。'
              : `共 ${events.length} 則動態。老師 ${counts.teacher} · 餐廳 ${counts.vendor} · 系所 ${counts.department}`
          }
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="總數" value={events.length} />
          <CockpitMetricChip label="老師" value={counts.teacher} tone={counts.teacher > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="餐廳" value={counts.vendor} />
          <CockpitMetricChip label="系所" value={counts.department} />
        </CockpitMetricRow>

        {/* Filter chips */}
        <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginBottom: theme.space.md, flexWrap: 'wrap' }}>
          {(['all', 'teacher', 'vendor', 'department'] as const).map((f) => {
            const active = filter === f;
            const label = f === 'all' ? '全部' : f === 'teacher' ? '👨‍🏫 老師' : f === 'vendor' ? '🍱 餐廳' : '🏛 系所';
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.sm + 4,
                  paddingVertical: theme.space.xs + 4,
                  borderRadius: theme.radius.full,
                  backgroundColor: active ? theme.colors.text : theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{
                  color: active ? theme.colors.bg : theme.colors.text,
                  fontSize: 13,
                  fontWeight: '600',
                }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          {events.length > 0 && (
            <Pressable
              onPress={handleClear}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.sm + 4,
                paddingVertical: theme.space.xs + 4,
                borderRadius: theme.radius.full,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>清空</Text>
            </Pressable>
          )}
        </View>

        {/* Event list */}
        {filtered.length === 0 ? (
          <View style={{ paddingVertical: theme.space.xxl, alignItems: 'center' }}>
            <Text style={{ fontSize: 48 }}>📭</Text>
            <Text style={{
              color: theme.colors.text,
              fontSize: theme.typography.h3.fontSize,
              fontWeight: '600',
              marginTop: theme.space.md,
            }}>
              此分類沒有訊息
            </Text>
            <Text style={{
              color: theme.colors.muted,
              fontSize: theme.typography.bodySmall.fontSize,
              marginTop: theme.space.xs,
            }}>
              切換到老師 demo 帳號開點名、批改作業，就會看到動態。
            </Text>
          </View>
        ) : (
          filtered.map((evt) => {
            const meta = eventMeta(evt.kind);
            const p = evt.payload as any;
            const preview = (() => {
              if (evt.kind === 'grade_published') return `${p.itemTitle ?? '評分'} ${p.score}/${p.totalScore}`;
              if (evt.kind === 'feedback_drafted') return p.homeworkTitle ?? '評語';
              if (evt.kind === 'bulk_reminder_sent' || evt.kind === 'homework_published') return p.homeworkTitle ?? '作業';
              if (evt.kind === 'attendance_session_opened') return `教室 ${p.classroomLocation ?? '—'} · ${p.method}`;
              if (evt.kind === 'order_status_changed') return p.message ?? p.newStatus;
              if (evt.kind === 'order_placed') return `${p.merchantName} · $${p.total}`;
              if (evt.kind === 'department_broadcast') return p.title ?? p.body;
              if (evt.kind === 'announcement_posted') return p.title;
              if (evt.kind === 'peer_review_assigned') return p.targetCount ? `${p.targetCount} 份互評` : '互評';
              return JSON.stringify(p).slice(0, 30);
            })();
            const when = new Date(evt.occurredAt);
            const ago = Math.round((Date.now() - when.getTime()) / 60_000);
            const ageLabel = ago < 1 ? '剛剛' : ago < 60 ? `${ago} 分前` : ago < 60 * 24 ? `${Math.round(ago / 60)} 小時前` : when.toLocaleDateString('zh-TW');

            return (
              <Pressable
                key={evt.id}
                onPress={() => onPressEvent(evt)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  marginBottom: theme.space.sm,
                  alignItems: 'flex-start',
                  gap: theme.space.sm,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 22 }}>{meta.emoji}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 }}>
                      {meta.label}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{ageLabel}</Text>
                  </View>
                  <Text style={{ color: theme.colors.text, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                    {preview}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                    {evt.actorName} · {evt.courseName}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
