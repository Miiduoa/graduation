import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, findNodeHandle, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../state/theme';
import { AICard, AIButton, AIChip } from '../ui/aiFirst';
import {
  BUS_CITIES,
  PUBLIC_BUS_OFFICIAL_FALLBACK,
  TAICHUNG_BUS_CATALOG_SOURCE,
  TAICHUNG_BUS_OFFICIAL,
  primaryBusCity,
  publicArrivalLabel,
  queryPublicTransit,
  type BusCity,
  type PublicBusStop,
  type PublicTransitQuery,
  type PublicTransitResult,
} from '../features/publicTransit';

const RADII = [300, 600, 1000] as const;
const wrappingButton: ViewStyle = { maxWidth: '100%', flexDirection: 'column', alignItems: 'stretch' };

export function focusForScreenReader(target: View | null) {
  if (!target) return;
  if (Platform.OS === 'web') {
    // React Native Web refs are DOM nodes; findNodeHandle is unsupported there.
    const node = target as unknown as { focus?: (options: { preventScroll: boolean }) => void };
    if (typeof node.focus !== 'function') return;
    try {
      node.focus({ preventScroll: true });
    } catch {
      // Non-focusable nodes must not break opening or returning from stop details.
    }
    return;
  }
  const handle = findNodeHandle(target);
  if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
}
const catalogDirection = (direction: string) => direction === '去' ? '去程' : direction === '返' ? '返程' : direction || '方向未提供';

function catalogSummary(stop: PublicBusStop): string {
  if (!stop.routes?.length) return '靜態站牌資料';
  const names = [...new Set(stop.routes.map((route) => route.name))];
  const directions = [...new Set(stop.routes.map((route) => catalogDirection(route.direction)))];
  return names.slice(0, 3).join('、') + (names.length > 3 ? ' 等路線' : ' 路線') + ' · ' + directions.join('／');
}

function CatalogStop({ stop, openLink, linkBusy }: { stop: PublicBusStop; openLink: (url: string) => void; linkBusy: boolean }) {
  const theme = useTheme();
  const body = { ...theme.typography.bodySmall, color: theme.colors.muted };
  return (
    <AICard title={stop.name + ' · 經過路線'}>
      <View style={{ gap: theme.space.sm }}>
        <Text style={body}>班次時間請至官方網站確認</Text>
        <Text style={body}>
          臺中市政府交通局 · 站牌資料快照：{stop.catalogDate ? new Date(stop.catalogDate).toLocaleDateString('zh-TW', {
            timeZone: 'Asia/Taipei',
          }) : '日期未提供'}
        </Text>
        <Text style={body}>以下是站牌與路線資料，並非即時車況；班次與營運異動請查官方網站。</Text>
        {stop.routes?.length ? stop.routes.map((route, index) => (
          <Text key={index} style={{ ...theme.typography.body, color: theme.colors.text }}>
            {route.name} · {catalogDirection(route.direction)} · {route.destination ? '往 ' + route.destination : '目的地未提供'}
          </Text>
        )) : <Text style={body}>這個站牌的路線資料尚未提供。</Text>}
        <AIButton style={wrappingButton} disabled={linkBusy} label="到臺中公車網站查即時動態" variant="ghost" onPress={() => openLink(TAICHUNG_BUS_OFFICIAL)} />
        <AIButton style={wrappingButton} disabled={linkBusy} label="查看站牌資料來源" variant="ghost" onPress={() => openLink(TAICHUNG_BUS_CATALOG_SOURCE)} />
      </View>
    </AICard>
  );
}

function Arrivals({ stop }: { stop: PublicBusStop }) {
  const theme = useTheme();
  const [data, setData] = useState<PublicTransitResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setData(null);
    const next = await queryPublicTransit(
      { action: 'arrivals', city: stop.city, stopId: stop.id },
      request.signal,
    );
    if (request.signal.aborted) return;
    setData(next);
    setClock(Date.now());
    setLoading(false);
  }, [stop.city, stop.id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setClock(Date.now());
      if (AppState.currentState === 'active') void refresh();
    }, 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      controller.current?.abort();
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  const body = { ...theme.typography.bodySmall, color: theme.colors.muted };
  const arrivals = data?.status === 'ready' && data.kind === 'arrivals' ? data.arrivals : [];
  return (
    <AICard title={stop.name + ' · 官方到站預估'}>
      <View style={{ gap: theme.space.sm }}>
        {loading && <Text accessibilityRole="progressbar" style={body}>正在取得班次…</Text>}
        {data?.status === 'unavailable' && (
          <Text accessibilityRole="alert" style={body}>
            {data.reason === 'not-configured'
              ? '即時公車服務尚未啟用。請先使用官方公車網站。'
              : '目前無法取得可確認的到站資料，請稍後重新查詢。'}
          </Text>
        )}
        {data?.status === 'ready' && data.kind === 'arrivals' && (
          <>
            <Text style={body}>
              TDX 公開資料 · {new Date(data.fetchedAt).toLocaleTimeString('zh-TW', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei',
              })} 取得
            </Text>
            {arrivals.length ? arrivals.map((row) => (
              <Text key={row.id} style={{ ...theme.typography.body, color: theme.colors.text }}>
                {row.route}{row.destination ? ' 往 ' + row.destination : row.direction === 0 ? ' 去程' : row.direction === 1 ? ' 返程' : ''} · {publicArrivalLabel(row, clock)}
              </Text>
            )) : (
              <Text style={body}>這個站牌目前沒有可確認的班次預估。</Text>
            )}
          </>
        )}
        <AIButton
          style={wrappingButton}
          label={loading ? '更新中…' : '更新此站到站時間'}
          variant="ghost"
          disabled={loading}
          onPress={() => void refresh()}
        />
      </View>
    </AICard>
  );
}

function StopDetails({ stop, onClose, onDismiss }: {
  stop: PublicBusStop;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const title = useRef<View>(null);
  const active = useRef(true);
  const opening = useRef(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [failedLink, setFailedLink] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const openLink = async (url: string) => {
    if (opening.current || !active.current) return;
    opening.current = true;
    setLinkBusy(true);
    setFailedLink(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (active.current) setFailedLink(url);
    } finally {
      opening.current = false;
      if (active.current) setLinkBusy(false);
    }
  };
  const body = { ...theme.typography.bodySmall, color: theme.colors.muted };
  return (
    <Modal
      visible
      testID="public-transit-stop-details"
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      onShow={() => focusForScreenReader(title.current)}
    >
      <SafeAreaView
        testID="public-transit-stop-details-panel"
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
      >
        <View style={{ paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, borderBottomWidth: 1, borderColor: theme.colors.border }}>
          <AIButton label="返回站牌清單" variant="ghost" onPress={onClose} style={wrappingButton} />
        </View>
        <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.md }}>
          <View ref={title} accessible accessibilityRole="header" tabIndex={Platform.OS === 'web' ? -1 : undefined}>
            <Text style={{ ...theme.typography.h2, color: theme.colors.text }}>{stop.name}</Text>
          </View>
          <Text style={body}>{BUS_CITIES[stop.city]} · {stop.distance !== null ? '約 ' + Math.round(stop.distance) + ' 公尺（直線距離）' : '公車站牌'}</Text>
          <Text style={body}>同名站牌可能位於道路兩側。上車前請核對車頭方向與現場站牌。</Text>
          {stop.source === 'taichung-open-data'
            ? <CatalogStop stop={stop} openLink={(url) => void openLink(url)} linkBusy={linkBusy} />
            : <Arrivals stop={stop} />}
          <AIButton
            label="步行前往此站牌"
            variant="ghost"
            style={wrappingButton}
            disabled={linkBusy}
            onPress={() => void openLink('https://www.google.com/maps/dir/?api=1&destination=' +
              encodeURIComponent(stop.lat + ',' + stop.lon) + '&travelmode=walking')}
          />
          {stop.source !== 'taichung-open-data' && <AIButton
            label={stop.city === 'Taichung' ? '臺中公車官方網站' : '公路客運官方網站'}
            variant="ghost"
            style={wrappingButton}
            disabled={linkBusy}
            onPress={() => void openLink(stop.city === 'Taichung' ? TAICHUNG_BUS_OFFICIAL : PUBLIC_BUS_OFFICIAL_FALLBACK)}
          />}
          <Text style={body}>導航與官方網站會另開應用程式；返回後可繼續查看此站牌。</Text>
          {linkBusy && <Text accessibilityLiveRegion="polite" style={body}>正在開啟連結…</Text>}
          {failedLink && <View style={{ gap: theme.space.sm }}>
            <Text accessibilityRole="alert" style={body}>無法開啟連結，請確認裝置可開啟瀏覽器或地圖後再試。</Text>
            <AIButton label="再試開啟連結" variant="ghost" style={wrappingButton} onPress={() => void openLink(failedLink)} />
          </View>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** Available for browsing visitors and school accounts alike; never reads private school records. */
export function PublicTransitExplorer({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName?: string;
}) {
  const theme = useTheme();
  const [city, setCity] = useState<BusCity | null>(() => primaryBusCity(schoolId));
  const [chooser, setChooser] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [radius, setRadius] = useState<(typeof RADII)[number]>(600);
  const [stops, setStops] = useState<PublicBusStop[]>([]);
  const [selected, setSelected] = useState<PublicBusStop | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [message, setMessage] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [failedLink, setFailedLink] = useState<string | null>(null);
  const [accuracyNotice, setAccuracyNotice] = useState('');
  const [locating, setLocating] = useState(false);
  const request = useRef<AbortController | null>(null);
  const positionRevision = useRef(0);
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const linkOpening = useRef(false);
  const linkRevision = useRef(0);
  const stopButtons = useRef(new Map<string, View>());
  const returnTarget = useRef<View | null>(null);
  const detailsOpen = useRef(false);
  const focusFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const resetLink = useCallback(() => {
    linkRevision.current += 1;
    linkOpening.current = false;
    setLinkBusy(false);
    setFailedLink(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      linkRevision.current += 1;
      linkOpening.current = false;
      if (focusFrame.current != null) cancelAnimationFrame(focusFrame.current);
      request.current?.abort();
      positionRevision.current += 1;
      if (positionTimer.current) clearTimeout(positionTimer.current);
    };
  }, []);

  const restoreStopFocus = () => {
    if (mounted.current && !detailsOpen.current) focusForScreenReader(returnTarget.current);
  };
  const closeDetails = () => {
    detailsOpen.current = false;
    setSelected(null);
    if (focusFrame.current != null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(restoreStopFocus);
  };

  const cancelPosition = () => {
    positionRevision.current += 1;
    if (positionTimer.current) clearTimeout(positionTimer.current);
    positionTimer.current = null;
    setLocating(false);
  };

  const reset = () => {
    request.current?.abort();
    resetLink();
    cancelPosition();
    setStops([]);
    detailsOpen.current = false;
    setSelected(null);
    setStatus('idle');
    setMessage('');
    setAccuracyNotice('');
  };

  const lookup = useCallback(async (query: PublicTransitQuery) => {
    request.current?.abort();
    resetLink();
    const controller = new AbortController();
    request.current = controller;
    setStatus('loading');
    setStops([]);
    detailsOpen.current = false;
    setSelected(null);
    setMessage('');
    const result = await queryPublicTransit(query, controller.signal);
    if (controller.signal.aborted || !mounted.current) return;
    if (result.status === 'ready' && result.kind === 'stops') {
      setStops(result.stops);
      setStatus('ready');
      if (!result.stops.length) setMessage('目前沒有找到站牌。請換短一點的站名或切換縣市。');
      if (result.limited) setMessage('此範圍有較多站牌，僅列出部分結果；可縮小範圍重查。');
    } else {
      setStatus('unavailable');
      setMessage(
        result.status === 'unavailable' && result.reason === 'not-configured'
          ? '目前尚未接通這個縣市的站牌資料，可先查看官方公車網站。'
          : '目前無法取得公車站牌，請確認網路、縣市或稍後再試。',
      );
    }
  }, [resetLink]);

  const search = () => {
    cancelPosition();
    setAccuracyNotice('');
    if (!city) { setMessage('請先選擇要查詢的縣市。'); return; }
    const term = keyword.trim();
    if (term.length < 2) { setMessage('請輸入至少兩個字的站牌名稱。'); return; }
    void lookup({ action: 'search', city, text: term });
  };

  const nearby = async () => {
    if (!city) { setMessage('請先選擇要查詢的縣市。'); return; }
    reset();
    const run = ++positionRevision.current;
    setLocating(true);
    setMessage('');
    setAccuracyNotice('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted.current || run !== positionRevision.current) return;
      if (permission.status !== 'granted') {
        setMessage('尚未授權定位。你仍可輸入站牌名稱查詢。');
        return;
      }
      positionTimer.current = setTimeout(() => {
        if (!mounted.current || run !== positionRevision.current) return;
        positionRevision.current += 1;
        positionTimer.current = null;
        setLocating(false);
        setMessage('定位逾時，請重新定位或輸入站牌名稱查詢。');
      }, 10_000);
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!mounted.current || run !== positionRevision.current) return;
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = null;
      setLocating(false);
      const lat = location.coords.latitude;
      const lon = location.coords.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        setMessage('目前無法確認定位資料，請改用站名搜尋。');
        return;
      }
      if (location.coords.accuracy != null && location.coords.accuracy > 500)
        setAccuracyNotice('定位誤差偏大，請再次確認站牌位置與方向。');
      await lookup({ action: 'nearby', city, lat, lon, radius });
    } catch {
      if (mounted.current && run === positionRevision.current)
        setMessage('無法取得位置。你仍可輸入站牌名稱查詢。');
    } finally {
      if (mounted.current && run === positionRevision.current) {
        if (positionTimer.current) clearTimeout(positionTimer.current);
        positionTimer.current = null;
        setLocating(false);
      }
    }
  };

  const openLink = async (url: string) => {
    if (linkOpening.current || !mounted.current) return;
    const run = ++linkRevision.current;
    linkOpening.current = true;
    setLinkBusy(true);
    setFailedLink(null);
    setMessage('');
    try {
      await Linking.openURL(url);
    } catch {
      if (mounted.current && run === linkRevision.current) setFailedLink(url);
    } finally {
      if (mounted.current && run === linkRevision.current) {
        linkOpening.current = false;
        setLinkBusy(false);
      }
    }
  };

  const body = { ...theme.typography.bodySmall, color: theme.colors.muted };
  return (
    <AICard title="公開公車站牌">
      <View style={{ gap: theme.space.md }}>
        <Text style={body}>
          {schoolName ? schoolName + ' · ' : ''}依目前選擇縣市查詢官方站牌資料。跨縣市校區可自行更換縣市；不需登入學校帳號。
        </Text>
        <AIButton
          style={wrappingButton}
          label={city ? '查詢縣市：' + BUS_CITIES[city] : '選擇查詢縣市'}
          variant="ghost"
          onPress={() => setChooser(true)}
        />
        <Modal visible={chooser} animationType="slide" onRequestClose={() => setChooser(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
            <View style={{ padding: 18, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>選擇查詢縣市</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="關閉縣市選擇" onPress={() => setChooser(false)}>
                <Text style={{ color: theme.colors.accent }}>完成</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
              {(Object.entries(BUS_CITIES) as [BusCity, string][]).map(([id, name]) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={'選擇' + name}
                  accessibilityState={{ selected: id === city }}
                  onPress={() => {
                    reset();
                    setCity(id);
                    setChooser(false);
                  }}
                  style={{ minHeight: 52, borderBottomWidth: 1, borderColor: theme.colors.border, justifyContent: 'center' }}
                >
                  <Text style={{ color: theme.colors.text }}>{name}{city === id ? ' · 已選' : ''}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
        <TextInput
          accessibilityLabel="搜尋公車站名"
          value={keyword}
          onChangeText={setKeyword}
          placeholder="例如 清華大學、臺大、捷運站"
          placeholderTextColor={theme.colors.muted}
          maxLength={40}
          returnKeyType="search"
          onSubmitEditing={search}
          style={{
            minHeight: 48, borderWidth: 1, borderRadius: 12,
            borderColor: theme.colors.border, color: theme.colors.text, paddingHorizontal: 14,
          }}
        />
        <AIButton style={wrappingButton} label="搜尋官方站牌" onPress={search} disabled={status === 'loading'} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RADII.map((value) => (
            <AIChip
              key={value}
              label={value < 1000 ? value + ' 公尺' : '1 公里'}
              active={radius === value}
              onPress={() => { reset(); setRadius(value); }}
            />
          ))}
        </View>
        <AIButton
          style={wrappingButton}
          label={locating ? '正在確認位置…' : '用我的位置找附近站牌'}
          variant="ghost"
          disabled={locating || status === 'loading'}
          onPress={() => void nearby()}
        />
        {locating && (
          <AIButton
            style={wrappingButton}
            label="取消定位"
            variant="ghost"
            onPress={() => {
              cancelPosition();
              setMessage('已取消定位，仍可搜尋站名。');
            }}
          />
        )}
        {status === 'loading' && <Text accessibilityRole="progressbar" style={body}>正在查詢官方站牌…</Text>}
        {message ? <Text accessibilityRole="alert" style={body}>{message}</Text> : null}
        {accuracyNotice ? <Text style={body}>{accuracyNotice}</Text> : null}
        {stops.map((stop) => {
          const key = stop.city + ':' + stop.id;
          const label = stop.name + (stop.source === 'taichung-open-data' ? ' · ' + catalogSummary(stop) : '（' + stop.id + '）') +
            (stop.distance !== null ? ' · 約 ' + Math.round(stop.distance) + ' 公尺' : '') +
            (stop.source === 'taichung-open-data' ? ' · 無即時到站' : '');
          return <Pressable
            key={key}
            ref={(node) => { if (node) stopButtons.current.set(key, node); else stopButtons.current.delete(key); }}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint="開啟站牌詳情，可返回目前的搜尋清單"
            onPress={() => {
              if (detailsOpen.current) return;
              detailsOpen.current = true;
              if (focusFrame.current != null) cancelAnimationFrame(focusFrame.current);
              Keyboard.dismiss();
              returnTarget.current = stopButtons.current.get(key) ?? null;
              setSelected(stop);
            }}
            style={({ pressed }) => ({
              minHeight: 44, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm,
              borderWidth: 1, borderRadius: 12, borderColor: theme.colors.border,
              backgroundColor: theme.colors.card, opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.text, flexShrink: 1 }}>{label}</Text>
          </Pressable>;
        })}
        {selected && <StopDetails
          key={selected.city + ':' + selected.id}
          stop={selected}
          onClose={closeDetails}
          onDismiss={restoreStopFocus}
        />}
        <Text style={body}>
          請核對站牌方向與現場營運公告。有提供到站時間時，預估值仍可能隨車況變動。
        </Text>
        <AIButton
          style={wrappingButton}
          label={city === 'Taichung' ? '臺中公車官方網站' : '公路客運官方網站'}
          variant="ghost"
          disabled={linkBusy}
          onPress={() => void openLink(city === 'Taichung' ? TAICHUNG_BUS_OFFICIAL : PUBLIC_BUS_OFFICIAL_FALLBACK)}
        />
        {linkBusy && <Text accessibilityLiveRegion="polite" style={body}>正在開啟連結…</Text>}
        {failedLink && <View style={{ gap: theme.space.sm }}>
          <Text accessibilityRole="alert" style={body}>無法開啟連結，請確認裝置可開啟瀏覽器或地圖後再試。</Text>
          <AIButton label="再試開啟連結" variant="ghost" style={wrappingButton} onPress={() => void openLink(failedLink)} />
        </View>}
      </View>
    </AICard>
  );
}
