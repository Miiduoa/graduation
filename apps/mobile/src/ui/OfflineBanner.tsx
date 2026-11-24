import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getThemeVersion, subscribeToTheme, theme } from './theme';
import { useThemeStyleSheet } from './useThemeStyleSheet';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useAnimatedValue } from '../hooks/useAnimatedValue';
import { getOfflineQueueLength, isSyncing, subscribeToSyncEvents } from '../services/offline';

const OFFLINE_TIPS_DISMISSED_KEY = '@offline_tips_dismissed';

type BannerType = 'offline' | 'reconnected' | 'syncing';

type OfflineBannerProps = {
  visible?: boolean;
  type?: BannerType;
  message?: string;
  onDismiss?: () => void;
};

/** 內部共用的橫幅 UI，避免 NetworkStatusBanner 依賴 OfflineBanner 名稱造成載入順序錯誤 */
function BannerView({
  type,
  message,
  onDismiss,
  renderAction,
  announce,
}: {
  type: BannerType;
  message?: string;
  onDismiss?: () => void;
  /** 在橫幅右側渲染額外操作，會收到目前橫幅的前景色 */
  renderAction?: (color: string) => React.ReactNode;
  /** 僅由 NetworkStatusBanner 開啟，避免其他使用處重複播報 */
  announce?: boolean;
}) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const getConfig = () => {
    switch (type) {
      case 'offline':
        return {
          icon: 'cloud-offline' as const,
          color: theme.colors.warning,
          bgColor: theme.colors.warningSoft,
          text: message || '目前處於離線模式',
        };
      case 'reconnected':
        return {
          icon: 'cloud-done' as const,
          color: theme.colors.success,
          bgColor: theme.colors.successSoft,
          text: message || '已重新連線',
        };
      case 'syncing':
        return {
          icon: 'sync' as const,
          color: theme.colors.accent,
          bgColor: theme.colors.accentSoft,
          text: message || '正在同步資料...',
        };
    }
  };
  const config = getConfig();
  const hasControls = Boolean(onDismiss || renderAction);
  return (
    <View
      style={{
        backgroundColor: config.bgColor,
        // 有可點擊控制項時由 44pt 觸控目標撐開高度
        paddingVertical: hasControls ? 0 : 10,
        paddingHorizontal: 16,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Ionicons
        accessible={false}
        importantForAccessibility="no"
        name={config.icon}
        size={18}
        color={config.color}
      />
      <Text
        accessibilityLiveRegion={announce ? 'polite' : undefined}
        style={{ color: config.color, flex: 1, fontWeight: '600', fontSize: 14 }}
      >
        {config.text}
      </Text>
      {renderAction?.(config.color)}
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="關閉網路狀態提示"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={18} color={config.color} />
        </Pressable>
      )}
    </View>
  );
}

export function OfflineBanner({
  visible,
  type = 'offline',
  message,
  onDismiss,
}: OfflineBannerProps) {
  if (!visible) return null;
  return <BannerView type={type} message={message} onDismiss={onDismiss} />;
}

function useBannerQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(isSyncing);
  useEffect(() => {
    let version = 0;
    const refresh = () => {
      const current = ++version;
      setSyncing(isSyncing());
      void getOfflineQueueLength().then(
        (count) => {
          if (version === current) setPendingCount(count);
        },
        () => {},
      );
    };
    const unsubscribe = subscribeToSyncEvents((event) => {
      if (event.type === 'queued' && event.queueLength !== undefined) {
        ++version;
        setPendingCount(event.queueLength);
      } else {
        refresh();
      }
    });
    refresh();
    // Silent additions and manual clears do not publish a sync event.
    const timer = setInterval(refresh, 10000);
    return () => {
      ++version;
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  return { pendingCount, syncing };
}

function DisclosureChevron({ expanded, color }: { expanded: boolean; color: string }) {
  const reducedMotion = useReducedMotion();
  const progress = useAnimatedValue(expanded ? 1 : 0);
  const previous = useRef(expanded);

  useEffect(() => {
    const changed = previous.current !== expanded;
    previous.current = expanded;
    const toValue = expanded ? 1 : 0;
    if (!changed || reducedMotion) {
      progress.setValue(toValue);
      return;
    }
    const turn = Animated.timing(progress, {
      toValue,
      duration: 150,
      useNativeDriver: true,
      isInteraction: false,
    });
    turn.start();
    return () => turn.stop();
  }, [expanded, reducedMotion, progress]);

  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ transform: [{ rotate }] }}
    >
      <Ionicons name="chevron-down" size={16} color={color} />
    </Animated.View>
  );
}

function VisibleNetworkBanner({
  isOffline,
  tipsDismissed,
  dismissTips,
  dismissReconnectedBanner,
}: {
  isOffline: boolean;
  tipsDismissed: boolean;
  dismissTips: () => void;
  dismissReconnectedBanner: () => void;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const { height } = useWindowDimensions();
  const { pendingCount, syncing } = useBannerQueue();
  const [showTips, setShowTips] = useState(false);
  useEffect(() => {
    if (!isOffline) setShowTips(false);
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibilityWithOptions(
        isOffline ? '目前處於離線模式' : '已重新連線',
        { queue: true },
      );
    }
  }, [isOffline]);

  if (isOffline) {
    const message = pendingCount > 0 ? `離線模式 · ${pendingCount} 項待同步` : undefined;

    // 已永久關閉說明：只剩不可互動的狀態橫幅
    if (tipsDismissed) {
      return <BannerView type="offline" message={message} announce />;
    }

    return (
      <View>
        <BannerView
          type="offline"
          message={message}
          announce
          renderAction={(color) => (
            <Pressable
              onPress={() => setShowTips((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel="離線模式說明"
              accessibilityState={{ expanded: showTips }}
              style={styles.disclosureButton}
            >
              <Text style={[styles.disclosureLabel, { color }]}>說明</Text>
              <DisclosureChevron expanded={showTips} color={color} />
            </Pressable>
          )}
        />

        {showTips && (
          <ScrollView
            style={{ maxHeight: height * 0.4, flexGrow: 0 }}
            contentContainerStyle={styles.tipsContainer}
          >
            <Text style={styles.tipText}>離線時可以查看已快取的資料和已下載的課表。</Text>
            <Text style={styles.tipText}>
              標示「待同步」的變更會在連線後嘗試送出。其他需要網路的操作，請連線後再試。
            </Text>
            <Pressable
              onPress={dismissTips}
              accessibilityRole="button"
              accessibilityLabel="不再顯示離線模式說明"
              style={styles.tipsCloseButton}
            >
              <Text style={styles.tipsClose}>不再顯示說明</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    );
  }

  const message = syncing
    ? '已重新連線 · 正在同步'
    : pendingCount > 0
      ? `已重新連線 · ${pendingCount} 項待同步`
      : undefined;
  return (
    <BannerView
      type={syncing ? 'syncing' : 'reconnected'}
      message={message}
      onDismiss={dismissReconnectedBanner}
      announce
    />
  );
}

export function NetworkStatusBanner() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { isOffline, showReconnectedBanner, dismissReconnectedBanner } = useNetworkStatus();
  const [tipsDismissed, setTipsDismissed] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(OFFLINE_TIPS_DISMISSED_KEY).then(
      (value) => {
        if (mounted && value === 'true') setTipsDismissed(true);
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, []);
  const dismissTips = useCallback(() => {
    setTipsDismissed(true);
    void AsyncStorage.setItem(OFFLINE_TIPS_DISMISSED_KEY, 'true').catch(() => {});
  }, []);

  if (!isOffline && !showReconnectedBanner) return null;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.colors.bg }}>
      <VisibleNetworkBanner
        isOffline={isOffline}
        tipsDismissed={tipsDismissed}
        dismissTips={dismissTips}
        dismissReconnectedBanner={dismissReconnectedBanner}
      />
    </SafeAreaView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    tipsContainer: {
      backgroundColor: theme.colors.surface2,
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    tipsClose: {
      color: theme.colors.muted,
      fontSize: 12,
    },
    tipsCloseButton: {
      minHeight: 44,
      minWidth: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
    },
    disclosureButton: {
      minHeight: 44,
      minWidth: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    disclosureLabel: {
      fontSize: 12,
      fontWeight: '600',
    },
    tipText: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 21,
    },
  });

export function OfflineIndicator() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { isOffline } = useNetworkStatus();

  if (!isOffline) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: theme.colors.warningSoft,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Ionicons name="cloud-offline" size={12} color={theme.colors.warning} />
      <Text style={{ color: theme.colors.warning, fontSize: 10, fontWeight: '700' }}>離線</Text>
    </View>
  );
}

export function OfflineDataNotice({ cachedAt }: { cachedAt?: number }) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  if (!cachedAt) return null;

  const now = Date.now();
  const ageMs = now - cachedAt;
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMs / 3600000);

  let ageText: string;
  if (ageMinutes < 1) {
    ageText = '剛剛';
  } else if (ageMinutes < 60) {
    ageText = `${ageMinutes} 分鐘前`;
  } else if (ageHours < 24) {
    ageText = `${ageHours} 小時前`;
  } else {
    ageText = `${Math.floor(ageHours / 24)} 天前`;
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: theme.colors.surface2,
        borderRadius: theme.radius.md,
        marginBottom: 8,
      }}
    >
      <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>離線資料 · 更新於 {ageText}</Text>
    </View>
  );
}
