/**
 * DemoRolePill — 跨平台角色快速切換 pill
 *
 * 對齊 apps/web/src/components/DemoRolePill.tsx：右上角永遠看得到的「目前角色」膠囊，
 * 點開後顯示 8 角色清單，一鍵切換並重新 seed inbox。
 *
 * Mobile 端用 Modal 列出所有角色；按一下角色 → 寫 mockAuth → refreshProfile，
 * 由 RoleAwareTodayScreen 自動 dispatch 到對應 dashboard。
 */
import React, { useCallback, useState } from 'react';
import { Pressable, View, Text, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme, softShadowStyle } from '../ui/theme';
import { useAuth, type UserRole } from '../state/auth';
import { useDemoRole, type DemoRole } from '../state/demoRole';
import {
  saveMockAuthSession,
  loadMockAuthSession,
  clearMockAuthSession,
} from '../services/mockAuth';
import { clearRoleEventInbox } from '../services/roleEventBus';
import { resetSeedFlag, seedDemoInboxIfNeeded } from '../services/demoInboxSeeder';

interface RolePreset {
  role: UserRole;
  uid: string;
  email: string;
  displayName: string;
  schoolId: string;
  department: string;
  studentId?: string;
  icon: keyof typeof Ionicons.glyphMap;
  shortLabel: string;
  hint: string;
  color: string;
}

// 與 LoginLandingScreen 的 DEMO_PRESETS 同步（但這裡用 shortLabel 顯示）
const ROLE_PRESETS: RolePreset[] = [
  {
    role: 'student',
    uid: 'demo_student_kuchih',
    email: 'demo.student@pu.edu.tw',
    displayName: '顧晉瑋（demo 學生）',
    schoolId: 'pu',
    department: '資訊管理學系',
    studentId: '411211325',
    icon: 'person-outline',
    shortLabel: '學生',
    hint: '課表、作業、AI 學伴',
    color: '#5856D6',
  },
  {
    role: 'teacher',
    uid: 'demo_teacher_chang',
    email: 'demo.teacher@pu.edu.tw',
    displayName: '張怡君（demo 老師）',
    schoolId: 'pu',
    department: '資訊管理學系',
    icon: 'school-outline',
    shortLabel: '教師',
    hint: '批改、點名、發成績',
    color: '#3567C8',
  },
  {
    role: 'ta',
    uid: 'demo_ta_lin',
    email: 'demo.ta@pu.edu.tw',
    displayName: '林助教（demo TA）',
    schoolId: 'pu',
    department: '資訊管理學系',
    icon: 'people-outline',
    shortLabel: 'TA',
    hint: '協助批改、回覆討論',
    color: '#7B4DB8',
  },
  {
    role: 'club_officer',
    uid: 'demo_club_wei',
    email: 'demo.club@pu.edu.tw',
    displayName: '魏社長（demo 程式設計社）',
    schoolId: 'pu',
    department: '學生社團',
    icon: 'flag-outline',
    shortLabel: '社團幹部',
    hint: '社團活動、成員管理',
    color: '#34C759',
  },
  {
    role: 'department_head',
    uid: 'demo_admin_huang',
    email: 'demo.admin@pu.edu.tw',
    displayName: '黃主任（demo 系所主管）',
    schoolId: 'pu',
    department: '資訊管理學系',
    icon: 'business-outline',
    shortLabel: '系主任',
    hint: '審核公告、教師名冊',
    color: '#C79532',
  },
  {
    role: 'admin',
    uid: 'demo_admin_sys',
    email: 'demo.sysadmin@pu.edu.tw',
    displayName: '系統管理員（demo）',
    schoolId: 'pu',
    department: '校務系統',
    icon: 'shield-checkmark-outline',
    shortLabel: '管理員',
    hint: '全校管理、系統設定',
    color: '#FF3B30',
  },
  {
    role: 'vendor',
    uid: 'demo_cafeteria',
    email: 'demo.vendor@pu.edu.tw',
    displayName: '阿櫻（demo 餐廳）',
    schoolId: 'pu',
    department: '校園服務',
    icon: 'restaurant-outline',
    shortLabel: '餐廳',
    hint: '訂單、菜單、營運',
    color: '#C95F28',
  },
  {
    role: 'alumni',
    uid: 'demo_alumni_chang',
    email: 'demo.alumni@pu.edu.tw',
    displayName: '張學長（demo 校友）',
    schoolId: 'pu',
    department: '資訊管理學系（已畢業）',
    icon: 'ribbon-outline',
    shortLabel: '校友',
    hint: '校友動態、公開公告',
    color: '#8E8E93',
  },
  {
    role: 'guest',
    uid: 'demo_guest',
    email: 'demo.guest@pu.edu.tw',
    displayName: '訪客（demo 未登入）',
    schoolId: 'pu',
    department: '訪客',
    icon: 'eye-outline',
    shortLabel: '訪客',
    hint: '公開公告、地圖、公車',
    color: '#6E6E73',
  },
];

function resolveCurrentPreset(uid: string | null | undefined): RolePreset {
  if (!uid) return ROLE_PRESETS[ROLE_PRESETS.length - 1];
  return ROLE_PRESETS.find((p) => p.uid === uid) ?? ROLE_PRESETS[0];
}

/** 把 auth UserRole 對應到 DemoRole context 所認識的 role。 */
function toDemoRole(r: UserRole): DemoRole {
  const known: DemoRole[] = [
    'student', 'teacher', 'ta', 'club_officer',
    'department_head', 'admin', 'vendor', 'alumni', 'guest',
  ];
  return (known as string[]).includes(r as string) ? (r as DemoRole) : 'admin';
}

export function DemoRolePill() {
  const auth = useAuth();
  const { setRole: setDemoRole } = useDemoRole();
  const [open, setOpen] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const current = resolveCurrentPreset(auth.user?.uid);

  const handlePick = useCallback(
    async (preset: RolePreset) => {
      if (preset.uid === auth.user?.uid) {
        setOpen(false);
        return;
      }
      setBusyUid(preset.uid);
      try {
        const prev = await loadMockAuthSession().catch(() => null);
        if (prev?.uid && prev.uid !== preset.uid) {
          await clearRoleEventInbox(prev.uid).catch(() => undefined);
          await resetSeedFlag(preset.uid).catch(() => undefined);
          await clearMockAuthSession().catch(() => undefined);
        }
        await seedDemoInboxIfNeeded(preset.uid).catch(() => undefined);
        await saveMockAuthSession({
          uid: preset.uid,
          email: preset.email,
          schoolId: preset.schoolId,
          displayName: preset.displayName,
          role: preset.role,
          department: preset.department,
          studentId: preset.studentId ?? null,
          loginAccount: preset.email,
        });
        // 同步更新 DemoRoleContext（state/demoRole.tsx），讓 MessagesAiFirstScreen
        // 等使用 useDemoRole() 的畫面能正確過濾該角色的收件匣訊息。
        setDemoRole(toDemoRole(preset.role));
        await auth.refreshProfile();
      } finally {
        setBusyUid(null);
        setOpen(false);
      }
    },
    [auth, setDemoRole],
  );

  // 訪客 / 未登入時不顯示 pill；登入流程由 LoginLandingScreen 處理
  if (!auth.user?.uid) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="切換 demo 角色"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          backgroundColor: current.color + '18',
          borderWidth: 1,
          borderColor: current.color + '44',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name={current.icon} size={14} color={current.color} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: current.color }}>
          {current.shortLabel}
        </Text>
        <Ionicons name="swap-vertical" size={12} color={current.color} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 16,
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              maxHeight: '80%',
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              ...softShadowStyle(theme.shadows.soft),
            }}
          >
            <View
              style={{
                padding: theme.space.md,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.separator,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="swap-horizontal" size={18} color={theme.colors.accent} />
              <Text style={{ flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                切換 demo 角色
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Ionicons name="close" size={20} color={theme.colors.muted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 480 }}>
              {ROLE_PRESETS.map((preset) => {
                const active = preset.uid === auth.user?.uid;
                const busy = busyUid === preset.uid;
                return (
                  <Pressable
                    key={preset.uid}
                    onPress={() => handlePick(preset)}
                    disabled={!!busyUid}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: theme.space.md,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.separator,
                      backgroundColor: active ? preset.color + '12' : 'transparent',
                      opacity: busyUid ? (busy ? 1 : 0.45) : pressed ? 0.85 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        backgroundColor: preset.color + '20',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name={preset.icon} size={18} color={preset.color} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          color: theme.colors.text,
                          fontSize: 14,
                          fontWeight: '700',
                        }}
                        numberOfLines={1}
                      >
                        {preset.shortLabel} · {preset.displayName.split('（')[0]}
                      </Text>
                      <Text
                        style={{
                          color: theme.colors.muted,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                        numberOfLines={1}
                      >
                        {preset.hint}
                      </Text>
                    </View>
                    {busy ? (
                      <ActivityIndicator color={preset.color} />
                    ) : active ? (
                      <Ionicons name="checkmark-circle" size={20} color={preset.color} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default DemoRolePill;
