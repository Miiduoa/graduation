import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';
import {
  BUS_FRESHNESS_MS,
  TAICHUNG_BUS_URL,
  loadBusRoutes,
  loadBusArrivals,
  type CampusBusRoute,
  type BusArrivals,
} from '../features/campusBus';

type Props = { navigation?: { goBack?: () => void } };
export default function BusAiFirstScreen({ navigation }: Props) {
  const { school } = useSchool();
  const { user } = useAuth();
  return (
    <BusDirectory
      key={`${school.id}:${user?.uid ?? 'guest'}`}
      schoolId={school.id}
      navigation={navigation}
    />
  );
}

function Arrivals({
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

function BusDirectory({ schoolId, navigation }: Props & { schoolId: string }) {
  const theme = useTheme();
  const [routes, setRoutes] = useState<CampusBusRoute[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<{
    route: CampusBusRoute;
    stop: CampusBusRoute['stops'][number];
  } | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    setRoutes([]);
    setSelected(null);
    try {
      const result = await loadBusRoutes(schoolId);
      if (active.current && generation.current === request) {
        setRoutes(result);
        setStatus('ready');
      }
    } catch {
      if (active.current && generation.current === request) setStatus('error');
    }
  }, [schoolId]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [load]);
  const openOfficial = async () => {
    if (!active.current || pending.current || schoolId !== 'pu') return;
    pending.current = true;
    setOpening(true);
    setLinkError(false);
    try {
      await Linking.openURL(TAICHUNG_BUS_URL);
    } catch {
      if (active.current) setLinkError(true);
    } finally {
      pending.current = false;
      if (active.current) setOpening(false);
    }
  };
  const body = { ...theme.typography.body, color: theme.colors.muted };
  return (
    <AIDetailScreen
      title="校園公車"
      subtitle="選擇路線與站牌，查詢目前可取得的到站資訊。"
      onBack={() => navigation?.goBack?.()}
    >
      {schoolId === 'pu' ? (
        <AICard title="臺中市公車查詢">
          <View style={{ gap: theme.space.md }}>
            <Text style={body}>路線異動、完整班次與營運資訊，請查看官方公車網站。</Text>
            <AIButton
              label={opening ? '正在開啟…' : '開啟官方公車查詢'}
              disabled={opening}
              onPress={() => void openOfficial()}
            />
            {linkError ? (
              <Text accessibilityRole="alert" style={body}>
                無法開啟公車網站，請確認網路連線後重試。
              </Text>
            ) : null}
          </View>
        </AICard>
      ) : null}
      {status === 'loading' ? (
        <AICard>
          <Text accessibilityRole="progressbar" style={body}>
            正在讀取學校公車路線…
          </Text>
        </AICard>
      ) : null}
      {status === 'error' ? (
        <AICard title="無法讀取公車路線">
          <View style={{ gap: theme.space.md }}>
            <Text accessibilityRole="alert" style={body}>
              請確認網路連線後再試一次。
            </Text>
            <AIButton label="重新讀取路線" onPress={() => void load()} />
          </View>
        </AICard>
      ) : null}
      {status === 'ready' && routes.length === 0 ? (
        <AICard title="尚未提供公車路線">
          <Text style={body}>目前沒有學校發布的路線與站牌資料。</Text>
        </AICard>
      ) : null}
      {selected ? (
        <Arrivals
          key={`${selected.route.id}:${selected.stop.id}`}
          schoolId={schoolId}
          route={selected.route}
          stop={selected.stop}
        />
      ) : null}
      {routes.map((route) => (
        <AICard key={route.id} title={route.name}>
          <View style={{ gap: theme.space.md }}>
            {route.description ? <Text style={body}>{route.description}</Text> : null}
            {route.stops.map((stop) => (
              <AIButton
                key={stop.id}
                label={`${stop.name} · 查到站`}
                variant={
                  selected?.route.id === route.id && selected.stop.id === stop.id
                    ? 'primary'
                    : 'ghost'
                }
                onPress={() => setSelected({ route, stop })}
              />
            ))}
          </View>
        </AICard>
      ))}
    </AIDetailScreen>
  );
}
