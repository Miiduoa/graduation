import { useState, useEffect, useCallback, useRef } from "react";
import * as Location from "expo-location";

export type GeolocationState = {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number | null;
};

export type GeolocationOptions = {
  enableHighAccuracy?: boolean;
  distanceInterval?: number;
  timeInterval?: number;
  autoStart?: boolean;
};

export type GeolocationResult = GeolocationState & {
  loading: boolean;
  error: string | null;
  permissionStatus: Location.PermissionStatus | null;
  requestPermission: () => Promise<boolean>;
  getCurrentPosition: () => Promise<GeolocationState | null>;
  startWatching: () => void;
  stopWatching: () => void;
  isWatching: boolean;
};

const DEFAULT_OPTIONS: GeolocationOptions = {
  enableHighAccuracy: true,
  distanceInterval: 10,
  timeInterval: 5000,
  autoStart: false,
};

/**
 * 地理位置 hook - 獲取和追蹤用戶位置
 */
export function useGeolocation(options: GeolocationOptions = {}): GeolocationResult {
  const { enableHighAccuracy, distanceInterval, timeInterval, autoStart } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    altitude: null,
    accuracy: null,
    heading: null,
    speed: null,
    timestamp: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<Location.PermissionStatus | null>(null);
  const [isWatching, setIsWatching] = useState(false);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const updatePosition = useCallback((location: Location.LocationObject) => {
    setState({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude,
      accuracy: location.coords.accuracy,
      heading: location.coords.heading,
      speed: location.coords.speed,
      timestamp: location.timestamp,
    });
    setError(null);
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(foregroundStatus);
      
      if (foregroundStatus !== "granted") {
        setError("位置權限被拒絕");
        return false;
      }
      
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "請求權限失敗");
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(async (): Promise<GeolocationState | null> => {
    setLoading(true);
    setError(null);

    try {
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        setLoading(false);
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: enableHighAccuracy 
          ? Location.Accuracy.High 
          : Location.Accuracy.Balanced,
      });

      const newState: GeolocationState = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        altitude: location.coords.altitude,
        accuracy: location.coords.accuracy,
        heading: location.coords.heading,
        speed: location.coords.speed,
        timestamp: location.timestamp,
      };

      setState(newState);
      setLoading(false);
      return newState;
    } catch (e) {
      const message = e instanceof Error ? e.message : "獲取位置失敗";
      setError(message);
      setLoading(false);
      return null;
    }
  }, [enableHighAccuracy, requestPermission]);

  const startWatching = useCallback(async () => {
    if (subscriptionRef.current) return;

    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    setIsWatching(true);

    try {
      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: enableHighAccuracy 
            ? Location.Accuracy.High 
            : Location.Accuracy.Balanced,
          distanceInterval,
          timeInterval,
        },
        (location) => {
          updatePosition(location);
        }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始追蹤失敗");
      setIsWatching(false);
    }
  }, [distanceInterval, enableHighAccuracy, requestPermission, timeInterval, updatePosition]);

  const stopWatching = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    setIsWatching(false);
  }, []);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setPermissionStatus(status);
    });
  }, []);

  useEffect(() => {
    let isCancelled = false;
    
    if (autoStart) {
      // 使用 IIFE 處理 async，並在 subscription 建立前檢查是否已取消
      (async () => {
        if (isCancelled) return;
        
        if (subscriptionRef.current) return;
        
        const hasPermission = await requestPermission();
        if (!hasPermission || isCancelled) return;

        setIsWatching(true);

        try {
          const subscription = await Location.watchPositionAsync(
            {
              accuracy: enableHighAccuracy 
                ? Location.Accuracy.High 
                : Location.Accuracy.Balanced,
              distanceInterval,
              timeInterval,
            },
            (location) => {
              if (!isCancelled) {
                updatePosition(location);
              }
            }
          );
          
          // 再次檢查是否已取消，如果是則立即清除 subscription
          if (isCancelled) {
            subscription.remove();
          } else {
            subscriptionRef.current = subscription;
          }
        } catch (e) {
          if (!isCancelled) {
            setError(e instanceof Error ? e.message : "開始追蹤失敗");
            setIsWatching(false);
          }
        }
      })();
    }

    return () => {
      isCancelled = true;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      setIsWatching(false);
    };
  }, [autoStart, enableHighAccuracy, distanceInterval, timeInterval, requestPermission, updatePosition]);

  return {
    ...state,
    loading,
    error,
    permissionStatus,
    requestPermission,
    getCurrentPosition,
    startWatching,
    stopWatching,
    isWatching,
  };
}

/**
 * 計算兩點之間的距離（公尺）
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * 計算方位角
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}
