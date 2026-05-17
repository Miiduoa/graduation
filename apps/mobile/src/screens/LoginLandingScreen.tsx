/**
 * Login Landing — APP 首次開啟 / 登出後的入口
 *
 * 兩條路徑：
 *  1. 「真實登入」→ 跳既有 SSO / 學號登入流程
 *  2. 「demo 體驗」→ 一鍵以 5 種角色之一登入 (student/teacher/ta/admin/staff)
 *      用 saveMockAuthSession 寫入 mockAuth，auth.tsx 會自動 picks up。
 *
 * 設計：
 *  - 純前端，無 Firebase 依賴
 *  - 視覺乾淨：頂部 hero + 兩個大區塊
 *  - 進入後立即去主畫面（auth.profile 會在背景填好）
 */
import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { saveMockAuthSession, loadMockAuthSession, clearMockAuthSession } from '../services/mockAuth';
import { clearRoleEventInbox } from '../services/roleEventBus';
import { seedDemoInboxIfNeeded, resetSeedFlag } from '../services/demoInboxSeeder';
import { theme, softShadowStyle } from '../ui/theme';
import { Button } from '../ui/components';
import { useAuth, type UserRole } from '../state/auth';
import type { PreAuthStackParamList } from './preAuthTypes';

interface DemoRolePreset {
  role: UserRole;
  uid: string;
  email: string;
  displayName: string;
  schoolId: string;
  department: string;
  studentId?: string;
  emoji: string;
  description: string;
  color: string;
}

const DEMO_PRESETS: DemoRolePreset[] = [
  {
    role: 'student',
    uid: 'demo_student_kuchih',
    email: 'demo.student@pu.edu.tw',
    displayName: '顧晉瑋（demo 學生）',
    schoolId: 'pu',
    department: '資訊管理學系',
    studentId: '411211325',
    emoji: '🎓',
    description: '看作業、考試、AI 學伴、錯題本，體驗每日駕駛艙',
    color: '#1F4E78',
  },
  {
    role: 'teacher',
    uid: 'demo_teacher_chang',
    email: 'demo.teacher@pu.edu.tw',
    displayName: '張怡君（demo 老師）',
    schoolId: 'pu',
    department: '資訊管理學系',
    emoji: '👨‍🏫',
    description: '批改、AI 起草評語、bulk 提醒、學生紅旗',
    color: '#0EA5E9',
  },
  {
    role: 'staff',
    uid: 'demo_ta_lin',
    email: 'demo.ta@pu.edu.tw',
    displayName: '林助教（demo TA）',
    schoolId: 'pu',
    department: '資訊管理學系',
    emoji: '🧑‍💼',
    description: '協助批改、輔導學生、查看出席異常',
    color: '#7C3AED',
  },
  {
    role: 'admin',
    uid: 'demo_admin_huang',
    email: 'demo.admin@pu.edu.tw',
    displayName: '黃主任（demo 系所）',
    schoolId: 'pu',
    department: '資訊管理學系',
    emoji: '🏛',
    description: '系所儀表板、學生 risk、課程平均、教學評鑑',
    color: '#16A34A',
  },
  {
    role: 'staff',
    uid: 'demo_cafeteria',
    email: 'demo.vendor@pu.edu.tw',
    displayName: '阿英（demo 餐廳）',
    schoolId: 'pu',
    department: '校園服務',
    emoji: '🍱',
    description: '菜單管理、訂單接收、Loyalty 推播',
    color: '#F59E0B',
  },
];

export default function LoginLandingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<PreAuthStackParamList>>();
  const { refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);

  const handleDemoLogin = useCallback(
    async (preset: DemoRolePreset) => {
      setBusy(preset.uid);
      try {
        // 🧹 如果先前有別的 demo 角色登入，要先清掉他殘留的 inbox 事件
        // 否則切角色時會看到上一個角色已收到的舊事件
        const prev = await loadMockAuthSession().catch(() => null);
        if (prev?.uid && prev.uid !== preset.uid) {
          // 清掉前一個角色的個人 inbox，但 **保留 __all__ 廣播 inbox**
          //   ── 這是跨角色 demo 的關鍵：學生下單 / 老師批改 / 主任公告等事件
          //     都是 broadcast，要在切角色後另一個 demo 帳號還能看到。
          //   ── 若清掉 __all__，學生剛下的訂單在切到餐廳帳號時會消失。
          await clearRoleEventInbox(prev.uid).catch(() => {});
          // 重置這個 preset uid 的 seed flag（讓重 login 也能看到 demo 事件）
          await resetSeedFlag(preset.uid).catch(() => {});
          await clearMockAuthSession().catch(() => {});
        }

        // 種一批 demo 歷史事件（idempotent）
        await seedDemoInboxIfNeeded(preset.uid).catch(() => {});

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
        // ⚠ 寫入 mockAuth 後必須主動觸發 auth provider 重新讀取 session，
        //    否則 App.tsx 不會知道使用者已登入。
        await refreshProfile();
      } catch (e) {
        Alert.alert('登入失敗', String((e as Error)?.message ?? e));
      } finally {
        setBusy(null);
      }
    },
    [refreshProfile],
  );

  const handleRealLogin = useCallback(() => {
    try {
      navigation.navigate('SSOLogin');
    } catch {
      Alert.alert(
        '真實登入',
        '正式版需連到靜宜 SSO；目前 demo 環境請選下方任一角色快速體驗。',
      );
    }
  }, [navigation]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top', 'left', 'right']}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: theme.space.xxxl + theme.space.lg + insets.bottom,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero：品牌漸層 + 層級 */}
        <LinearGradient
          colors={
            theme.mode === 'dark'
              ? ([theme.colors.surfaceElevated, theme.colors.surfaceMuted] as const)
              : ([theme.colors.accentSoft, theme.colors.surfaceMuted] as const)
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: theme.radius.xl,
            padding: theme.layout.cardPadding,
            marginBottom: theme.space.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            ...softShadowStyle(theme.shadows.sm),
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 56, marginBottom: theme.space.xs }}>🎓</Text>
            <Text
              style={{
                fontSize: theme.typography.display.fontSize,
                lineHeight: theme.typography.display.lineHeight,
                letterSpacing: theme.typography.display.letterSpacing,
                fontWeight: theme.typography.display.fontWeight ?? '700',
                color: theme.colors.text,
                textAlign: 'center',
              }}
            >
              Campus Companion
            </Text>
            <Text
              style={{
                marginTop: theme.space.sm,
                fontSize: theme.typography.body.fontSize,
                lineHeight: theme.typography.body.lineHeight,
                color: theme.colors.textSecondary,
                textAlign: 'center',
              }}
            >
              以 AI 為核心的校園學習平台{'\n'}
              超越 TronClass 的智慧助手
            </Text>
          </View>
        </LinearGradient>

        <Button
          text="真實登入（靜宜 SSO）"
          kind="primary"
          fullWidth
          size="large"
          icon="lock-closed-outline"
          onPress={handleRealLogin}
          style={{ marginBottom: theme.space.sm }}
        />
        <Text
          style={{
            textAlign: 'center',
            fontSize: theme.typography.caption.fontSize,
            lineHeight: theme.typography.caption.lineHeight,
            color: theme.colors.muted,
            marginBottom: theme.space.lg,
          }}
        >
          用學號／教師帳號連到正式系統
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.sm,
            marginBottom: theme.space.md,
          }}
        >
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.separator }} />
          <Text
            style={{
              fontSize: theme.typography.labelSmall.fontSize,
              fontWeight: '600',
              letterSpacing: theme.typography.overline.letterSpacing * 0.4,
              color: theme.colors.muted,
              textTransform: 'uppercase',
            }}
          >
            或 demo 體驗
          </Text>
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.separator }} />
        </View>

        <View style={{ gap: theme.space.sm + theme.space.xs }}>
          {DEMO_PRESETS.map((preset) => {
            const isBusy = busy === preset.uid;
            return (
              <Pressable
                key={preset.uid}
                onPress={() => handleDemoLogin(preset)}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityState={{ busy: isBusy, disabled: !!busy && !isBusy }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.sm,
                  padding: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: preset.color,
                  opacity: busy ? (isBusy ? 1 : 0.45) : pressed ? 0.92 : 1,
                  ...softShadowStyle(theme.mode === 'light' ? theme.shadows.sm : theme.shadows.soft),
                })}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: theme.radius.lg,
                    backgroundColor: preset.color + '18',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 30 }}>{preset.emoji}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.typography.body.fontSize,
                      fontWeight: '700',
                    }}
                    numberOfLines={2}
                  >
                    {preset.displayName}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: theme.typography.bodySmall.fontSize,
                      lineHeight: theme.typography.bodySmall.lineHeight,
                      marginTop: theme.space.xxs,
                    }}
                    numberOfLines={3}
                  >
                    {preset.description}
                  </Text>
                </View>
                {isBusy ? (
                  <ActivityIndicator color={preset.color} />
                ) : (
                  <Ionicons name="chevron-forward" size={22} color={preset.color} />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* 7 分鐘 demo 導覽腳本卡（口委用） */}
        <View
          style={{
            marginTop: theme.space.lg,
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text
            style={{
              fontSize: theme.typography.labelSmall.fontSize,
              fontWeight: '700',
              color: theme.colors.muted,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              marginBottom: theme.space.xs,
            }}
          >
            🎬 7 分鐘 demo 導覽腳本
          </Text>
          {[
            { sec: '0:30', step: '張怡君老師 → 批量提醒 → AI 預測補交率 → 起草評語' },
            { sec: '2:00', step: '切到顧晉瑋學生 → 收到老師的提醒與評語 inbox' },
            { sec: '3:00', step: '繳交作業 → 點焦點 CTA「開始 25 分鐘」進入番茄' },
            { sec: '4:00', step: '切到阿英餐廳 → 訂單佇列推進 → AI 建議下一步' },
            { sec: '5:00', step: '學生同步收到「餐已備好」通知' },
            { sec: '6:00', step: '切到黃主任 → 系所健康度 + 風險課程 → 發公告' },
            { sec: '6:30', step: '切回任一角色 → 看到主任的公告進 inbox' },
          ].map((row) => (
            <View
              key={row.sec}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                paddingVertical: theme.space.xxs + 2,
              }}
            >
              <Text
                style={{
                  width: 44,
                  color: theme.colors.accent,
                  fontWeight: '700',
                  fontSize: theme.typography.bodySmall.fontSize,
                }}
              >
                {row.sec}
              </Text>
              <Text
                style={{
                  flex: 1,
                  color: theme.colors.text,
                  fontSize: theme.typography.bodySmall.fontSize,
                  lineHeight: theme.typography.bodySmall.lineHeight,
                }}
              >
                {row.step}
              </Text>
            </View>
          ))}
        </View>

        <Text
          style={{
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            lineHeight: theme.typography.caption.lineHeight + 4,
            textAlign: 'center',
            marginTop: theme.space.lg,
          }}
        >
          Demo 角色資料皆為示範，所有變更只存在你的裝置上。{'\n'}
          登出時會清除所有 demo 資料。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
