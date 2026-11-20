import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { loadBusRoutes, TAICHUNG_BUS_URL, type CampusBusRoute } from '../features/campusBus';
import { useTheme } from '../state/theme';
import { CampusBusArrivals } from './CampusBusArrivals';

type Match = { route: CampusBusRoute; stop: CampusBusRoute['stops'][number] };
type State = { status: 'loading' | 'error' | 'unmapped' } | { status: 'matched'; match: Match };

/** Local map IDs must match a school-published station, never a guessed name or coordinate. */
export function VerifiedBusStopArrivals({
  schoolId,
  stopId,
}: {
  schoolId: string;
  stopId: string;
}) {
  const theme = useTheme();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [linkError, setLinkError] = useState(false);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const linkPending = useRef(false);
  const load = useCallback(async () => {
    const run = ++generation.current;
    setState({ status: 'loading' });
    try {
      const routes = await loadBusRoutes(schoolId);
      if (!mounted.current || run !== generation.current) return;
      const matches = routes.flatMap((route): Match[] => {
        const stop = route.stops.find((candidate) => candidate.id === stopId);
        return stop ? [{ route, stop }] : [];
      });
      // Stop identifiers from different city providers cannot be treated as the same station.
      if (matches.length && new Set(matches.map((item) => item.route.city)).size === 1)
        setState({ status: 'matched', match: matches[0] });
      else setState({ status: 'unmapped' });
    } catch {
      if (mounted.current && run === generation.current) setState({ status: 'error' });
    }
  }, [schoolId, stopId]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  const openOfficial = async () => {
    if (linkPending.current || !mounted.current) return;
    linkPending.current = true;
    setOpening(true);
    setLinkError(false);
    try {
      await Linking.openURL(TAICHUNG_BUS_URL);
    } catch {
      if (mounted.current) setLinkError(true);
    } finally {
      linkPending.current = false;
      if (mounted.current) setOpening(false);
    }
  };
  const body = { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 };
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 12, minHeight: 44, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      {state.status === 'loading' ? (
        <Text accessibilityRole="progressbar" style={body}>
          正在確認學校發布的站牌資料…
        </Text>
      ) : state.status === 'error' ? (
        <Text accessibilityRole="alert" style={body}>
          無法讀取學校發布的站牌資料，目前無法確認本站到站時間。
        </Text>
      ) : state.status === 'unmapped' ? (
        <Text style={body}>
          本站尚未對應到可查詢的官方站牌。此頁保留內建路線參考資料，不提供到站預估或提醒。
        </Text>
      ) : state.status === 'matched' ? (
        <CampusBusArrivals
          key={`${state.match.route.city}:${state.match.stop.id}`}
          schoolId={schoolId}
          route={state.match.route}
          stop={state.match.stop}
        />
      ) : null}
      {state.status !== 'matched' &&
        button(
          state.status === 'loading' ? '正在確認站牌…' : '重新確認站牌',
          () => void load(),
          state.status === 'loading',
        )}
      {schoolId === 'pu' &&
        button(
          opening ? '正在開啟官方查詢…' : '開啟官方公車查詢',
          () => void openOfficial(),
          opening,
        )}
      {linkError && (
        <Text accessibilityRole="alert" style={body}>
          無法開啟公車網站，請確認網路連線後重試。
        </Text>
      )}
    </View>
  );
}
