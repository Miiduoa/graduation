/**
 * Life Requests — 學生「請假 / 宿舍報修」統一頁
 *
 * 兩個 tab：
 *  - 請假申請（病假 / 事假 / 公假 / 喪假）→ emit leave_requested → 老師審核
 *  - 宿舍報修（冷氣 / 水電 / 家具 / 門 / 其他）→ emit dorm_repair_requested → 主任 / 宿舍系統
 *
 * 提交後即時顯示在 inbox + demoUserStories 內。
 * 純前端 demo：沒有真實後端，全部走 RoleEvent bus。
 */
import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';
import {
  emitLeaveRequested,
  emitDormRepairRequested,
  type LeaveRequestedPayload,
  type DormRepairRequestedPayload,
} from '../services/roleEventBus';
import { getDemoUserStory } from '../data/demoUserStories';

const LEAVE_CATEGORIES: Array<{ id: LeaveRequestedPayload['category']; label: string; emoji: string }> = [
  { id: 'sick', label: '病假', emoji: '🤒' },
  { id: 'personal', label: '事假', emoji: '📅' },
  { id: 'official', label: '公假', emoji: '🏛' },
  { id: 'bereavement', label: '喪假', emoji: '🕯' },
];

const REPAIR_CATEGORIES: Array<{ id: DormRepairRequestedPayload['category']; label: string; emoji: string }> = [
  { id: 'ac', label: '冷氣', emoji: '❄️' },
  { id: 'plumbing', label: '水電', emoji: '🚰' },
  { id: 'electric', label: '電燈/插座', emoji: '💡' },
  { id: 'furniture', label: '家具', emoji: '🪑' },
  { id: 'door', label: '門鎖/門禁', emoji: '🚪' },
  { id: 'other', label: '其他', emoji: '🔧' },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}
function plusDaysString(d: number) {
  return new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
}

export default function LifeRequestsScreen() {
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const [tab, setTab] = useState<'leave' | 'repair'>('leave');

  // 請假 form
  const [leaveCategory, setLeaveCategory] = useState<LeaveRequestedPayload['category']>('sick');
  const [leaveFrom, setLeaveFrom] = useState(todayString());
  const [leaveTo, setLeaveTo] = useState(todayString());
  const [leaveReason, setLeaveReason] = useState('');

  // 報修 form
  const [repairCategory, setRepairCategory] = useState<DormRepairRequestedPayload['category']>('ac');
  const [repairTitle, setRepairTitle] = useState('');
  const [repairDesc, setRepairDesc] = useState('');
  const [repairUrgency, setRepairUrgency] = useState<DormRepairRequestedPayload['urgency']>('medium');

  const story = auth.user?.uid ? getDemoUserStory(auth.user.uid) : null;
  const dorm = story?.dorm;

  const submitLeave = async () => {
    if (!leaveReason.trim()) {
      Alert.alert('請輸入請假原因');
      return;
    }
    if (new Date(leaveTo).getTime() < new Date(leaveFrom).getTime()) {
      Alert.alert('結束日期必須在開始日期之後');
      return;
    }
    try {
      const leaveId = `leave_${Date.now()}`;
      await emitLeaveRequested({
        actorUid: auth.user?.uid ?? 'demo_student_kuchih',
        actorName: auth.profile?.displayName ?? '顧晉瑋',
        targetUids: ['demo_teacher_chang', 'demo_admin_huang'],
        courseId: 'leave',
        courseName: '請假申請',
        payload: {
          leaveId,
          studentName: auth.profile?.displayName ?? '顧晉瑋',
          category: leaveCategory,
          fromDate: leaveFrom,
          toDate: leaveTo,
          reason: leaveReason.trim(),
        },
      });
      Alert.alert(
        '✅ 請假已送出',
        `老師會收到通知並審核。\n核准/駁回結果會 push 到你的 inbox。`,
      );
      setLeaveReason('');
    } catch (e) {
      Alert.alert('送出失敗', String(e));
    }
  };

  const submitRepair = async () => {
    if (!repairTitle.trim() || !repairDesc.trim()) {
      Alert.alert('請輸入標題與說明');
      return;
    }
    if (!dorm) {
      Alert.alert('你不是住宿生', '此功能僅限住宿同學使用。');
      return;
    }
    try {
      const repairId = `repair_${Date.now()}`;
      await emitDormRepairRequested({
        actorUid: auth.user?.uid ?? 'demo_student_kuchih',
        actorName: auth.profile?.displayName ?? '顧晉瑋',
        targetUids: ['demo_admin_huang'],
        courseId: 'dorm',
        courseName: '宿舍維修',
        payload: {
          repairId,
          building: dorm.building,
          room: dorm.room,
          category: repairCategory,
          title: repairTitle.trim(),
          description: repairDesc.trim(),
          urgency: repairUrgency,
        },
      });
      Alert.alert(
        '🔧 報修已送出',
        `${dorm.building} ${dorm.room}\n${repairTitle}\n\n宿舍管理員會儘速安排維修。`,
      );
      setRepairTitle('');
      setRepairDesc('');
    } catch (e) {
      Alert.alert('送出失敗', String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.layout.screenHorizontalPadding,
            paddingTop: theme.space.md,
            paddingBottom: bottomPad,
          }}
          showsVerticalScrollIndicator={false}
        >
          <CockpitHero
            eyebrow="生活事務"
            title={tab === 'leave' ? '📝 請假申請' : '🔧 宿舍報修'}
            summary={
              tab === 'leave'
                ? '送出後老師會收到通知並審核，核准/駁回結果回到你的 inbox。'
                : dorm
                  ? `你的宿舍：${dorm.building} ${dorm.room}（${dorm.recentRepairs.length} 筆歷史紀錄）`
                  : '你不是住宿生，宿舍報修功能僅供住宿同學使用。'
            }
          />

          {/* Tab switcher */}
          <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginBottom: theme.space.md }}>
            {(['leave', 'repair'] as const).map((t) => {
              const active = tab === t;
              const label = t === 'leave' ? '📝 請假' : '🔧 報修';
              return (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: theme.space.sm + 2,
                    borderRadius: theme.radius.md,
                    backgroundColor: active ? theme.colors.text : theme.colors.surface,
                    alignItems: 'center',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{
                    color: active ? theme.colors.bg : theme.colors.text,
                    fontWeight: '700',
                    fontSize: 14,
                  }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'leave' && (
            <View style={{ gap: theme.space.md }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3 }}>
                假別
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
                {LEAVE_CATEGORIES.map((c) => {
                  const active = leaveCategory === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setLeaveCategory(c.id)}
                      style={({ pressed }) => ({
                        paddingHorizontal: theme.space.md,
                        paddingVertical: theme.space.xs + 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: active ? theme.colors.accent : theme.colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{
                        color: active ? theme.colors.onAccent : theme.colors.text,
                        fontSize: 13,
                        fontWeight: '600',
                      }}>
                        {c.emoji} {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3, marginTop: theme.space.xs }}>
                日期區間 (YYYY-MM-DD)
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' }}>
                <TextInput
                  value={leaveFrom}
                  onChangeText={setLeaveFrom}
                  placeholder={todayString()}
                  placeholderTextColor={theme.colors.muted}
                  style={inputStyle()}
                />
                <Text style={{ color: theme.colors.muted }}>—</Text>
                <TextInput
                  value={leaveTo}
                  onChangeText={setLeaveTo}
                  placeholder={plusDaysString(1)}
                  placeholderTextColor={theme.colors.muted}
                  style={inputStyle()}
                />
              </View>

              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3, marginTop: theme.space.xs }}>
                請假原因
              </Text>
              <TextInput
                value={leaveReason}
                onChangeText={setLeaveReason}
                placeholder="例：感冒發燒 38.5 度，需要在宿舍休息。"
                placeholderTextColor={theme.colors.muted}
                multiline
                numberOfLines={4}
                style={{
                  ...inputStyle(),
                  minHeight: 100,
                  textAlignVertical: 'top',
                }}
              />

              <Pressable
                onPress={submitLeave}
                style={({ pressed }) => ({
                  padding: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.text,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                  marginTop: theme.space.sm,
                })}
              >
                <Text style={{ color: theme.colors.bg, fontWeight: '700', fontSize: 14 }}>
                  送出請假申請
                </Text>
              </Pressable>
            </View>
          )}

          {tab === 'repair' && (
            <View style={{ gap: theme.space.md }}>
              {/* 我的宿舍資訊 */}
              {dorm ? (
                <View
                  style={{
                    padding: theme.space.md,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface,
                    borderLeftWidth: 3,
                    borderLeftColor: theme.colors.accent,
                  }}
                >
                  <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                    我的宿舍
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.text }}>
                    🏠 {dorm.building} {dorm.room}（{dorm.floor}F · {dorm.roomType === 'quad' ? '4 人房' : dorm.roomType === 'double' ? '雙人房' : '單人房'}）
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    padding: theme.space.md,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    你目前沒有宿舍紀錄。報修功能僅限住宿同學。
                  </Text>
                </View>
              )}

              <CockpitMetricRow>
                <CockpitMetricChip
                  label="歷史報修"
                  value={dorm?.recentRepairs.length ?? 0}
                />
                <CockpitMetricChip
                  label="處理中"
                  value={dorm?.recentRepairs.filter((r) => r.status !== 'completed').length ?? 0}
                  tone={(dorm?.recentRepairs.filter((r) => r.status !== 'completed').length ?? 0) > 0 ? 'warn' : undefined}
                />
              </CockpitMetricRow>

              {/* 報修分類 */}
              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3 }}>
                報修類型
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
                {REPAIR_CATEGORIES.map((c) => {
                  const active = repairCategory === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setRepairCategory(c.id)}
                      style={({ pressed }) => ({
                        paddingHorizontal: theme.space.sm + 2,
                        paddingVertical: theme.space.xs + 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: active ? theme.colors.accent : theme.colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{
                        color: active ? theme.colors.onAccent : theme.colors.text,
                        fontSize: 12,
                        fontWeight: '600',
                      }}>
                        {c.emoji} {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3, marginTop: theme.space.xs }}>
                標題
              </Text>
              <TextInput
                value={repairTitle}
                onChangeText={setRepairTitle}
                placeholder="例：A215 冷氣不冷"
                placeholderTextColor={theme.colors.muted}
                style={inputStyle()}
              />

              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3, marginTop: theme.space.xs }}>
                詳細說明
              </Text>
              <TextInput
                value={repairDesc}
                onChangeText={setRepairDesc}
                placeholder="例：開機 30 分鐘後出風口溫度仍是熱風，遙控器顯示 18 度。"
                placeholderTextColor={theme.colors.muted}
                multiline
                numberOfLines={4}
                style={{
                  ...inputStyle(),
                  minHeight: 100,
                  textAlignVertical: 'top',
                }}
              />

              <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3, marginTop: theme.space.xs }}>
                急迫程度
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.space.xs }}>
                {(['low', 'medium', 'high'] as const).map((u) => {
                  const active = repairUrgency === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => setRepairUrgency(u)}
                      style={({ pressed }) => ({
                        flex: 1,
                        paddingVertical: theme.space.sm,
                        borderRadius: theme.radius.md,
                        backgroundColor: active ? theme.colors.text : theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.colors.border,
                        alignItems: 'center',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{
                        color: active ? theme.colors.bg : theme.colors.text,
                        fontSize: 12,
                        fontWeight: '700',
                      }}>
                        {u === 'low' ? '不急' : u === 'medium' ? '一般' : '緊急'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={submitRepair}
                disabled={!dorm}
                style={({ pressed }) => ({
                  padding: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: dorm ? theme.colors.text : theme.colors.surface,
                  alignItems: 'center',
                  opacity: !dorm ? 0.5 : pressed ? 0.85 : 1,
                  marginTop: theme.space.sm,
                })}
              >
                <Text style={{
                  color: dorm ? theme.colors.bg : theme.colors.muted,
                  fontWeight: '700',
                  fontSize: 14,
                }}>
                  送出報修
                </Text>
              </Pressable>

              {/* 歷史報修 */}
              {dorm && dorm.recentRepairs.length > 0 && (
                <View style={{ marginTop: theme.space.lg }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, letterSpacing: 0.3, marginBottom: theme.space.xs }}>
                    最近報修紀錄
                  </Text>
                  {dorm.recentRepairs.map((r) => (
                    <View
                      key={r.id}
                      style={{
                        padding: theme.space.sm + 2,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.colors.border,
                        marginBottom: theme.space.xs,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text }}>
                        {r.title}
                      </Text>
                      <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 2 }}>
                        {r.status === 'completed' ? '✅ 已完成' : r.status === 'in_progress' ? '🔧 處理中' : '🟡 等待處理'}
                        {' · '}
                        {new Date(r.submittedAt).toLocaleDateString('zh-TW')}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function inputStyle() {
  return {
    flex: 1,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm + 2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: 14,
  };
}
