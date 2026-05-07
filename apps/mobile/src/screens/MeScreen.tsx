/* eslint-disable */
import React, { useMemo } from 'react';
import { Alert, Pressable, ScrollView, Text, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useThemeMode } from '../state/theme';
import { useNotifications } from '../state/notifications';
import { useSchedule } from '../state/schedule';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme, shadowStyle, softShadowStyle } from '../ui/theme';

type ServiceItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  color: string;
  onPress: () => void;
  badge?: string;
};

type SettingRow = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  value?: string;
  danger?: boolean;
  badge?: number;
};

// ─── Glass Panel ────────────────────────────────────────
function GlassPanel(props: { children: React.ReactNode; padding?: number; style?: any }) {
  const isDark = theme.mode === 'dark';
  const padding = props.padding ?? 20;

  if (Platform.OS === 'ios') {
    return (
      <View style={[{ borderRadius: 22, overflow: 'hidden' }, props.style]}>
        <BlurView
          intensity={40}
          tint={isDark ? 'dark' : 'light'}
          style={{
            padding,
            borderRadius: 22,
            overflow: 'hidden',
            backgroundColor: isDark ? 'rgba(26,22,37,0.75)' : 'rgba(255,255,255,0.72)',
          }}
        >
          {props.children}
        </BlurView>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          backgroundColor: isDark ? theme.colors.surface : '#FFFFFF',
          borderRadius: 22,
          padding,
          ...shadowStyle(theme.shadows.md),
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

// ─── Section Header ─────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <Text
      style={{
        color: theme.colors.text,
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: -0.3,
        marginBottom: 14,
      }}
    >
      {title}
    </Text>
  );
}

// ─── Profile Stat (redesigned with gradient) ────────────
function ProfileStat(props: { label: string; value: string; accent: string }) {
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={[`${props.accent}20`, `${props.accent}08`]}
        style={{
          borderRadius: 16,
          paddingVertical: 16,
          paddingHorizontal: 14,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: props.accent, fontSize: 24, fontWeight: '800', letterSpacing: -0.6 }}>
          {props.value}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 11,
            marginTop: 4,
            fontWeight: '600',
          }}
        >
          {props.label}
        </Text>
      </LinearGradient>
    </View>
  );
}

// ─── Service Tile (redesigned) ──────────────────────────
function ServiceTile({ item }: { item: ServiceItem }) {
  return (
    <Pressable
      onPress={item.onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 18,
        backgroundColor: `${item.color}06`,
        transform: [{ scale: pressed ? 0.95 : 1 }],
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <LinearGradient
          colors={[`${item.color}25`, `${item.color}10`]}
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={item.icon} size={22} color={item.color} />
        </LinearGradient>
        {item.badge ? (
          <View
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              paddingHorizontal: 6,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.danger,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{item.badge}</Text>
          </View>
        ) : (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: `${item.color}08`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-forward" size={14} color={item.color} />
          </View>
        )}
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
        {item.label}
      </Text>
      <Text
        style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 5 }}
      >
        {item.hint}
      </Text>
    </Pressable>
  );
}

function ServiceGrid({ items }: { items: ServiceItem[] }) {
  const rows = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2));
  }

  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={{ flexDirection: 'row', gap: 12 }}>
          {row.map((item) => (
            <ServiceTile key={item.label} item={item} />
          ))}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

// ─── Setting Row (redesigned) ───────────────────────────
function ListRowItem({ row }: { row: SettingRow }) {
  const iconColor = row.danger ? theme.colors.danger : row.color;

  return (
    <Pressable
      onPress={row.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        paddingVertical: 14,
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <LinearGradient
        colors={
          row.danger
            ? [theme.colors.dangerSoft, `${theme.colors.danger}10`]
            : [`${row.color}22`, `${row.color}08`]
        }
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Ionicons name={row.icon} size={18} color={iconColor} />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={{ color: iconColor, fontSize: 15, fontWeight: row.danger ? '700' : '600' }}>
          {row.label}
        </Text>
      </View>
      {row.badge !== undefined && row.badge > 0 ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            paddingHorizontal: 6,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.danger,
            marginRight: 8,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>{row.badge}</Text>
        </View>
      ) : null}
      {row.value ? (
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginRight: 8 }}>{row.value}</Text>
      ) : null}
      {!row.danger ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: `${theme.colors.accent}08`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
        </View>
      ) : null}
    </Pressable>
  );
}

function ListSection(props: { title: string; rows: SettingRow[] }) {
  return (
    <View>
      <SectionHeader title={props.title} />
      <GlassPanel padding={12}>
        {props.rows.map((row, index) => (
          <View key={row.label}>
            <ListRowItem row={row} />
            {index < props.rows.length - 1 ? (
              <View
                style={{ height: 1, marginLeft: 58, backgroundColor: `${theme.colors.border}60` }}
              />
            ) : null}
          </View>
        ))}
      </GlassPanel>
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────
export function MeScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const themeMode = useThemeMode();
  const notifs = useNotifications();
  const { courses } = useSchedule();

  const isDark = theme.mode === 'dark';

  const identity = useMemo(() => {
    if (!auth.user) return '校園訪客';
    if (auth.profile?.displayName) return auth.profile.displayName;
    return auth.user.email ?? `用戶 ${auth.user.uid.slice(0, 6)}`;
  }, [auth.profile?.displayName, auth.user]);

  const avatarInitial = useMemo(() => {
    const source = auth.profile?.displayName ?? auth.user?.email ?? school.name;
    return (source[0] ?? '?').toUpperCase();
  }, [auth.profile?.displayName, auth.user?.email, school.name]);

  const totalCredits = useMemo(
    () => courses.reduce((sum, course) => sum + (course.credits ?? 0), 0),
    [courses],
  );

  const frequentServices: ServiceItem[] = [
    {
      icon: 'qr-code-outline',
      label: 'QR 碼',
      hint: '校園身份與通行',
      color: '#5B21B6',
      onPress: () => nav?.navigate?.('QRCode'),
    },
    {
      icon: 'search-outline',
      label: '全站搜尋',
      hint: '快速找課程與公告',
      color: '#6366F1',
      onPress: () => nav?.navigate?.('GlobalSearch'),
    },
    {
      icon: 'library-outline',
      label: '圖書館',
      hint: '借閱、空位與書單',
      color: '#A78BFA',
      onPress: () => nav?.navigate?.('Library'),
    },
    {
      icon: 'bus-outline',
      label: '校園公車',
      hint: '查看即時班次',
      color: '#10B981',
      onPress: () => nav?.navigate?.('校園', { screen: 'BusSchedule' }),
    },
  ];

  const campusLifeServices: ServiceItem[] = [
    {
      icon: 'medkit-outline',
      label: '健康中心',
      hint: '掛號與服務資訊',
      color: '#EF4444',
      onPress: () => nav?.navigate?.('Health'),
    },
    {
      icon: 'bed-outline',
      label: '宿舍服務',
      hint: '住宿與報修入口',
      color: '#7C3AED',
      onPress: () => nav?.navigate?.('Dormitory'),
    },
    {
      icon: 'print-outline',
      label: '列印服務',
      hint: '影印與輸出需求',
      color: '#D4A843',
      onPress: () => nav?.navigate?.('PrintService'),
    },
    {
      icon: 'help-buoy-outline',
      label: '失物招領',
      hint: '刊登與查找物品',
      color: '#EC4899',
      onPress: () => nav?.navigate?.('LostFound'),
    },
  ];

  const otherServices: ServiceItem[] = [
    {
      icon: 'wallet-outline',
      label: '校園支付',
      hint: '錢包與付款紀錄',
      color: '#10B981',
      onPress: () => nav?.navigate?.('Payment'),
    },
    {
      icon: 'trophy-outline',
      label: '成就積分',
      hint: '任務與排行榜',
      color: '#D4A843',
      onPress: () => nav?.navigate?.('Achievements'),
    },
    {
      icon: 'phone-portrait-outline',
      label: '桌面小工具',
      hint: 'Widget 預覽與設定',
      color: '#6366F1',
      onPress: () => nav?.navigate?.('WidgetPreview'),
    },
  ];

  const accountRows: SettingRow[] = auth.user
    ? [
        {
          icon: 'person-outline',
          label: '編輯個人資料',
          color: theme.colors.accent,
          onPress: () => nav?.navigate?.('ProfileEdit'),
        },
        {
          icon: 'notifications-outline',
          label: '通知中心',
          color: '#D4A843',
          onPress: () => nav?.navigate?.('Notifications'),
          badge: notifs.unreadCount > 0 ? notifs.unreadCount : undefined,
        },
        {
          icon: isDark ? 'sunny-outline' : 'moon-outline',
          label: isDark ? '切換淺色模式' : '切換深色模式',
          color: '#7C3AED',
          onPress: () => themeMode.setMode(isDark ? 'light' : 'dark'),
        },
      ]
    : [
        {
          icon: 'log-in-outline',
          label: '學校帳號登入',
          color: theme.colors.accent,
          onPress: () => nav?.navigate?.('SSOLogin'),
        },
      ];

  const settingRows: SettingRow[] = [
    {
      icon: 'settings-outline',
      label: '設定',
      color: theme.colors.textSecondary,
      onPress: () => nav?.navigate?.('Settings'),
    },
    {
      icon: 'notifications-outline',
      label: '通知設定',
      color: '#D4A843',
      onPress: () => nav?.navigate?.('NotificationSettings'),
    },
    {
      icon: 'language-outline',
      label: '語言',
      color: '#6366F1',
      onPress: () => nav?.navigate?.('LanguageSettings'),
      value: '繁體中文',
    },
    {
      icon: 'accessibility-outline',
      label: '無障礙設定',
      color: '#10B981',
      onPress: () => nav?.navigate?.('AccessibilitySettings'),
    },
    {
      icon: 'color-palette-outline',
      label: '主題預覽',
      color: '#A78BFA',
      onPress: () => nav?.navigate?.('ThemePreview'),
    },
  ];

  const supportRows: SettingRow[] = [
    {
      icon: 'help-circle-outline',
      label: '幫助中心',
      color: '#6366F1',
      onPress: () => nav?.navigate?.('Help'),
    },
    {
      icon: 'chatbox-outline',
      label: '意見回饋',
      color: '#10B981',
      onPress: () => nav?.navigate?.('Feedback'),
    },
    {
      icon: 'bug-outline',
      label: '回報問題',
      color: '#D4A843',
      onPress: () => nav?.navigate?.('BugReport'),
    },
  ];

  const dangerRows: SettingRow[] = auth.user
    ? [
        {
          icon: 'download-outline',
          label: '匯出個人資料',
          color: theme.colors.textSecondary,
          onPress: () => nav?.navigate?.('DataExport'),
        },
        {
          icon: 'log-out-outline',
          label: '登出',
          color: theme.colors.danger,
          danger: true,
          onPress: () =>
            Alert.alert('確認登出', '確定要登出嗎？', [
              { text: '取消', style: 'cancel' },
              { text: '登出', style: 'destructive', onPress: () => auth.signOutWithWarning() },
            ]),
        },
        {
          icon: 'trash-outline',
          label: '刪除帳號',
          color: theme.colors.danger,
          danger: true,
          onPress: () => nav?.navigate?.('AccountDeletion'),
        },
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* ═══ Profile Header with Gradient ═══ */}
        <LinearGradient
          colors={isDark ? ['#2E1065', '#1A1040', '#0C0A13'] : ['#EDE9FE', '#F0EBFF', '#FAF9FC']}
          style={{
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: 28,
          }}
        >
          {/* Top row: Title + Settings */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                color: theme.colors.text,
                fontSize: 28,
                fontWeight: '800',
                letterSpacing: -0.6,
              }}
            >
              我的
            </Text>
            <Pressable
              onPress={() => nav?.navigate?.('Settings')}
              style={({ pressed }) => ({
                width: 42,
                height: 42,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(91,33,182,0.06)',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="settings-outline" size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {/* Avatar + Identity */}
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <LinearGradient
              colors={isDark ? ['#7C3AED', '#5B21B6'] : ['#A78BFA', '#7C3AED']}
              style={{
                width: 72,
                height: 72,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#5B21B6',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '800' }}>
                {avatarInitial}
              </Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 22,
                  fontWeight: '800',
                  letterSpacing: -0.4,
                }}
                numberOfLines={1}
              >
                {identity}
              </Text>
              <Text
                style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 }}
                numberOfLines={1}
              >
                {auth.user ? (auth.user.email ?? '已登入校園帳號') : '登入後同步你的校務資料'}
              </Text>

              {/* Tags */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 10,
                    backgroundColor: isDark ? 'rgba(167,139,250,0.15)' : 'rgba(91,33,182,0.1)',
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700' }}>
                    {school.code}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 10,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  }}
                >
                  <Text
                    style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600' }}
                  >
                    {auth.profile?.department ?? school.name}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Stats or Login CTA */}
          {auth.user ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
              <ProfileStat
                label="修課數"
                value={`${courses.length}`}
                accent={theme.colors.accent}
              />
              <ProfileStat label="總學分" value={`${totalCredits}`} accent={theme.colors.success} />
              <ProfileStat label="未讀通知" value={`${notifs.unreadCount}`} accent="#D4A843" />
            </View>
          ) : (
            <Pressable
              onPress={() => nav?.navigate?.('SSOLogin')}
              style={({ pressed }) => ({
                marginTop: 22,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <LinearGradient
                colors={['#5B21B6', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 16,
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
              >
                <Ionicons name="log-in-outline" size={20} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>
                  立即登入校園帳號
                </Text>
              </LinearGradient>
            </Pressable>
          )}
        </LinearGradient>

        {/* ═══ Main Content ═══ */}
        <View style={{ paddingHorizontal: 20, gap: 28, marginTop: 4 }}>
          {/* Admin Panel */}
          {auth.isAdmin || auth.isEditor ? (
            <Pressable
              onPress={() => nav?.navigate?.('AdminDashboard')}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <LinearGradient
                colors={isDark ? ['#422006', '#451A03'] : ['#FEF3C7', '#FDE68A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: 22,
                  padding: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  ...shadowStyle(theme.shadows.md),
                }}
              >
                <View
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.6)',
                  }}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={24}
                    color={isDark ? '#FBBF24' : '#D97706'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: isDark ? '#F5F3FF' : '#1A1333',
                      fontSize: 17,
                      fontWeight: '700',
                    }}
                  >
                    管理控制台
                  </Text>
                  <Text
                    style={{
                      color: isDark ? 'rgba(245,243,255,0.6)' : 'rgba(26,19,51,0.5)',
                      fontSize: 13,
                      marginTop: 3,
                    }}
                  >
                    審核、發布與後台維運入口
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={isDark ? '#FBBF24' : '#D97706'} />
              </LinearGradient>
            </Pressable>
          ) : null}

          {/* Account shortcuts */}
          <View>
            <SectionHeader title="帳號捷徑" />
            <GlassPanel padding={16}>
              <ServiceGrid
                items={[
                  {
                    icon: 'person-outline',
                    label: '個人資料',
                    hint: auth.user ? '編輯��本資訊' : '登入後可編輯',
                    color: theme.colors.accent,
                    onPress: () =>
                      auth.user ? nav?.navigate?.('ProfileEdit') : nav?.navigate?.('SSOLogin'),
                  },
                  {
                    icon: 'notifications-outline',
                    label: '通知',
                    hint: '訊息與提醒中心',
                    color: '#D4A843',
                    onPress: () => nav?.navigate?.('Notifications'),
                    badge: notifs.unreadCount > 0 ? String(notifs.unreadCount) : undefined,
                  },
                  {
                    icon: isDark ? 'sunny-outline' : 'moon-outline',
                    label: isDark ? '切回淺色' : '切換深色',
                    hint: '調整整體觀感',
                    color: '#7C3AED',
                    onPress: () => themeMode.setMode(isDark ? 'light' : 'dark'),
                  },
                  {
                    icon: 'settings-outline',
                    label: '總設定',
                    hint: '偏好與權限管理',
                    color: theme.colors.textSecondary,
                    onPress: () => nav?.navigate?.('Settings'),
                  },
                ]}
              />
            </GlassPanel>
          </View>

          <View>
            <SectionHeader title="常用入口" />
            <GlassPanel padding={16}>
              <ServiceGrid items={frequentServices} />
            </GlassPanel>
          </View>

          <View>
            <SectionHeader title="校園生活" />
            <GlassPanel padding={16}>
              <ServiceGrid items={campusLifeServices} />
            </GlassPanel>
          </View>

          <View>
            <SectionHeader title="其他工具" />
            <GlassPanel padding={16}>
              <ServiceGrid items={otherServices} />
            </GlassPanel>
          </View>

          <ListSection title="帳號與偏好" rows={accountRows} />
          <ListSection title="App 設定" rows={settingRows} />
          <ListSection title="支援與回饋" rows={supportRows} />

          {dangerRows.length > 0 ? <ListSection title="帳號安全" rows={dangerRows} /> : null}

          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 11,
              textAlign: 'center',
              marginTop: 4,
              marginBottom: 12,
            }}
          >
            校園整合 App · v1.0.0 · {isDark ? '深色' : '淺色'}模式
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
