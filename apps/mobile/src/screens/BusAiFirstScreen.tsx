import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';
import { CampusBusArrivals } from '../components/CampusBusArrivals';
import { TAICHUNG_BUS_URL, loadBusRoutes, type CampusBusRoute } from '../features/campusBus';

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
        <CampusBusArrivals
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
