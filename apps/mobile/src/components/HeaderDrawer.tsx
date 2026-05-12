/**
 * HeaderDrawer — 取代「我的」Tab 的滑出式抽屜
 * ═══════════════════════════════════════════════════════════════════════
 * 設計：
 * - 由各 Tab 主頁左上角頭像按鈕觸發
 * - 從左側滑入；包含個人資料、設定、AI 模型、管理工具入口等
 * - 重要：管理員/主管/職員/商家入口隱藏在這裡，不再佔據 Tab 位置
 *
 * 心理學：
 * - Spatial Memory：左上頭像 = 個人空間（與 Google 帳號按鈕一致）
 * - Progressive Disclosure：常用設定在上方，進階/管理工具在下方
 * - Recognition over Recall：每項都帶 icon + 簡短說明
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme, softShadowStyle } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useNotifications } from '../state/notifications';
import { usePermissions } from '../hooks/usePermissions';
import { rootNavigateCampusCommunity, rootNavigate, rootNavigateMeScreen } from '../app/rootNavigation';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 360);

// ─── 全域控制 store ─────────────────────────────────────
type Listener = (visible: boolean) => void;
const listeners = new Set<Listener>();
let visibleState = false;

export const headerDrawer = {
  open() {
    visibleState = true;
    listeners.forEach((l) => l(true));
  },
  close() {
    visibleState = false;
    listeners.forEach((l) => l(false));
  },
  toggle() {
    if (visibleState) this.close();
    else this.open();
  },
  isOpen: () => visibleState,
};

export function useHeaderDrawer(): { visible: boolean; open: () => void; close: () => void } {
  const [v, setV] = React.useState(visibleState);
  useEffect(() => {
    const l = (next: boolean) => setV(next);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { visible: v, open: headerDrawer.open, close: headerDrawer.close };
}

// ─── 抽屜本體 ────────────────────────────────────────────
export function HeaderDrawerHost() {
  const { visible } = useHeaderDrawer();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const notifs = useNotifications();
  const {
    displayName: roleDisplayName,
    badgeColor,
    isTeacher,
    isStaff,
    isDepartmentHead,
    isAdmin,
  } = usePermissions();

  const slide = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlay = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, {
          toValue: 0,
          tension: 70,
          friction: 12,
          useNativeDriver: true,
        }),
        Animated.timing(overlay, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slide, overlay]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlay, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => headerDrawer.close());
  };

  const go = (screen: string, params?: any) => {
    handleClose();
    setTimeout(() => {
      rootNavigateMeScreen(screen, params);
    }, 220);
  };

  const handleSignOut = async () => {
    Alert.alert('登出', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出',
        style: 'destructive',
        onPress: async () => {
          await auth.signOut();
          handleClose();
        },
      },
    ]);
  };

  const identity = auth.user
    ? auth.profile?.displayName ?? auth.user.email ?? '校園使用者'
    : '校園訪客';

  const isDark = theme.mode === 'dark';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* 抽屜本體 */}
        <Animated.View
          style={{
            width: DRAWER_WIDTH,
            backgroundColor: theme.colors.bg,
            transform: [{ translateX: slide }],
            ...softShadowStyle({
              color: '#000',
              opacity: 0.3,
              radius: 20,
              offset: { width: 4, height: 0 },
              elevation: 16,
            }),
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingBottom: insets.bottom + 40,
            }}
          >
            {/* ─── 頭部：身分卡 ─── */}
            <LinearGradient
              colors={
                isDark
                  ? (['#2E1065', '#1A0A3E'] as [string, string])
                  : (['#EDE9FE', '#F5F3FF'] as [string, string])
              }
              style={{
                paddingTop: insets.top + 16,
                paddingBottom: 18,
                paddingHorizontal: 18,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <Pressable
                  onPress={() => go(auth.user ? 'ProfileEdit' : 'SSOLogin')}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <LinearGradient
                    colors={[theme.colors.accent, '#7C3AED']}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="person" size={26} color="#fff" />
                  </LinearGradient>
                </Pressable>
                <Pressable
                  onPress={handleClose}
                  hitSlop={10}
                  style={({ pressed }) => ({
                    padding: 6,
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Ionicons name="close" size={22} color={theme.colors.text} />
                </Pressable>
              </View>

              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 18,
                  fontWeight: '800',
                  letterSpacing: -0.3,
                }}
                numberOfLines={1}
              >
                {identity}
              </Text>
              {auth.user ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: badgeColor,
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                      borderRadius: 999,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                      {roleDisplayName}
                    </Text>
                  </View>
                  {auth.profile?.department ? (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                      {auth.profile.department}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Pressable
                  onPress={() => go('SSOLogin')}
                  style={({ pressed }) => ({
                    marginTop: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    backgroundColor: theme.colors.accent,
                    borderRadius: 10,
                    alignSelf: 'flex-start',
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                    學校帳號登入
                  </Text>
                </Pressable>
              )}
            </LinearGradient>

            {/* ─── 校園連結（跨 Tab） ─── */}
            <DrawerSection title="校園連結">
              <DrawerRow
                icon="planet-outline"
                label="校園社群 · 動態／看板／即時／學伴"
                tint={theme.colors.social}
                onPress={() => {
                  handleClose();
                  setTimeout(() => {
                    rootNavigateCampusCommunity();
                  }, 220);
                }}
              />
            </DrawerSection>

            {/* ─── 個人 ─── */}
            <DrawerSection title="個人">
              <DrawerRow
                icon="person-outline"
                label="個人資料"
                onPress={() => go(auth.user ? 'ProfileEdit' : 'SSOLogin')}
              />
              <DrawerRow
                icon="qr-code-outline"
                label="我的 QR Code"
                onPress={() => go('QRCode')}
              />
              <DrawerRow
                icon="trophy-outline"
                label="成就與積分"
                tint={theme.colors.achievement}
                onPress={() => go('Achievements')}
              />
              <DrawerRow
                icon="school-outline"
                label="學分與畢業規劃"
                tint={theme.colors.roleTeacher}
                onPress={() => go('CreditAuditStack')}
              />
            </DrawerSection>

            {/* ─── 通知與設定 ─── */}
            <DrawerSection title="通知與設定">
              <DrawerRow
                icon="notifications-outline"
                label="通知中心"
                badge={notifs.unreadCount > 0 ? `${notifs.unreadCount}` : undefined}
                tint={theme.colors.warning}
                onPress={() => go('Notifications')}
              />
              <DrawerRow
                icon="options-outline"
                label="通知設定"
                onPress={() => go('NotificationSettings')}
              />
              <DrawerRow
                icon="settings-outline"
                label="一般設定"
                onPress={() => go('Settings')}
              />
              <DrawerRow
                icon="accessibility-outline"
                label="語言與無障礙"
                onPress={() => go('AccessibilitySettings')}
              />
            </DrawerSection>

            {/* ─── AI ─── */}
            <DrawerSection title="AI 與工具">
              <DrawerRow
                icon="hardware-chip-outline"
                label="AI 模型管理"
                tint="#8B5CF6"
                onPress={() => go('AIModelManager')}
              />
              <DrawerRow
                icon="grid-outline"
                label="小工具預覽"
                onPress={() => go('WidgetPreview')}
              />
            </DrawerSection>

            {/* ─── 角色專屬：管理工具 ─── */}
            {(isAdmin || isDepartmentHead || isTeacher || isStaff) && (
              <DrawerSection title="工作模式">
                {isTeacher && (
                  <DrawerRow
                    icon="school-outline"
                    label="我的教學課程"
                    tint={theme.colors.roleTeacher}
                    onPress={() => {
                      handleClose();
                      setTimeout(() => rootNavigate('學習'), 220);
                    }}
                  />
                )}
                {isAdmin && (
                  <>
                    <DrawerRow
                      icon="shield-checkmark-outline"
                      label="管理員控制台"
                      tint={theme.colors.roleAdmin}
                      onPress={() => go('AdminDashboard')}
                    />
                    <DrawerRow
                      icon="checkmark-done-outline"
                      label="課程驗證管理"
                      tint={theme.colors.urgent}
                      onPress={() => go('AdminCourseVerify')}
                    />
                  </>
                )}
                {isDepartmentHead && (
                  <DrawerRow
                    icon="stats-chart-outline"
                    label="系所審核與數據"
                    tint={theme.colors.calm}
                    onPress={() => {
                      handleClose();
                      setTimeout(() => rootNavigate('學習'), 220);
                    }}
                  />
                )}
                {isStaff && !isAdmin && (
                  <DrawerRow
                    icon="construct-outline"
                    label="設施與工單（工作首頁）"
                    tint={theme.colors.warning}
                    onPress={() => {
                      handleClose();
                      setTimeout(() => rootNavigate('學習'), 220);
                    }}
                  />
                )}
                {auth.profile?.merchantAssignments?.some(
                  (a) => a.status === 'active',
                ) && (
                  <DrawerRow
                    icon="storefront-outline"
                    label="商家接單"
                    tint={theme.colors.accent}
                    onPress={() => go('MerchantHub')}
                  />
                )}
              </DrawerSection>
            )}

            {/* ─── 隱私與帳號 ─── */}
            <DrawerSection title="隱私與帳號">
              <DrawerRow
                icon="shield-outline"
                label="資料匯出"
                onPress={() => go('DataExport')}
              />
              <DrawerRow
                icon="trash-outline"
                label="刪除帳號"
                tint={theme.colors.danger}
                onPress={() => go('AccountDeletion')}
              />
            </DrawerSection>

            {/* ─── 幫助 ─── */}
            <DrawerSection title="幫助">
              <DrawerRow
                icon="help-circle-outline"
                label="幫助中心"
                onPress={() => go('Help')}
              />
              <DrawerRow
                icon="chatbubble-ellipses-outline"
                label="意見回饋"
                onPress={() => go('Feedback')}
              />
              <DrawerRow
                icon="bug-outline"
                label="回報問題"
                onPress={() => go('BugReport')}
              />
            </DrawerSection>

            {auth.user && (
              <Pressable
                onPress={handleSignOut}
                style={({ pressed }) => ({
                  marginTop: 24,
                  marginHorizontal: 18,
                  paddingVertical: 13,
                  borderRadius: 14,
                  backgroundColor: theme.colors.dangerSoft,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    color: theme.colors.danger,
                    fontSize: 14,
                    fontWeight: '700',
                  }}
                >
                  登出
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </Animated.View>

        {/* 半透明遮罩 */}
        <Animated.View
          style={{
            flex: 1,
            backgroundColor: '#000',
            opacity: overlay.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.4],
            }),
          }}
        >
          <Pressable
            onPress={handleClose}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
            accessibilityLabel="關閉抽屜"
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── 內部小元件 ────────────────────────────────────────
function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 11,
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          paddingHorizontal: 18,
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          marginHorizontal: 12,
          borderRadius: 14,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function DrawerRow({
  icon,
  label,
  tint,
  badge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: string;
  badge?: string;
  onPress: () => void;
}) {
  const color = tint ?? theme.colors.accent;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: color + '1A',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 14,
          fontWeight: '600',
          flex: 1,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            paddingHorizontal: 6,
            height: 20,
            borderRadius: 10,
            backgroundColor: theme.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
            {badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
    </Pressable>
  );
}

export default HeaderDrawerHost;
