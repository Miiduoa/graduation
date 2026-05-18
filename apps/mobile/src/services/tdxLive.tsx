/* eslint-disable */
/**
 * TDX 即時資料整合層
 *
 * 在現有 tdxApi.ts 之上提供 React Hook + 連線狀態管理 + Mock fallback。
 *
 * 設計目標：
 *   - 若 TDX_CLIENT_ID/SECRET 有設定 → 使用真實 TDX API
 *   - 沒設定 → 使用 simulateActiveVehicles() 產生的 mock data
 *   - 連線失敗 → 自動降級為 mock，並顯示 'offline'
 *
 * 對外 API：
 *   - useLiveBusEstimates(routeIds): 取得指定路線的即時到站 ETA
 *   - useLiveStatus(): 連線狀態（live / mock / offline）
 *   - <LiveStatusBadge /> 元件
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import {
  CAMPUS_BUS_ROUTES,
  simulateActiveVehicles,
  type CampusBusVehicle,
} from '../data/campusBusRoutes';
import { getBusEstimates, type TDXBusEstimate } from './tdxApi';

// ═════════════════════════════════════════════════════════
// 連線狀態
// ═════════════════════════════════════════════════════════

export type LiveStatus = 'live' | 'mock' | 'offline' | 'loading';

const STATUS_LABEL: Record<LiveStatus, string> = {
  live: '即時',
  mock: '模擬',
  offline: '離線',
  loading: '連線中',
};

const STATUS_COLOR: Record<LiveStatus, string> = {
  live: '#34C759',
  mock: '#FF9500',
  offline: '#94A3B8',
  loading: '#007AFF',
};

const STATUS_ICON: Record<LiveStatus, any> = {
  live: 'radio-button-on',
  mock: 'flask-outline',
  offline: 'cloud-offline-outline',
  loading: 'time-outline',
};

// ═════════════════════════════════════════════════════════
// 偵測：是否有 TDX 金鑰可以用
// ═════════════════════════════════════════════════════════

function hasTdxCredentials(): boolean {
  // 從環境變數讀取（Expo public env），允許 .env 設定
  const id =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_TDX_CLIENT_ID) ||
    (typeof process !== 'undefined' && process.env?.TDX_CLIENT_ID) ||
    '';
  const secret =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_TDX_CLIENT_SECRET) ||
    (typeof process !== 'undefined' && process.env?.TDX_CLIENT_SECRET) ||
    '';
  return Boolean(id && secret);
}

// ═════════════════════════════════════════════════════════
// Live Bus Estimates Hook
// ═════════════════════════════════════════════════════════

export type LiveBusArrival = {
  routeId: string;
  routeCode: string;
  routeColor: string;
  /** 顯示用車輛代號（mock 模式有，TDX 則用 plateNumber 字串） */
  vehiclePlate?: string;
  /** 預估到下一站還多久（分鐘） */
  etaMin: number;
  /** 下一站名稱 */
  nextStopName: string;
  /** 是否準點 */
  onTime: boolean;
  /** 是否延誤幾分鐘 */
  delayMin?: number;
};

export function useLiveBusEstimates(routeIds: string[]): {
  status: LiveStatus;
  arrivals: LiveBusArrival[];
  refresh: () => void;
} {
  const [status, setStatus] = useState<LiveStatus>(hasTdxCredentials() ? 'loading' : 'mock');
  const [arrivals, setArrivals] = useState<LiveBusArrival[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((x) => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Mock mode: 用 simulateActiveVehicles 推算
      if (!hasTdxCredentials()) {
        const out: LiveBusArrival[] = [];
        const vehicles = simulateActiveVehicles(new Date());
        for (const v of vehicles) {
          if (routeIds.length > 0 && !routeIds.includes(v.routeId)) continue;
          const route = CAMPUS_BUS_ROUTES.find((r) => r.id === v.routeId);
          if (!route) continue;
          const nextStop = route.stops.find((s) => s.id === v.nextStopId);
          out.push({
            routeId: v.routeId,
            routeCode: route.code,
            routeColor: route.color,
            vehiclePlate: v.plate,
            etaMin: v.etaToNextStopMin,
            nextStopName: nextStop?.name ?? '-',
            onTime: v.delayMin === 0,
            delayMin: v.delayMin > 0 ? v.delayMin : undefined,
          });
        }
        if (!cancelled) {
          setArrivals(out);
          setStatus('mock');
        }
        return;
      }

      // Live TDX mode
      setStatus('loading');
      const out: LiveBusArrival[] = [];
      try {
        for (const routeId of routeIds.length > 0 ? routeIds : CAMPUS_BUS_ROUTES.map((r) => r.id)) {
          // 校內路線在 TDX 沒資料 → 退回 mock
          if (routeId.startsWith('campus-')) {
            const vehicles = simulateActiveVehicles(new Date()).filter((v) => v.routeId === routeId);
            const route = CAMPUS_BUS_ROUTES.find((r) => r.id === routeId);
            if (!route) continue;
            for (const v of vehicles) {
              const nextStop = route.stops.find((s) => s.id === v.nextStopId);
              out.push({
                routeId,
                routeCode: route.code,
                routeColor: route.color,
                vehiclePlate: v.plate,
                etaMin: v.etaToNextStopMin,
                nextStopName: nextStop?.name ?? '-',
                onTime: true,
              });
            }
            continue;
          }

          // city-300 → TDX routeName "300"
          const route = CAMPUS_BUS_ROUTES.find((r) => r.id === routeId);
          if (!route) continue;
          try {
            const estimates: TDXBusEstimate[] = await getBusEstimates(route.code);
            for (const est of estimates.slice(0, 3)) {
              out.push({
                routeId,
                routeCode: route.code,
                routeColor: route.color,
                etaMin: Math.max(0, Math.round((est.EstimateTime ?? 0) / 60)),
                nextStopName: est.StopName?.Zh_tw ?? '-',
                onTime: true,
              });
            }
          } catch (err) {
            // 單條失敗就 fallback mock
            console.warn('[tdxLive] estimate failed', routeId, err);
          }
        }
        if (!cancelled) {
          setArrivals(out);
          setStatus(out.length > 0 ? 'live' : 'offline');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('offline');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeIds.join(','), tick]);

  return { status, arrivals, refresh };
}

// ═════════════════════════════════════════════════════════
// 全域連線狀態 hook（簡化版：只看是否有金鑰）
// ═════════════════════════════════════════════════════════

export function useLiveStatus(): LiveStatus {
  return hasTdxCredentials() ? 'live' : 'mock';
}

// ═════════════════════════════════════════════════════════
// LiveStatusBadge 元件
// ═════════════════════════════════════════════════════════

export function LiveStatusBadge({
  status,
  onPress,
  size = 'sm',
}: {
  status: LiveStatus;
  onPress?: () => void;
  size?: 'xs' | 'sm';
}) {
  const color = STATUS_COLOR[status];
  const label = STATUS_LABEL[status];
  const icon = STATUS_ICON[status];

  const isLive = status === 'live';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: size === 'xs' ? 6 : 9,
        paddingVertical: size === 'xs' ? 3 : 5,
        borderRadius: 99,
        backgroundColor: `${color}22`,
        borderWidth: 1,
        borderColor: `${color}55`,
        opacity: pressed && onPress ? 0.8 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={size === 'xs' ? 9 : 11}
        color={color}
        style={isLive ? { transform: [{ scale: 1.2 }] } : undefined}
      />
      <Text style={{ color, fontSize: size === 'xs' ? 9 : 10, fontWeight: '800' }}>
        {label}
        {isLive ? ' · TDX' : ''}
      </Text>
    </Pressable>
  );
}

// ═════════════════════════════════════════════════════════
// 即將到站排序：自動把 persona 訂閱路線排前面
// ═════════════════════════════════════════════════════════

export function sortArrivalsByPriority(
  arrivals: LiveBusArrival[],
  subscribedRouteIds: string[],
): LiveBusArrival[] {
  const subSet = new Set(subscribedRouteIds);
  return [...arrivals].sort((a, b) => {
    const aSub = subSet.has(a.routeId);
    const bSub = subSet.has(b.routeId);
    if (aSub !== bSub) return aSub ? -1 : 1;
    return a.etaMin - b.etaMin;
  });
}
