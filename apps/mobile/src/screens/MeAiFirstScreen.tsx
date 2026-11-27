import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AIScreen } from '../ui/aiFirst';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { useNuniSession } from '../state/nuniSession';
import { usePermissions } from '../hooks/usePermissions';
import { safeNavigate } from '../utils/safeNavigate';
import { loadFailureCopy } from '../utils/loadFailureCopy';
import { rootNavigateNested } from '../app/rootNavigation';

type ListRowProps = {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  first?: boolean;
  testID?: string;
  styles: ReturnType<typeof createStyles>;
};

function AccountRow({ title, subtitle, onPress, first, testID, styles: s }: ListRowProps) {
  return (
    <Pressable
      accessible
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => [s.row, !first && s.rowBorder, pressed && s.rowPressed]}
    >
      <View style={s.rowCopy} accessible={false}>
        <Text accessible={false} style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text accessible={false} style={s.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
    </Pressable>
  );
}

export default function MeAiFirstScreen() {
  const s = useThemeStyleSheet(createStyles);
  const navigation = useNavigation();
  const auth = useAuth();
  const platform = useNuniSession();
  const { signOutWithWarning } = auth;
  const { isStudent } = usePermissions();
  const platformReady = !!platform.session && !platform.loading && !platform.error && !platform.pendingLogout;
  const uid = auth.user?.uid;
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const signingOut = useRef(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const busy = Boolean(uid && busyUid === uid);
  const displayName = profile?.displayName?.trim() || auth.user?.displayName?.trim() || '我的帳號';
  const monogram = displayName.charAt(0) || '帳';
  const details = [profile?.department, profile?.studentId ? `學號 ${profile.studentId}` : null]
    .filter(Boolean)
    .join(' · ');
  const go = (screen: string) => () => safeNavigate(navigation, screen);

  const confirmLogout = useCallback(() => {
    if (!uid || signingOut.current) return;
    const requestedUid = uid;
    Alert.alert('登出學校帳號', '確定要登出學校帳號嗎？Google 帳號會保留登入。', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定登出',
        style: 'destructive',
        onPress: async () => {
          if (currentUid.current !== requestedUid || signingOut.current) return;
          signingOut.current = true;
          setBusyUid(requestedUid);
          try {
            await signOutWithWarning();
          } catch {
            if (currentUid.current === requestedUid) Alert.alert('無法登出', '請稍後重試。');
          } finally {
            signingOut.current = false;
            setBusyUid((value) => (value === requestedUid ? null : value));
          }
        },
      },
    ]);
  }, [uid, signOutWithWarning]);

  return (
    <AIScreen contentContainerStyle={s.content}>
      <View style={s.identityBlock}>
        <View style={s.identityHeader}>
          <View
            style={s.monogram}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={s.monogramText}>{monogram}</Text>
          </View>
          <View style={s.identityCopy}>
            <Text accessibilityRole="header" style={s.displayName}>
              {displayName}
            </Text>
            <Text style={s.details}>
              {details || '你的個人內容、帳號與使用設定。'}
            </Text>
          </View>
        </View>

        <View style={s.accountMeta}>
          <Text style={s.metaLabel}>
            {auth.profileLoading ? '正在讀取帳號資料' : '目前登入帳號'}
          </Text>
          <Text style={s.metaValue}>
            {auth.user?.email || profile?.email || '尚未提供電子郵件'}
          </Text>
          {!profile && !auth.profileLoading ? (
            <View style={s.profileAlert}>
              <Text accessibilityRole="alert" style={s.profileAlertText}>
                {uid && !auth.profile
                  ? auth.error || loadFailureCopy()
                  : '目前無法讀取個人檔案，請確認登入狀態。'}
              </Text>
            </View>
          ) : null}
        </View>

        {isStudent && profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="數位學生證，查看卡面與出示學號"
            onPress={go('StudentCard')}
            style={({ pressed }) => [s.primaryCardAction, pressed && s.primaryCardActionPressed]}
          >
            <Ionicons name="id-card-outline" size={20} color={theme.colors.onAccent} />
            <View style={s.rowCopy}>
              <Text style={s.primaryCardTitle}>數位學生證</Text>
              <Text style={s.primaryCardSubtitle}>查看卡面與出示學號</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.onAccent} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>學校帳號資料</Text>
        <View style={s.list}>
          <AccountRow
            first
            title="個人資料"
            subtitle="修改顯示名稱、簡介與電話"
            onPress={go('ProfileEdit')}
            styles={s}
          />
        </View>
      </View>

      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>我的內容</Text>
        <View style={s.list}>
          <AccountRow
            first
            title="收藏的活動"
            subtitle="回到想參加的活動，確認時間與報名方式"
            onPress={() => safeNavigate(navigation, '活動總覽', { saved: '1' })}
            styles={s}
          />
          <AccountRow
            title="個人社群首頁"
            subtitle="整理署名貼文、圖文作品與發表新內容"
            onPress={go('MySocialProfile')}
            styles={s}
          />
          {!!uid && (
            <AccountRow
              title="查看公開社群頁"
              subtitle="查看別人看到的個人介紹與作品"
              onPress={() => rootNavigateNested('訊息', 'CreatorProfile', { memberUid: uid })}
              styles={s}
            />
          )}
        </View>
      </View>

      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>帳號與助理</Text>
        <View style={s.list}>
          <AccountRow
            first
            title="Google 帳號與連線"
            subtitle="管理 Google 帳號、學校資格與店家權限"
            onPress={() => safeNavigate(navigation, 'NuniWorkspace', { tab: 'account' })}
            styles={s}
          />
          {platformReady ? (
            <AccountRow
              title="開啟課表助理"
              subtitle="用已驗證的 nuni 帳號查這堂課與作業"
              onPress={go('NuniTimetableAssistant')}
              styles={s}
            />
          ) : null}
        </View>
      </View>

      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>設定與協助</Text>
        <View style={s.list}>
          <AccountRow
            first
            testID="me-open-settings"
            title="使用設定"
            subtitle="外觀、通知、助理權限與資料管理"
            onPress={go('Settings')}
            styles={s}
          />
          <AccountRow title="幫助與回饋" onPress={go('Help')} styles={s} />
        </View>
      </View>

      <View style={s.signOutSection}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={busy ? undefined : confirmLogout}
          style={({ pressed }) => [
            s.signOutRow,
            busy && s.signOutDisabled,
            pressed && !busy && s.rowPressed,
          ]}
        >
          <Text style={s.signOutText}>{busy ? '正在登出…' : '登出學校帳號'}</Text>
        </Pressable>
      </View>
    </AIScreen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 22,
      paddingTop: 20,
    },
    identityBlock: {
      paddingBottom: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      gap: 16,
    },
    identityHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    monogram: {
      width: 48,
      height: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monogramText: {
      color: theme.colors.accent,
      fontSize: 20,
      fontWeight: '700',
    },
    identityCopy: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    displayName: {
      fontFamily: pageTitleFont,
      color: theme.colors.text,
      fontSize: 26,
      lineHeight: 34,
      fontWeight: '700',
      letterSpacing: -0.4,
    },
    details: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      fontVariant: ['tabular-nums'],
    },
    accountMeta: {
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      gap: 3,
    },
    metaLabel: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '500',
    },
    metaValue: {
      color: theme.colors.text,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '500',
    },
    profileAlert: {
      marginTop: 8,
      paddingLeft: 10,
      paddingVertical: 4,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
    },
    profileAlertText: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 20,
    },
    primaryCardAction: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.accent,
    },
    primaryCardActionPressed: {
      backgroundColor: theme.colors.accentHover,
    },
    primaryCardTitle: {
      color: theme.colors.onAccent,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '600',
    },
    primaryCardSubtitle: {
      color: theme.colors.onAccent,
      opacity: 0.85,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 1,
    },
    section: {
      marginTop: 26,
      gap: 6,
    },
    sectionTitle: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    row: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 2,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    rowSubtitle: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 2,
    },
    signOutSection: {
      marginTop: 28,
      marginBottom: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    signOutRow: {
      minHeight: 50,
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 2,
    },
    signOutDisabled: {
      opacity: 0.5,
    },
    signOutText: {
      color: theme.colors.danger,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    rowPressed: {
      backgroundColor: theme.colors.surfaceInteractive,
    },
  });
