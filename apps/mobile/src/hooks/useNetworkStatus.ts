import { useState, useEffect, useRef, useCallback } from "react";
import {
  subscribeToNetworkStatus,
  getNetworkStatus,
  type NetworkStatus,
} from "../services/offline";

/**
 * 判斷是否真正在線
 * isInternetReachable 可能為 null（未知），此時我們保守地認為可能離線
 * 這避免了在網路狀態不確定時執行可能失敗的操作
 */
function isEffectivelyOnline(status: NetworkStatus): boolean {
  // isConnected: 設備是否連接到網路（WiFi/行動網路）
  // isInternetReachable: 是否能真正訪問互聯網
  // 當 isInternetReachable 為 null 時，表示狀態未知，我們採用保守策略
  if (!status.isConnected) return false;
  
  // 如果 isInternetReachable 為 null（未知），我們假設網路可用
  // 但會在實際請求時處理失敗情況
  // 這樣可以避免在網路恢復時過度延遲
  return status.isInternetReachable !== false;
}

/**
 * 判斷是否確定離線（不是未知狀態）
 */
function isDefinitelyOffline(status: NetworkStatus): boolean {
  return !status.isConnected || status.isInternetReachable === false;
}

export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>(getNetworkStatus());
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnectedBanner, setShowReconnectedBanner] = useState(false);
  
  const previousStatusRef = useRef<NetworkStatus>(status);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOfflineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    
    const unsubscribe = subscribeToNetworkStatus((newStatus) => {
      if (!isMountedRef.current) return;
      
      const previousStatus = previousStatusRef.current;
      const previouslyOffline = isDefinitelyOffline(previousStatus);
      const nowOnline = isEffectivelyOnline(newStatus);
      const nowDefinitelyOffline = isDefinitelyOffline(newStatus);

      // 從確定離線狀態恢復到在線時顯示 banner
      if (previouslyOffline && nowOnline) {
        if (bannerTimeoutRef.current) {
          clearTimeout(bannerTimeoutRef.current);
        }
        setShowReconnectedBanner(true);
        bannerTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setShowReconnectedBanner(false);
          }
          bannerTimeoutRef.current = null;
        }, 5000);
      }

      // 只有在確定離線時才設置 wasOffline
      if (nowDefinitelyOffline) {
        // 清除之前的重置計時器
        if (wasOfflineTimeoutRef.current) {
          clearTimeout(wasOfflineTimeoutRef.current);
          wasOfflineTimeoutRef.current = null;
        }
        setWasOffline(true);
      }
      
      // 當網路恢復且穩定時，重置 wasOffline
      if (nowOnline && previouslyOffline && newStatus.isInternetReachable === true) {
        // 清除之前的計時器
        if (wasOfflineTimeoutRef.current) {
          clearTimeout(wasOfflineTimeoutRef.current);
        }
        // 延遲重置，確保網路真的穩定
        wasOfflineTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setWasOffline(false);
          }
          wasOfflineTimeoutRef.current = null;
        }, 3000);
      }

      previousStatusRef.current = newStatus;
      setStatus(newStatus);
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = null;
      }
      if (wasOfflineTimeoutRef.current) {
        clearTimeout(wasOfflineTimeoutRef.current);
        wasOfflineTimeoutRef.current = null;
      }
    };
  }, []);

  const dismissReconnectedBanner = useCallback(() => {
    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current);
      bannerTimeoutRef.current = null;
    }
    setShowReconnectedBanner(false);
  }, []);

  const resetWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  // 計算派生狀態
  const effectivelyOnline = isEffectivelyOnline(status);
  const definitelyOffline = isDefinitelyOffline(status);
  const isUnknown = status.isConnected && status.isInternetReachable === null;

  return {
    // 原始狀態
    isConnected: status.isConnected,
    isInternetReachable: status.isInternetReachable,
    connectionType: status.type,
    
    // 派生狀態（建議使用這些而非原始狀態）
    isOnline: effectivelyOnline,
    isOffline: definitelyOffline,
    isUnknown,
    
    // 歷史狀態
    wasOffline,
    resetWasOffline,
    
    // Banner 控制
    showReconnectedBanner,
    dismissReconnectedBanner,
  };
}
