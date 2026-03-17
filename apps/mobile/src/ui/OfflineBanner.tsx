import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Animated, Pressable, Modal, ScrollView, Dimensions, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "./theme";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { getOfflineQueueLength } from "../services/offline";

const OFFLINE_GUIDE_KEY = "@offline_guide_shown";
const OFFLINE_TIPS_DISMISSED_KEY = "@offline_tips_dismissed";

type BannerType = "offline" | "reconnected" | "syncing";

type OfflineBannerProps = {
  visible?: boolean;
  type?: BannerType;
  message?: string;
  onDismiss?: () => void;
};

export function OfflineBanner({
  visible,
  type = "offline",
  message,
  onDismiss,
}: OfflineBannerProps) {
  const getConfig = () => {
    switch (type) {
      case "offline":
        return {
          icon: "cloud-offline" as const,
          color: "#F59E0B",
          bgColor: "#F59E0B15",
          text: message || "目前處於離線模式",
        };
      case "reconnected":
        return {
          icon: "cloud-done" as const,
          color: "#22C55E",
          bgColor: "#22C55E15",
          text: message || "已重新連線",
        };
      case "syncing":
        return {
          icon: "sync" as const,
          color: theme.colors.accent,
          bgColor: theme.colors.accentSoft,
          text: message || "正在同步資料...",
        };
    }
  };

  if (!visible) return null;

  const config = getConfig();

  return (
    <View
      style={{
        backgroundColor: config.bgColor,
        paddingVertical: 10,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Ionicons name={config.icon} size={18} color={config.color} />
      <Text style={{ color: config.color, flex: 1, fontWeight: "600", fontSize: 13 }}>
        {config.text}
      </Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={10}>
          <Ionicons name="close" size={18} color={config.color} />
        </Pressable>
      )}
    </View>
  );
}

export function NetworkStatusBanner() {
  const { isConnected, isOnline, showReconnectedBanner, dismissReconnectedBanner, wasOffline } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [showTips, setShowTips] = useState(false);
  const [tipsDismissed, setTipsDismissed] = useState(false);
  
  // 檢查離線佇列中的待同步項目
  useEffect(() => {
    const checkQueue = async () => {
      try {
        const count = await getOfflineQueueLength();
        setPendingCount(count);
      } catch {
        // 忽略錯誤
      }
    };
    
    checkQueue();
    const interval = setInterval(checkQueue, 10000);
    return () => clearInterval(interval);
  }, []);
  
  // 檢查是否已關閉提示
  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_TIPS_DISMISSED_KEY).then((value) => {
      setTipsDismissed(value === "true");
    });
  }, []);
  
  const dismissTips = useCallback(async () => {
    setShowTips(false);
    setTipsDismissed(true);
    await AsyncStorage.setItem(OFFLINE_TIPS_DISMISSED_KEY, "true");
  }, []);

  if (!isConnected) {
    return (
      <View>
        <Pressable onPress={() => !tipsDismissed && setShowTips(!showTips)}>
          <OfflineBanner 
            visible 
            type="offline"
            message={pendingCount > 0 ? `離線模式 · ${pendingCount} 項待同步` : undefined}
          />
        </Pressable>
        
        {/* 離線提示擴展面板 */}
        {showTips && !tipsDismissed && (
          <View style={styles.tipsContainer}>
            <View style={styles.tipsHeader}>
              <Text style={styles.tipsTitle}>離線模式說明</Text>
              <Pressable onPress={dismissTips} hitSlop={10}>
                <Text style={styles.tipsClose}>不再顯示</Text>
              </Pressable>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
              <Text style={styles.tipText}>可以瀏覽已快取的公告、活動、地圖</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
              <Text style={styles.tipText}>可以查看已下載的課表</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="time" size={16} color="#F59E0B" />
              <Text style={styles.tipText}>新的操作會在連線後自動同步</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="close-circle" size={16} color={theme.colors.danger} />
              <Text style={styles.tipText}>部分即時功能暫時無法使用</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  if (showReconnectedBanner) {
    return (
      <OfflineBanner
        visible
        type={pendingCount > 0 ? "syncing" : "reconnected"}
        message={pendingCount > 0 ? `正在同步 ${pendingCount} 項變更...` : undefined}
        onDismiss={dismissReconnectedBanner}
      />
    );
  }

  return null;
}

const styles = StyleSheet.create({
  tipsContainer: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tipsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  tipsTitle: {
    color: theme.colors.text,
    fontWeight: "700",
    fontSize: 13,
  },
  tipsClose: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  tipItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  tipText: {
    color: theme.colors.muted,
    fontSize: 12,
    flex: 1,
  },
});

export function OfflineIndicator() {
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        backgroundColor: "#F59E0B",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Ionicons name="cloud-offline" size={12} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>離線</Text>
    </View>
  );
}

export function OfflineDataNotice({ cachedAt }: { cachedAt?: number }) {
  if (!cachedAt) return null;

  const now = Date.now();
  const ageMs = now - cachedAt;
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMs / 3600000);

  let ageText: string;
  if (ageMinutes < 1) {
    ageText = "剛剛";
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
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: theme.colors.surface2,
        borderRadius: theme.radius.md,
        marginBottom: 8,
      }}
    >
      <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
        離線資料 · 更新於 {ageText}
      </Text>
    </View>
  );
}
