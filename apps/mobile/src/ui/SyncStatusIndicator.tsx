import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import {
  getOfflineQueue,
  getFailedActions,
  subscribeToSyncEvents,
  type QueuedAction,
  type FailedAction,
} from "../services/offline";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

type SyncStatusIndicatorProps = {
  onPress?: () => void;
  compact?: boolean;
};

export function SyncStatusIndicator({ onPress, compact = false }: SyncStatusIndicatorProps) {
  const { isConnected } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const checkQueue = async () => {
      try {
        const queue = await getOfflineQueue();
        const failed = await getFailedActions();
        setPendingCount(queue.length);
        setFailedCount(failed.length);
      } catch {
        setPendingCount(0);
        setFailedCount(0);
      }
    };

    checkQueue();
    const interval = setInterval(checkQueue, 10000);

    const unsubscribe = subscribeToSyncEvents((event) => {
      switch (event.type) {
        case "sync_start":
          setIsSyncing(true);
          setSyncProgress({ processed: 0, total: event.total ?? 0 });
          break;
        case "sync_progress":
          setSyncProgress({ processed: event.processed ?? 0, total: event.total ?? 0 });
          break;
        case "sync_complete":
        case "sync_error":
          setIsSyncing(false);
          setSyncProgress(null);
          checkQueue();
          break;
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isSyncing) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isSyncing, pulseAnim]);

  const totalPending = pendingCount + failedCount;

  if (totalPending === 0 && !isSyncing && isConnected) {
    return null;
  }

  const getStatusConfig = () => {
    if (isSyncing) {
      return {
        icon: "sync" as const,
        color: theme.colors.accent,
        bgColor: theme.colors.accentSoft,
        text: syncProgress
          ? `同步中 (${syncProgress.processed}/${syncProgress.total})`
          : "同步中...",
      };
    }

    if (!isConnected) {
      return {
        icon: "cloud-offline" as const,
        color: "#F59E0B",
        bgColor: "#F59E0B15",
        text: `離線 · ${totalPending} 筆待同步`,
      };
    }

    if (failedCount > 0) {
      return {
        icon: "alert-circle" as const,
        color: theme.colors.error,
        bgColor: theme.colors.error + "15",
        text: `${failedCount} 筆同步失敗`,
      };
    }

    if (pendingCount > 0) {
      return {
        icon: "time" as const,
        color: "#F59E0B",
        bgColor: "#F59E0B15",
        text: `${pendingCount} 筆待同步`,
      };
    }

    return null;
  };

  const config = getStatusConfig();
  if (!config) return null;

  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: config.bgColor,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 12,
          gap: 4,
        }}
      >
        <Animated.View style={{ opacity: isSyncing ? pulseAnim : 1 }}>
          <Ionicons name={config.icon} size={14} color={config.color} />
        </Animated.View>
        {totalPending > 0 && (
          <Text style={{ color: config.color, fontSize: 12, fontWeight: "600" }}>
            {totalPending}
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: config.bgColor,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: theme.radius.md,
        gap: 8,
      }}
    >
      <Animated.View style={{ opacity: isSyncing ? pulseAnim : 1 }}>
        <Ionicons name={config.icon} size={18} color={config.color} />
      </Animated.View>
      <Text style={{ color: config.color, fontSize: 13, fontWeight: "600", flex: 1 }}>
        {config.text}
      </Text>
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color={config.color} />
      )}
    </Pressable>
  );
}

export function useSyncStatus() {
  const { isConnected } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  useEffect(() => {
    const checkQueue = async () => {
      try {
        const queue = await getOfflineQueue();
        const failed = await getFailedActions();
        setPendingCount(queue.length);
        setFailedCount(failed.length);
      } catch {
        setPendingCount(0);
        setFailedCount(0);
      }
    };

    checkQueue();
    const interval = setInterval(checkQueue, 10000);

    const unsubscribe = subscribeToSyncEvents((event) => {
      switch (event.type) {
        case "sync_start":
          setIsSyncing(true);
          setLastSyncError(null);
          break;
        case "sync_complete":
          setIsSyncing(false);
          checkQueue();
          break;
        case "sync_error":
          setIsSyncing(false);
          setLastSyncError(event.error?.message ?? "同步失敗");
          checkQueue();
          break;
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  return {
    isConnected,
    pendingCount,
    failedCount,
    isSyncing,
    lastSyncError,
    hasPendingData: pendingCount > 0 || failedCount > 0,
  };
}
