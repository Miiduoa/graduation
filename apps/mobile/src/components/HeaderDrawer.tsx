/**
 * HeaderDrawer — 取代「我的」Tab 的滑出式抽屜
 * ═══════════════════════════════════════════════════════════════════════
 * 設計：
 * - 由各 Tab 主頁左上角頭像按鈕觸發
 * - 從左側滑入；包含個人資料、課表、訊息、設定、管理工具入口
 * - 管理員/主管/職員/商家入口藏在這裡，不佔底部入口
 *
 * 心理學：
 * - Spatial Memory：左上頭像 = 個人空間（與 Google 帳號按鈕一致）
 * - Progressive Disclosure：常用設定在上方，進階/管理工具在下方
 * - Recognition over Recall：每項都帶 icon + 簡短說明
 */
import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { AppActionIcon } from '../ui/AppActionIcon';
import type { GeneratedButtonIconId } from '../ui/generatedButtonIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme, softShadowStyle } from '../ui/theme';
import { BrandFluxImageHeader } from '../ui/BrandFluxImageHeader';
import { useAuth } from '../state/auth';
import { useNotifications } from '../state/notifications';
import { usePermissions } from '../hooks/usePermissions';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  rootNavigateCampusCommunity,
  rootNavigate,
  rootNavigateMeScreen,
  rootNavigateNested,
} from '../app/rootNavigation';

// ─── 全域控制 store ─────────────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();
let drawerState = { visible: false, revision: 0 };
const getDrawerState = () => drawerState;
const subscribeDrawer = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function setDrawerVisible(visible: boolean) {
  // An explicit open also cancels an in-flight close while the modal is visible.
  drawerState = { visible, revision: drawerState.revision + 1 };
  listeners.forEach((listener) => listener());
}

export const headerDrawer = {
  open() {
    setDrawerVisible(true);
  },
  close() {
    setDrawerVisible(false);
  },
  toggle() {
    if (drawerState.visible) this.close();
    else this.open();
  },
  isOpen: () => drawerState.visible,
};

export function useHeaderDrawer(): { visible: boolean; open: () => void; close: () => void } {
  const { visible } = useSyncExternalStore(subscribeDrawer, getDrawerState, getDrawerState);
  return { visible, open: headerDrawer.open, close: headerDrawer.close };
}

type CloseRequest = { revision: number; account: string };

// ─── 抽屜本體 ────────────────────────────────────────────
export function HeaderDrawerHost() {
  const { visible, revision } = useSyncExternalStore(
    subscribeDrawer,
    getDrawerState,
    getDrawerState,
  );
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.85, 360);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const notifs = useNotifications();
  const {
    displayName: roleDisplayName,
    badgeColor,
    can,
    isTeacher,
    isStaff,
    isDepartmentHead,
    isAdmin,
  } = usePermissions();

  const account = `${auth.user?.uid ?? 'guest'}:${auth.profile?.role ?? ''}:${auth.profile?.primarySchoolId ?? auth.profile?.schoolId ?? ''}`;
  const currentAccount = useRef(account);
  currentAccount.current = account;
  const previousAccount = useRef(account);
  const mounted = useRef(false);
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null);
  const pendingClose = useRef<{ request: CloseRequest; action?: () => void } | null>(null);
  const closing =
    visible && closeRequest?.revision === revision && closeRequest.account === account;
  const slide = useRef(new Animated.Value(-drawerWidth)).current;
  const overlay = useRef(new Animated.Value(0)).current;
  const animationSequence = useRef(0);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingClose.current = null;
      animationSequence.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    if (previousAccount.current === account) return;
    previousAccount.current = account;
    pendingClose.current = null;
    headerDrawer.close();
  }, [account]);

  useEffect(() => {
    const sequence = ++animationSequence.current;
    if (!closing) pendingClose.current = null;
    const finishClose = () => {
      const pending = pendingClose.current;
      if (
        !mounted.current ||
        animationSequence.current !== sequence ||
        !pending ||
        pending.request !== closeRequest ||
        !drawerState.visible ||
        drawerState.revision !== closeRequest?.revision ||
        currentAccount.current !== closeRequest.account
      )
        return;
      pendingClose.current = null;
      headerDrawer.close();
      pending.action?.();
    };
    if (!visible || reduceMotion) {
      slide.setValue(visible && !closing ? 0 : -drawerWidth);
      overlay.setValue(visible && !closing ? 1 : 0);
      if (closing) finishClose();
      return;
    }
    const animation = Animated.parallel([
      closing
        ? Animated.timing(slide, {
            toValue: -drawerWidth,
            duration: 200,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          })
        : Animated.spring(slide, {
            toValue: 0,
            tension: 70,
            friction: 12,
            useNativeDriver: true,
          }),
      Animated.timing(overlay, {
        toValue: closing ? 0 : 1,
        duration: closing ? 180 : 220,
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished && closing) finishClose();
    });
    return () => {
      // stop() also calls completion; invalidate it before stopping the animation.
      animationSequence.current += 1;
      animation.stop();
    };
  }, [
    visible,
    revision,
    closeRequest,
    closing,
    account,
    drawerWidth,
    reduceMotion,
    slide,
    overlay,
  ]);

  const requestClose = (action?: () => void) => {
    const current = getDrawerState();
    if (!mounted.current || !current.visible) return;
    const pending = pendingClose.current;
    if (pending?.request.revision === current.revision && pending.request.account === account) {
      // Back or an explicit dismissal may cancel a selection; another row cannot replace it.
      if (!action) pending.action = undefined;
      return;
    }
    const request = { revision: current.revision, account };
    pendingClose.current = { request, action };
    setCloseRequest(request);
  };
  const handleClose = () => requestClose();

  const go = (screen: string, params?: Record<string, unknown>) => {
    requestClose(() => rootNavigateMeScreen(screen, params));
  };

  const handleSignOut = () => {
    const expectedUid = auth.user?.uid;
    const expectedAccount = account;
    const expectedRevision = revision;
    if (!expectedUid || closing) return;
    Alert.alert('登出', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出',
        style: 'destructive',
        onPress: async () => {
          if (!mounted.current || currentAccount.current !== expectedAccount) return;
          try {
            await auth.signOut(expectedUid);
            if (mounted.current && drawerState.revision === expectedRevision) headerDrawer.close();
          } catch {
            if (mounted.current && currentAccount.current === expectedAccount) {
              Alert.alert('尚未登出', '請確認連線後再試一次。');
            }
          }
        },
      },
    ]);
  };

  const identity = auth.user
    ? (auth.profile?.displayName ?? auth.user.email ?? '校園使用者')
    : '校園訪客';

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
          testID="header-drawer-panel"
          accessibilityViewIsModal
          onAccessibilityEscape={handleClose}
          style={{
            width: drawerWidth,
            backgroundColor: theme.colors.bg,
            transform: [{ translateX: slide }],
            ...softShadowStyle({
              shadowColor: theme.mode === 'dark' ? '#050308' : '#000000',
              shadowOpacity: theme.mode === 'dark' ? 0.5 : 0.1,
              shadowRadius: 22,
              shadowOffset: { width: 5, height: 0 },
              elevation: 16,
            }),
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingBottom: insets.bottom + theme.space.section,
            }}
          >
            {/* ─── 頭部：身分卡 ─── */}
            <BrandFluxImageHeader
              variant="drawer"
              paddingTop={insets.top + theme.layout.cardPadding}
              paddingBottom={theme.layout.sectionGapLarge}
              style={{
                paddingHorizontal: theme.layout.screenHorizontalPadding,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: theme.layout.sectionGapLarge,
                }}
              >
                <Pressable
                  onPress={() => go(auth.user ? 'ProfileEdit' : 'SSOLogin')}
                  accessibilityRole="button"
                  accessibilityLabel={auth.user ? '編輯個人資料' : '登入學校帳號'}
                  accessibilityState={{ disabled: closing }}
                  disabled={closing}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <LinearGradient
                    colors={[...theme.gradients.avatar]}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <AppActionIcon name="ic_profile" size={26} />
                  </LinearGradient>
                </Pressable>
                <Pressable
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityLabel="關閉個人選單"
                  style={({ pressed }) => ({
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <AppActionIcon name="ic_close" size={22} />
                </Pressable>
              </View>

              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 18,
                  fontWeight: '700',
                  letterSpacing: -0.3,
                }}
                accessibilityRole="header"
              >
                {identity}
              </Text>
              {auth.user ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
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
                      maxWidth: '100%',
                    }}
                  >
                    <Text style={{ color: theme.colors.onAccent, fontSize: 11, fontWeight: '700' }}>
                      {roleDisplayName}
                    </Text>
                  </View>
                  {auth.profile?.department ? (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                      {auth.profile.department}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {auth.user &&
              auth.profile?.postLoginRoles &&
              auth.profile.postLoginRoles.length > 0 ? (
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 11,
                    lineHeight: 16,
                    marginTop: 8,
                    paddingRight: theme.space.sm,
                  }}
                >
                  目前使用「{roleDisplayName}」；關聯身分：
                  {auth.profile.postLoginRoles.join('、')}。
                </Text>
              ) : null}
              {!auth.user ? (
                <Pressable
                  onPress={() => go('SSOLogin')}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: closing }}
                  disabled={closing}
                  style={({ pressed }) => ({
                    marginTop: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    backgroundColor: theme.colors.accent,
                    borderRadius: theme.radius.md,
                    alignSelf: 'flex-start',
                    minHeight: 44,
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.onAccent, fontSize: 12, fontWeight: '700' }}>
                    學校帳號登入
                  </Text>
                </Pressable>
              ) : null}
            </BrandFluxImageHeader>

            {/* ─── 校園連結（跨 Tab） ─── */}
            <DrawerSection title="校園連結">
              <DrawerRow
                disabled={closing}
                icon="ic_globe_social"
                label="校園社群 · 動態／看板／即時／學伴"
                tint={theme.colors.social}
                onPress={() => requestClose(() => rootNavigateCampusCommunity())}
              />
            </DrawerSection>

            {/* ─── 個人 ─── */}
            <DrawerSection title="個人">
              <DrawerRow
                disabled={closing}
                icon="ic_profile"
                label="個人資料"
                onPress={() => go(auth.user ? 'ProfileEdit' : 'SSOLogin')}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_qr_code"
                label="我的 QR Code"
                onPress={() => go('QRCode')}
              />
              {can('achievements.view') ? (
                <DrawerRow
                  disabled={closing}
                  icon="ic_trophy"
                  label="成就與積分"
                  tint={theme.colors.achievement}
                  onPress={() => go('Achievements')}
                />
              ) : null}
              {can('courses.view') ? (
                <DrawerRow
                  disabled={closing}
                  icon="ic_school"
                  label="學分與畢業規劃"
                  tint={theme.colors.roleTeacher}
                  onPress={() => go('CreditAuditStack')}
                />
              ) : null}
            </DrawerSection>

            {/* ─── 通知與設定 ─── */}
            <DrawerSection title="通知與設定">
              <DrawerRow
                disabled={closing}
                icon="ic_notifications"
                label="通知中心"
                badge={notifs.unreadCount > 0 ? `${notifs.unreadCount}` : undefined}
                tint={theme.colors.warning}
                onPress={() => requestClose(() => rootNavigateNested('訊息', 'Notifications'))}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_options"
                label="通知設定"
                onPress={() => go('NotificationSettings')}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_settings"
                label="一般設定"
                onPress={() => go('Settings')}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_accessibility"
                label="語言與無障礙"
                onPress={() => go('AccessibilitySettings')}
              />
            </DrawerSection>

            <DrawerSection title="課表與訊息">
              <DrawerRow
                disabled={closing}
                icon="ic_tab_study"
                label="我的課表"
                tint={theme.colors.roleTeacher}
                onPress={() => requestClose(() => rootNavigateNested('學習', 'PersonalTimetable'))}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_notifications"
                label="訊息"
                onPress={() => requestClose(() => rootNavigate('訊息'))}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_profile"
                label="找人"
                onPress={() => requestClose(() => rootNavigateNested('訊息', 'FriendSearch'))}
              />
              {__DEV__ ? (
                <DrawerRow
                  disabled={closing}
                  icon="ic_grid_widgets"
                  label="小工具預覽"
                  onPress={() => go('WidgetPreview')}
                />
              ) : null}
            </DrawerSection>

            {/* ─── 角色專屬：管理工具 ─── */}
            {(isAdmin || isDepartmentHead || isTeacher || isStaff) && (
              <DrawerSection title="工作模式">
                {isTeacher && (
                  <DrawerRow
                    disabled={closing}
                    icon="ic_school"
                    label="我的教學課程"
                    tint={theme.colors.roleTeacher}
                    onPress={() => requestClose(() => rootNavigate('學習'))}
                  />
                )}
                {isAdmin && (
                  <>
                    <DrawerRow
                      disabled={closing}
                      icon="ic_admin_shield"
                      label="管理員控制台"
                      tint={theme.colors.roleAdmin}
                      onPress={() => go('AdminDashboard')}
                    />
                    <DrawerRow
                      disabled={closing}
                      icon="ic_verify"
                      label="課程驗證管理"
                      tint={theme.colors.urgent}
                      onPress={() => go('AdminCourseVerify')}
                    />
                  </>
                )}
                {isDepartmentHead && (
                  <DrawerRow
                    disabled={closing}
                    icon="ic_analytics_chart"
                    label="系所審核與數據"
                    tint={theme.colors.calm}
                    onPress={() => requestClose(() => rootNavigate('學習'))}
                  />
                )}
                {isStaff && !isAdmin && (
                  <DrawerRow
                    disabled={closing}
                    icon="ic_facilities_wrench"
                    label="設施與工單（工作首頁）"
                    tint={theme.colors.warning}
                    onPress={() => requestClose(() => rootNavigate('學習'))}
                  />
                )}
                {auth.profile?.merchantAssignments?.some((a) => a.status === 'active') && (
                  <DrawerRow
                    disabled={closing}
                    icon="ic_store_merchant"
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
                disabled={closing}
                icon="ic_privacy_export"
                label="資料匯出"
                onPress={() => go('DataExport')}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_trash_delete"
                label="刪除帳號"
                tint={theme.colors.danger}
                onPress={() => go('AccountDeletion')}
              />
            </DrawerSection>

            {/* ─── 幫助 ─── */}
            <DrawerSection title="幫助">
              <DrawerRow
                disabled={closing}
                icon="ic_help"
                label="幫助中心"
                onPress={() => go('Help')}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_feedback_chat"
                label="意見回饋"
                onPress={() => go('Feedback')}
              />
              <DrawerRow
                disabled={closing}
                icon="ic_bug_report"
                label="回報問題"
                onPress={() => go('BugReport')}
              />
            </DrawerSection>

            {auth.user && (
              <Pressable
                onPress={handleSignOut}
                accessibilityRole="button"
                accessibilityState={{ disabled: closing }}
                disabled={closing}
                style={({ pressed }) => ({
                  marginTop: 24,
                  marginHorizontal: 18,
                  paddingVertical: 13,
                  minHeight: 44,
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
            accessible={false}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── 內部小元件 ────────────────────────────────────────
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text
        accessibilityRole="header"
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
  disabled = false,
}: {
  icon: GeneratedButtonIconId;
  label: string;
  tint?: string;
  badge?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const color = tint ?? theme.colors.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}，${badge} 則未讀通知` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        minHeight: 48,
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
        <AppActionIcon name={icon} size={16} />
      </View>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 14,
          fontWeight: '600',
          flex: 1,
        }}
      >
        {label}
      </Text>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            paddingHorizontal: 6,
            minHeight: 20,
            borderRadius: 10,
            backgroundColor: theme.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.colors.onDanger, fontSize: 10, fontWeight: '700' }}>
            {badge}
          </Text>
        </View>
      ) : null}
      <AppActionIcon name="ic_chevron_forward" size={14} style={{ opacity: 0.7 }} />
    </Pressable>
  );
}

export default HeaderDrawerHost;
