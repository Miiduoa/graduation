import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import type { WebView } from 'react-native-webview';
import { PuWebView } from '../ui/PuWebView';
import {
  AIDetailScreen,
  AICard,
  AISection,
  AIRow,
  AIButton,
  AIChip,
  AIEmptyState,
} from '../ui/aiFirst';
import { useTheme } from '../state/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import {
  buildCampusMapHtml,
  buildWalkingDirectionsUrl,
  mapPlacesPayload,
  loadCampusMapPlaces,
  type CampusMapPlace,
  type MapCoordinate,
} from '../features/campusMap';

type MapNavigation = { goBack?: () => void };
type MapParams = {
  poiId?: string;
  focusPoiId?: string;
  toPoiId?: string;
  fromPoiId?: string;
  autoStart?: boolean;
};

export function GoogleMapsLikeScreen() {
  const navigation = useNavigation<MapNavigation>();
  const route = useRoute();
  const { school } = useSchool();
  const { user } = useAuth();
  const params = (route.params ?? {}) as MapParams;
  return (
    <CampusMapContent
      key={JSON.stringify([user?.uid, school.id])}
      schoolId={school.id}
      navigation={navigation}
      params={params}
    />
  );
}

function CampusMapContent({
  schoolId,
  navigation,
  params,
}: {
  schoolId: string;
  navigation: MapNavigation;
  params: MapParams;
}) {
  const theme = useTheme();
  const webRef = useRef<WebView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const locationLock = useRef(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<CampusMapPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const generation = useRef(0);
  const [category, setCategory] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [location, setLocation] = useState<MapCoordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [directionsError, setDirectionsError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadError(false);
    setCatalog([]);
    try {
      const next = await loadCampusMapPlaces(schoolId);
      if (mounted.current && request === generation.current) setCatalog(next);
    } catch {
      if (mounted.current && request === generation.current) setLoadError(true);
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);
  const selected = catalog.find((place) => place.id === selectedId);
  const origin = catalog.find((place) => place.id === params.fromPoiId);
  const categories = useMemo(
    () => Array.from(new Set(catalog.map((place) => place.category))),
    [catalog],
  );
  const places = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return catalog.filter(
      (place) =>
        (category === 'all' || place.category === category) &&
        [place.name, place.category, place.description, place.building, ...place.facilities].some(
          (value) => value?.toLowerCase().includes(keyword),
        ),
    );
  }, [query, category, catalog]);
  const html = useMemo(
    () =>
      catalog[0]
        ? buildCampusMapHtml(
            {
              background: theme.colors.bg,
              accent: theme.colors.accent,
              surface: theme.colors.surface,
              text: theme.colors.text,
            },
            theme.mode === 'dark',
            catalog[0],
          )
        : '',
    [theme, catalog],
  );

  const post = useCallback((payload: object) => {
    const serialized = JSON.stringify(JSON.stringify(payload)).replace(/</g, '\\u003c');
    webRef.current?.injectJavaScript(
      `document.dispatchEvent(new MessageEvent('message',{data:${serialized}}));true;`,
    );
  }, []);

  useEffect(() => {
    const targetId = params.focusPoiId ?? params.toPoiId ?? params.poiId;
    setSelectedId(typeof targetId === 'string' ? targetId : null);
    setDirectionsError('');
  }, [params.focusPoiId, params.toPoiId, params.poiId]);

  useEffect(() => {
    setReady(false);
    setMapFailed(false);
  }, [html, mapAttempt]);

  useEffect(() => {
    if (!html || ready || mapFailed) return;
    const timeout = setTimeout(() => setMapFailed(true), 15000);
    return () => clearTimeout(timeout);
  }, [schoolId, ready, mapFailed, html, mapAttempt]);

  useEffect(() => {
    if (ready) post(mapPlacesPayload(places, selectedId));
  }, [ready, places, selectedId, post]);
  useEffect(() => {
    if (ready && selected) post({ type: 'focus', lat: selected.lat, lng: selected.lng });
  }, [ready, selected, post]);
  useEffect(() => {
    if (ready) post(location ? { type: 'location', ...location } : { type: 'clearLocation' });
  }, [ready, location, post]);

  const locate = async () => {
    if (locationLock.current || !mounted.current) return;
    locationLock.current = true;
    setLocating(true);
    setLocationError('');
    setLocation(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted.current) return;
      if (permission.status !== 'granted') {
        setLocationError('尚未允許使用位置。你仍可以搜尋地點，或在地圖服務中設定出發位置。');
        return;
      }
      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (mounted.current)
        setLocation({ lat: result.coords.latitude, lng: result.coords.longitude });
    } catch {
      if (mounted.current) setLocationError('目前無法取得位置。請確認定位與網路已開啟，再試一次。');
    } finally {
      locationLock.current = false;
      if (mounted.current) setLocating(false);
    }
  };

  const openDirections = async () => {
    if (!selected || !mounted.current) return;
    setDirectionsError('');
    try {
      await Linking.openURL(buildWalkingDirectionsUrl(selected, origin));
    } catch {
      if (mounted.current) setDirectionsError('無法開啟地圖服務，請確認網路連線後重試。');
    }
  };

  const textStyle = { ...theme.typography.bodySmall, color: theme.colors.muted };

  return (
    <AIDetailScreen
      scrollRef={scrollRef}
      title="校園地圖"
      subtitle="找到校園地點，再安排怎麼過去。"
      onBack={() => navigation.goBack?.()}
    >
      {loading ? (
        <AICard>
          <ActivityIndicator accessibilityLabel="讀取校園地點" color={theme.colors.accent} />
        </AICard>
      ) : loadError ? (
        <AICard title="目前無法讀取校園地點">
          <Text accessibilityRole="alert" style={textStyle}>
            請確認登入狀態與網路連線後重試。
          </Text>
          <AIButton label="重新讀取地點" onPress={() => void load()} />
        </AICard>
      ) : catalog.length === 0 ? (
        <AICard title="尚未提供校園地點">
          <Text style={textStyle}>目前沒有可顯示的地點資料。你可以先從學校官網查詢校區地圖。</Text>
          <AIButton label="重新讀取地點" variant="ghost" onPress={() => void load()} />
        </AICard>
      ) : (
        <>
          <AICard>
            <View style={{ gap: theme.space.md }}>
              <TextInput
                accessibilityLabel="搜尋校園地點"
                placeholder="大樓、系所或設施名稱"
                placeholderTextColor={theme.colors.muted}
                value={query}
                onChangeText={setQuery}
                maxLength={120}
                returnKeyType="search"
                style={{
                  ...theme.typography.body,
                  minHeight: 48,
                  color: theme.colors.text,
                  padding: theme.space.sm,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                }}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
                <AIChip
                  label="全部"
                  active={category === 'all'}
                  onPress={() => setCategory('all')}
                />
                {categories.map((value) => (
                  <AIChip
                    key={value}
                    label={value}
                    active={category === value}
                    onPress={() => setCategory(value)}
                  />
                ))}
              </View>
            </View>
          </AICard>
          <AICard title="校區位置">
            <View
              style={{
                height: 280,
                overflow: 'hidden',
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surfaceMuted,
              }}
            >
              {!mapFailed ? (
                <PuWebView
                  key={`${theme.mode}-${mapAttempt}`}
                  ref={webRef}
                  source={{ html }}
                  applicationNameForUserAgent="CampusOne/1.0 (+https://nuni.tw)"
                  testID="campus-map-webview"
                  accessibilityLabel="校區地圖；下方也提供地點清單"
                  style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  scrollEnabled={false}
                  onError={() => setMapFailed(true)}
                  onMessage={(event) => {
                    try {
                      const message = JSON.parse(event.nativeEvent.data) as {
                        type?: string;
                        id?: string;
                      };
                      if (message.type === 'ready') setReady(true);
                      if (message.type === 'error') setMapFailed(true);
                      if (
                        message.type === 'select' &&
                        message.id &&
                        places.some((place) => place.id === message.id)
                      ) {
                        setSelectedId(message.id);
                        setDirectionsError('');
                      }
                    } catch {
                      /* Ignore unrelated WebView messages. */
                    }
                  }}
                />
              ) : (
                <View
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    padding: theme.space.lg,
                    gap: theme.space.md,
                  }}
                >
                  <Text accessibilityRole="alert" style={textStyle}>
                    地圖目前無法載入。仍可從下方清單選擇地點並開啟路線。
                  </Text>
                  <AIButton
                    label="重新載入地圖"
                    variant="ghost"
                    onPress={() => {
                      setReady(false);
                      setMapFailed(false);
                      setMapAttempt((attempt) => attempt + 1);
                    }}
                  />
                </View>
              )}
              {!ready && !mapFailed ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ActivityIndicator
                    accessibilityLabel="載入校區地圖"
                    color={theme.colors.accent}
                  />
                </View>
              ) : null}
            </View>
            <View style={{ gap: theme.space.sm, marginTop: theme.space.md }}>
              <AIButton
                label={locating ? '正在定位…' : '查看目前位置'}
                disabled={locating}
                variant="ghost"
                onPress={() => void locate()}
              />
              {locationError ? (
                <Text accessibilityRole="alert" style={textStyle}>
                  {locationError}
                </Text>
              ) : null}
              <Text style={textStyle}>
                依目前校園地點資料顯示。開放時間與出入口請以現場公告為準。
              </Text>
            </View>
          </AICard>
          {selected ? (
            <View
              onLayout={(event) =>
                scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false })
              }
            >
              <AICard title={selected.name}>
                <View style={{ gap: theme.space.md }}>
                  <Text style={textStyle}>
                    {[
                      selected.category,
                      selected.building,
                      selected.floor ? `${selected.floor} 樓` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {selected.description ? (
                    <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                      {selected.description}
                    </Text>
                  ) : null}
                  {selected.facilities.length > 0 ? (
                    <Text style={textStyle}>設施：{selected.facilities.join('、')}</Text>
                  ) : null}
                  <Text style={textStyle}>
                    {origin ? `從${origin.name}出發。` : ''}將開啟 Google
                    地圖確認步行路線與出發位置。
                  </Text>
                  <AIButton label="查看步行路線" onPress={() => void openDirections()} />
                  {directionsError ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ ...textStyle, color: theme.colors.danger }}
                    >
                      {directionsError}
                    </Text>
                  ) : null}
                  <AIButton
                    label="關閉地點資訊"
                    variant="ghost"
                    onPress={() => {
                      setSelectedId(null);
                      setDirectionsError('');
                    }}
                  />
                </View>
              </AICard>
            </View>
          ) : null}
          <AISection title="地點清單" subtitle={`${places.length} 個地點`}>
            {places.map((place) => (
              <AIRow
                key={place.id}
                title={place.name}
                subtitle={[place.category, place.building].filter(Boolean).join(' · ')}
                onPress={() => {
                  setSelectedId(place.id);
                  setDirectionsError('');
                }}
              />
            ))}
          </AISection>
          {places.length === 0 ? (
            <AIEmptyState
              title="找不到符合的地點"
              subtitle="換個關鍵字，或選擇「全部」再找一次。"
            />
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}
