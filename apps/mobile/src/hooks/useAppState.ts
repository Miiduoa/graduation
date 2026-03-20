/**
 * useAppState Hook
 * 監聽 App 前後台切換狀態
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useLatestValue } from "./useLatestValue";

export interface AppStateOptions {
  onForeground?: () => void;
  onBackground?: () => void;
  onActive?: () => void;
  onInactive?: () => void;
}

export interface AppStateResult {
  appState: AppStateStatus;
  isActive: boolean;
  isBackground: boolean;
  isInactive: boolean;
  lastActiveAt: Date | null;
  backgroundDuration: number;
}

export function useAppState(options?: AppStateOptions): AppStateResult {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [lastActiveAt, setLastActiveAt] = useState<Date | null>(null);
  const [backgroundDuration, setBackgroundDuration] = useState(0);
  const backgroundStartRef = useRef<Date | null>(null);
  const optionsRef = useLatestValue(options);
  const appStateRef = useLatestValue(appState);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const prevState = appState;

      if (nextAppState === "active" && prevState !== "active") {
        if (backgroundStartRef.current) {
          const duration = Date.now() - backgroundStartRef.current.getTime();
          setBackgroundDuration(duration);
          backgroundStartRef.current = null;
        }
        setLastActiveAt(new Date());
        optionsRef.current?.onForeground?.();
        optionsRef.current?.onActive?.();
      }

      if (nextAppState === "background" && prevState !== "background") {
        backgroundStartRef.current = new Date();
        optionsRef.current?.onBackground?.();
      }

      if (nextAppState === "inactive" && prevState !== "inactive") {
        optionsRef.current?.onInactive?.();
      }

      setAppState(nextAppState);
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [appStateRef, optionsRef]);

  return {
    appState,
    isActive: appState === "active",
    isBackground: appState === "background",
    isInactive: appState === "inactive",
    lastActiveAt,
    backgroundDuration,
  };
}

export function useAppStateCallback(
  callback: (state: AppStateStatus) => void,
  deps: React.DependencyList = []
): void {
  const callbackRef = useLatestValue(callback);

  useEffect(() => {
    const handleChange = (state: AppStateStatus) => {
      callbackRef.current(state);
    };

    const subscription = AppState.addEventListener("change", handleChange);
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useForegroundEffect(
  effect: () => void | (() => void),
  deps: React.DependencyList = []
): void {
  const effectRef = useLatestValue(effect);
  const cleanupRef = useRef<void | (() => void)>(undefined);
  const wasBackgroundRef = useRef(false);

  useEffect(() => {
    cleanupRef.current = effectRef.current();

    const handleChange = (state: AppStateStatus) => {
      if (state === "background") {
        wasBackgroundRef.current = true;
      } else if (state === "active" && wasBackgroundRef.current) {
        wasBackgroundRef.current = false;
        if (cleanupRef.current) {
          cleanupRef.current();
        }
        cleanupRef.current = effectRef.current();
      }
    };

    const subscription = AppState.addEventListener("change", handleChange);

    return () => {
      subscription.remove();
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useAppRefresh(
  refreshFn: () => void | Promise<void>,
  options: {
    minBackgroundDuration?: number;
    refreshOnMount?: boolean;
  } = {}
): { refresh: () => void; isRefreshing: boolean } {
  const { minBackgroundDuration = 30000, refreshOnMount = false } = options;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const backgroundStartRef = useRef<Date | null>(null);
  const refreshFnRef = useLatestValue(refreshFn);

  const doRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshFnRef.current();
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (refreshOnMount) {
      doRefresh();
    }

    const handleChange = (state: AppStateStatus) => {
      if (state === "background") {
        backgroundStartRef.current = new Date();
      } else if (state === "active" && backgroundStartRef.current) {
        const duration = Date.now() - backgroundStartRef.current.getTime();
        backgroundStartRef.current = null;

        if (duration >= minBackgroundDuration) {
          doRefresh();
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleChange);
    return () => subscription.remove();
  }, [minBackgroundDuration, refreshOnMount, doRefresh]);

  return { refresh: doRefresh, isRefreshing };
}

export function useKeepAwake(shouldKeepAwake: boolean = true): void {
  useEffect(() => {
    if (!shouldKeepAwake) return;

    let keepAwakeInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const ExpoKeepAwake = require("expo-keep-awake");
      if (shouldKeepAwake) {
        ExpoKeepAwake.activateKeepAwake();
      }
      return () => {
        ExpoKeepAwake.deactivateKeepAwake();
      };
    } catch {
      keepAwakeInterval = setInterval(() => {}, 10000);
      return () => {
        if (keepAwakeInterval) {
          clearInterval(keepAwakeInterval);
        }
      };
    }
  }, [shouldKeepAwake]);
}
