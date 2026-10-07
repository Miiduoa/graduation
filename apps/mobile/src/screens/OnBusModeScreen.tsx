import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { loadBusJourneyRoute } from '../data/busJourney';
import type { BusRoute } from '../data/types';
import { AIDetailScreen, AICard, AISection, AIRow, AIButton, aiTokens } from '../ui/aiFirst';

type OnBusRouteParams = { routeId?: string; vehicleId?: string; alightStopId?: string };

export function OnBusModeScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = (route.params ?? {}) as OnBusRouteParams;
  const auth = useAuth();
  const uid = auth.user?.uid;
  const schoolId = auth.profile?.uid === uid ? auth.profile?.schoolId : undefined;
  const scope = JSON.stringify([uid, schoolId, params.routeId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    loading: boolean;
    route: BusRoute | null;
    error: string | null;
  } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; stopId: string } | null>(null);
  const data = state?.scope === scope ? state : null;
  const busRoute = data?.route;
  const selectedId = selection?.scope === scope ? selection.stopId : params.alightStopId;
  const selectedStop = busRoute?.stops.find((stop) => stop.id === selectedId);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, loading: true, route: null, error: null });
    try {
      const found = await loadBusJourneyRoute(uid, schoolId, params.routeId);
      if (generation.current === request && currentScope.current === scope) {
        setState({ scope, loading: false, route: found, error: null });
      }
    } catch {
      if (generation.current === request && currentScope.current === scope) {
        setState({
          scope,
          loading: false,
          route: null,
          error: '目前無法讀取這條路線，請確認登入狀態與網路後重試。',
        });
      }
    }
  }, [uid, schoolId, params.routeId, scope]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current += 1;
      };
    }, [load]),
  );

  return (
    <AIDetailScreen title="搭車資訊" onBack={() => navigation.goBack()}>
      <AISection title="即時車況">
        <AICard title="目前未提供車輛即時追蹤">
          <Text style={{ color: aiTokens.textSecondary, fontSize: 14, lineHeight: 22 }}>
            尚無可確認的車輛位置與到站時間。請留意車內報站；此頁不會發送下車提醒或分享車輛位置。
          </Text>
        </AICard>
      </AISection>
      {!data || data.loading ? (
        <ActivityIndicator accessibilityLabel="讀取路線" color={aiTokens.ai} />
      ) : data.error ? (
        <AISection title="路線資料">
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>{data.error}</Text>
            <AIButton label="重新讀取" onPress={() => void load()} />
          </View>
        </AISection>
      ) : !busRoute ? (
        <AISection title="路線資料">
          <AICard title="找不到可用的路線資料">
            <Text style={{ color: aiTokens.textSecondary }}>請返回交通頁，重新選擇路線。</Text>
          </AICard>
        </AISection>
      ) : (
        <>
          <AISection title={busRoute.name} subtitle="路線與站點資料，並非車輛即時位置">
            <AICard title={selectedStop ? `預計下車：${selectedStop.name}` : '選擇預計下車站'}>
              <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>
                {selectedStop
                  ? '已在此頁標記，請自行留意車內報站。'
                  : '點選下方站點，標記這次行程的下車站。'}
              </Text>
            </AICard>
            {busRoute.stops.length ? (
              busRoute.stops.map((stop) => (
                <AIRow
                  key={stop.id}
                  title={stop.name}
                  tag={stop.id === selectedStop?.id ? '預計下車' : undefined}
                  onPress={() => setSelection({ scope, stopId: stop.id })}
                />
              ))
            ) : (
              <Text style={{ color: aiTokens.muted, padding: 16 }}>這條路線尚未提供站點資料。</Text>
            )}
          </AISection>
        </>
      )}
    </AIDetailScreen>
  );
}

export default OnBusModeScreen;
