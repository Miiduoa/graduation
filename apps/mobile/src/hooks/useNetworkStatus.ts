import { useState, useEffect, useRef, useCallback } from 'react';
import {
  subscribeToNetworkStatus,
  getNetworkStatus,
  type NetworkStatus,
} from '../services/offline';

function reachability(status: NetworkStatus): 'offline' | 'online' | 'unknown' {
  if (status.isInternetReachable === false) return 'offline';
  if (!status.isConnected) {
    // NetInfo starts with an unknown transport before its first measurement.
    return status.type === 'unknown' ? 'unknown' : 'offline';
  }
  return status.isInternetReachable === true ? 'online' : 'unknown';
}

export function useNetworkStatus() {
  const [status, setStatus] = useState(getNetworkStatus);
  const [wasOffline, setWasOffline] = useState(() => reachability(status) === 'offline');
  const [showReconnectedBanner, setShowReconnectedBanner] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismissReconnectedBanner = useCallback(() => {
    clearTimeout(bannerTimer.current);
    setShowReconnectedBanner(false);
  }, []);

  useEffect(() => {
    let awaitingRecovery = false;
    let historyTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToNetworkStatus((next) => {
      setStatus(next);
      const state = reachability(next);
      if (state === 'offline') {
        awaitingRecovery = true;
        setWasOffline(true);
        clearTimeout(historyTimer);
        dismissReconnectedBanner();
      } else if (state === 'online' && awaitingRecovery) {
        awaitingRecovery = false;
        setShowReconnectedBanner(true);
        clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(() => setShowReconnectedBanner(false), 5000);
        historyTimer = setTimeout(() => setWasOffline(false), 3000);
      } else if (state === 'unknown') {
        // Connecting to Wi-Fi alone doesn't confirm internet access.
        dismissReconnectedBanner();
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(bannerTimer.current);
      clearTimeout(historyTimer);
    };
  }, [dismissReconnectedBanner]);

  const resetWasOffline = useCallback(() => setWasOffline(false), []);
  const state = reachability(status);
  return {
    isConnected: status.isConnected,
    isInternetReachable: status.isInternetReachable,
    connectionType: status.type,
    // A connected link can attempt requests while the reachability check is pending.
    isOnline: status.isConnected && status.isInternetReachable !== false,
    isOffline: state === 'offline',
    isUnknown: state === 'unknown',
    wasOffline,
    resetWasOffline,
    showReconnectedBanner,
    dismissReconnectedBanner,
  };
}
