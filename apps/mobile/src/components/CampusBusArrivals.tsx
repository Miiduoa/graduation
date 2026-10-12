import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useTheme } from '../state/theme';
import { AICard, AIButton } from '../ui/aiFirst';
import {
  BUS_FRESHNESS_MS,
  loadBusArrivals,
  type CampusBusRoute,
  type BusArrivals,
} from '../features/campusBus';

export function CampusBusArrivals({
  schoolId,
  route,
  stop,
}: {
  schoolId: string;
  route: CampusBusRoute;
  stop: CampusBusRoute['stops'][number];
}) {
  const theme = useTheme();
  const [data, setData] = useState<BusArrivals | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    setLoading(true);
    setData(null);
    const result = await loadBusArrivals({ schoolId, stopId: stop.id, city: route.city });
    if (generation.current !== request) return;
    inFlight.current = false;
    setData(result);
    setLoading(false);
  }, [schoolId, stop.id, route.city]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      generation.current += 1;
      inFlight.current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);
  useEffect(() => {
    if (data?.status !== 'ready') return;
    const timer = setTimeout(
      () => setData({ status: 'unavailable', arrivals: [], fetchedAt: null }),
      Math.max(0, Date.parse(data.fetchedAt) + BUS_FRESHNESS_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [data]);
  const body = { ...theme.typography.body, color: theme.colors.muted };
  return (
    <AICard title={`${stop.name} 到站資訊`}>
      <View style={{ gap: theme.space.md }}>
        {loading ? (
          <Text accessibilityRole="progressbar" style={body}>
            正在查詢到站資訊…
          </Text>
        ) : null}
        {data?.status === 'error' ? (
          <Text accessibilityRole="alert" style={body}>
            無法連線取得到站資訊，請重新查詢或使用官方公車網站。
          </Text>
        ) : null}
        {data?.status === 'unavailable' ? (
          <Text style={body}>目前沒有可確認的即時到站資訊，請使用官方查詢確認班次。</Text>
        ) : null}
        {data?.status === 'ready' ? (
          <>
            <Text style={body}>
              交通部 TDX 資料 ·{' '}
              {new Date(data.fetchedAt).toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              取得
            </Text>
            {data.arrivals.length ? (
              data.arrivals.map((arrival, index) => (
                <Text
                  key={`${arrival.routeName}:${arrival.direction}:${index}`}
                  style={{ ...theme.typography.body, color: theme.colors.text }}
                >
                  {arrival.routeName} {arrival.direction} · {arrival.label}
                </Text>
              ))
            ) : (
              <Text style={body}>資料服務未提供本站的到站預估，請再向官方查詢。</Text>
            )}
          </>
        ) : null}
        <AIButton
          label={loading ? '正在更新…' : '更新到站資訊'}
          disabled={loading}
          onPress={() => void refresh()}
          variant="ghost"
        />
      </View>
    </AICard>
  );
}
