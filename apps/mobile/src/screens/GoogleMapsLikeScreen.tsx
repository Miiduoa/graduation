import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import type { WebView } from 'react-native-webview';
import { centerOfCoordinates, distanceMeters, formatDistance } from '@campus/shared/src/campusGeo';
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
import { safeNavigate } from '../utils/safeNavigate';
import {
  buildCampusMapSearchUrl,
  getOfficialCampusMapUrl,
  hasOfficialProvidenceLibraryGuide,
} from '@campus/shared/src/campusMapLookup';
import {
  hasBundledCampusPlaces,
  isProvidencePendingVerification,
  locationMatchesSearch,
  PROVIDENCE_CAMPUS_SOURCE,
  providencePlaceSourceUrl,
  walkingEstimateLabel,
  withProvidenceCampusPlaces,
} from '@campus/shared/src/providenceCampus';
import {
  buildCampusMapHtml,
  buildWalkingDirectionsUrl,
  mapPlacesPayload,
  loadCampusMapPlaces,
  mergeCampusMapPlaces,
  toCampusMapPlaces,
  type CampusMapPlace,
  type MapCoordinate,
} from '../features/campusMap';

type PlaceSource = 'loading' | 'error' | 'ready';
type PlaceState = {
  status: 'loading' | 'error' | 'ready';
  source: PlaceSource;
  locations: CampusMapPlace[];
};

type MapNavigation = {
  goBack?: () => void;
  navigate?: (...args: unknown[]) => void;
  getState?: () => unknown;
  getParent?: () => unknown;
};
type MapParams = {
  query?: string;
  schoolId?: string;
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
  const signature = JSON.stringify([params.poiId, params.focusPoiId, params.toPoiId, params.fromPoiId, params.query, params.schoolId]);
  const linkedSchool = useRef({ id: school.id, signature, invalidated: false });
  if (linkedSchool.current.signature !== signature) {
    linkedSchool.current = { id: school.id, signature, invalidated: false };
  } else if (linkedSchool.current.id !== school.id) {
    linkedSchool.current.invalidated = true;
  }
  const schoolScopedParams = linkedSchool.current.invalidated || (params.schoolId && params.schoolId !== school.id) ? {} : params;
  return (
    <CampusMapContent
      key={JSON.stringify([user?.uid, school.id, school.name])}
      schoolId={school.id}
      schoolName={school.name}
      navigation={navigation}
      params={schoolScopedParams}
    />
  );
}

function CampusMapContent({
  schoolId,
  schoolName,
  navigation,
  params,
}: {
  schoolId: string;
  schoolName?: string;
  navigation: MapNavigation;
  params: MapParams;
}) {
  const theme = useTheme();
  const mapSearchUrl = buildCampusMapSearchUrl(schoolName);
  const officialMapUrl = getOfficialCampusMapUrl(schoolId);
  const bundled = hasBundledCampusPlaces(schoolId);
  const webRef = useRef<WebView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const locationLock = useRef(false);
  const schoolIdRef = useRef(schoolId);
  schoolIdRef.current = schoolId;
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(params.query?.slice(0, 120) || ''); }, [params.query]);
  const [placeState, setPlaceState] = useState<PlaceState>(() => ({
    status: bundled ? 'ready' : 'loading',
    source: 'loading',
    locations: bundled ? toCampusMapPlaces(withProvidenceCampusPlaces(schoolId, [])) : [],
  }));
  const [placeAttempt, setPlaceAttempt] = useState(0);
  const generation = useRef(0);
  const [category, setCategory] = useState<string>('all');
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [originId, setOriginId] = useState<string | null | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [location, setLocation] = useState<MapCoordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [directionsError, setDirectionsError] = useState('');
  const [officialMapError, setOfficialMapError] = useState('');
  const [sourceLinkError, setSourceLinkError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const retryPlaces = useCallback(() => {
    setPlaceState((previous) =>
      previous.status === 'ready'
        ? { ...previous, source: 'loading' }
        : { status: 'loading', source: 'loading', locations: [] },
    );
    setPlaceAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    void loadCampusMapPlaces(schoolId).then(
      (loaded) => {
        if (!mounted.current || request !== generation.current) return;
        setPlaceState({
          status: 'ready',
          source: 'ready',
          locations: mergeCampusMapPlaces(schoolId, loaded),
        });
      },
      () => {
        if (!mounted.current || request !== generation.current) return;
        setPlaceState((previous) =>
          bundled
            ? {
                status: 'ready',
                source: 'error',
                locations: previous.locations.length
                  ? previous.locations
                  : toCampusMapPlaces(withProvidenceCampusPlaces(schoolId, [])),
              }
            : { status: 'error', source: 'error', locations: [] },
        );
      },
    );
  }, [schoolId, placeAttempt, bundled]);

  const catalog = placeState.locations;
  const loading = placeState.status === 'loading';
  const loadError = placeState.status === 'error';
  const sourcePending = placeState.source === 'loading';
  const sourceFailed = placeState.source === 'error';
  const selected = catalog.find((place) => place.id === selectedId);
  const selectedSourceUrl = selected ? providencePlaceSourceUrl(schoolId, selected) : null;
  const origin = catalog.find((place) => place.id === (originId === undefined ? params.fromPoiId : originId));
  const missingDeepLink =
    !sourcePending &&
    selectedId !== null &&
    selectedId === (params.focusPoiId ?? params.toPoiId ?? params.poiId) &&
    !selected;
  const categories = useMemo(
    () => Array.from(new Set(catalog.map((place) => place.category))),
    [catalog],
  );
  const places = useMemo(() => {
    const matches = catalog.filter(
      (place) =>
        (category === 'all' || place.category === category) &&
        locationMatchesSearch(place, query) &&
        (!nearbyOnly || !location || distanceMeters(location, place) <= 1000),
    );
    if (location) matches.sort((a, b) => distanceMeters(location, a) - distanceMeters(location, b));
    return matches;
  }, [query, category, catalog, location, nearbyOnly]);
  const visiblePlaces = useMemo(() => {
    const visible = new Map(places.map((place) => [place.id, place]));
    if (origin) visible.set(origin.id, origin);
    if (selected) visible.set(selected.id, selected);
    return [...visible.values()];
  }, [places, origin, selected]);
  const campusCenter = useMemo(() => centerOfCoordinates(catalog), [catalog]);
  const html = useMemo(
    () =>
      campusCenter
        ? buildCampusMapHtml(
            {
              background: theme.colors.bg,
              accent: theme.colors.accent,
              surface: theme.colors.surface,
              text: theme.colors.text,
            },
            theme.mode === 'dark',
            campusCenter,
          )
        : '',
    [theme, campusCenter],
  );
  const mapSource = useMemo(() => ({ html }), [html]);

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
    setSourceLinkError('');
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
    if (ready) post(mapPlacesPayload(visiblePlaces, selectedId));
  }, [ready, visiblePlaces, selectedId, post]);
  useEffect(() => {
    if (ready && selected) post({ type: 'focus', lat: selected.lat, lng: selected.lng });
  }, [ready, selected, post]);
  useEffect(() => {
    if (!ready) return;
    post(selected && origin && selected.id !== origin.id
      ? { type: 'route', start: { lat: origin.lat, lng: origin.lng }, end: { lat: selected.lat, lng: selected.lng } }
      : { type: 'clearRoute' });
  }, [ready, selected, origin, post]);
  useEffect(() => {
    if (ready) post(location ? { type: 'location', ...location } : { type: 'clearLocation' });
  }, [ready, location, post]);

  const locate = async () => {
    if (locationLock.current || !mounted.current) return;
    locationLock.current = true;
    setLocating(true);
    setLocationError('');
    setLocation(null);
    setNearbyOnly(false);
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
    if (origin?.id === selected.id) {
      setDirectionsError('起點與終點不能相同，請從下方清單選擇另一個地點。');
      return;
    }
    try {
      await Linking.openURL(buildWalkingDirectionsUrl(selected, origin ?? location ?? undefined));
    } catch {
      if (mounted.current) setDirectionsError('無法開啟地圖服務，請確認網路連線後重試。');
    }
  };

  const openOfficialMap = async () => {
    if (!officialMapUrl) return;
    const actionSchoolId = schoolId;
    const actionUrl = officialMapUrl;
    setOfficialMapError('');
    try {
      await Linking.openURL(actionUrl);
    } catch {
      if (!mounted.current || schoolIdRef.current !== actionSchoolId) return;
      setOfficialMapError('無法開啟校方校區平面圖，請確認網路連線後重試。');
    }
  };

  const openSelectedSource = async () => {
    if (!selectedSourceUrl || !selected) return;
    const actionSchoolId = schoolId;
    const actionPlaceId = selected.id;
    const actionUrl = selectedSourceUrl;
    if (!mounted.current || selectedIdRef.current !== actionPlaceId) return;
    setSourceLinkError('');
    try {
      await Linking.openURL(actionUrl);
    } catch {
      if (
        !mounted.current ||
        schoolIdRef.current !== actionSchoolId ||
        selectedIdRef.current !== actionPlaceId
      ) {
        return;
      }
      setSourceLinkError('無法開啟地點來源，請確認網路連線後重試。');
    }
  };

  const officialPlanAction = officialMapUrl ? (
    <View style={{ gap: theme.space.sm }}>
      <AIButton
        label="查看校方校區平面圖"
        variant="ghost"
        onPress={() => void openOfficialMap()}
      />
      {officialMapError ? (
        <Text accessibilityRole="alert" style={{ ...theme.typography.bodySmall, color: theme.colors.danger }}>
          {officialMapError}
        </Text>
      ) : null}
    </View>
  ) : null;

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
          {officialPlanAction}
        </AICard>
      ) : loadError ? (
        <AICard title="目前無法讀取校園地點">
          <Text accessibilityRole="alert" style={textStyle}>
            請確認登入狀態與網路連線後重試。
          </Text>
          <AIButton label="重新讀取地點" onPress={retryPlaces} />
          {officialPlanAction}
        </AICard>
      ) : catalog.length === 0 ? (
        <AICard title="尚未提供校園地點">
          <Text style={textStyle}>目前沒有可顯示的地點資料，不會改用其他學校的建築或導航位置。</Text>
          {officialPlanAction}
          {mapSearchUrl ? (
            <>
              <AIButton
                label={`在 Google 地圖搜尋${schoolName}`}
                variant="ghost"
                onPress={() => {
                  if (!mounted.current) return;
                  setDirectionsError('');
                  void Linking.openURL(mapSearchUrl).catch(() => {
                    if (mounted.current)
                      setDirectionsError('無法開啟地圖服務，請確認網路連線後重試。');
                  });
                }}
              />
              <Text style={textStyle}>第三方地圖搜尋結果尚未由校方核對，請確認校區名稱及位置。</Text>
            </>
          ) : null}
          {directionsError ? (
            <Text accessibilityRole="alert" style={{ ...textStyle, color: theme.colors.danger }}>
              {directionsError}
            </Text>
          ) : null}
          <AIButton label="重新讀取地點" variant="ghost" onPress={retryPlaces} />
        </AICard>
      ) : (
        <>
          {sourceFailed && bundled ? (
            <AICard title="校方地點資料暫時讀不到">
              <Text accessibilityRole="alert" style={textStyle}>
                先顯示目前可用的靜宜地點，收藏與部分地點可能缺少。
              </Text>
              <AIButton label="重新讀取地點資料" onPress={retryPlaces} />
              {officialPlanAction}
            </AICard>
          ) : null}
          {sourcePending && bundled ? (
            <AICard>
              <Text style={textStyle}>
                正在同步校方地點資料，已先顯示靜宜的預載地點。
              </Text>
              {officialPlanAction}
            </AICard>
          ) : null}
          {missingDeepLink ? (
            <AICard title="找不到連結指定的地點">
              <Text style={textStyle}>這個地點不在目前學校的資料中，請從下方清單重新選擇。</Text>
            </AICard>
          ) : null}
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
                {location ? (
                  <AIChip
                    label="附近 1 公里"
                    active={nearbyOnly}
                    onPress={() => setNearbyOnly((value) => !value)}
                  />
                ) : null}
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
                  source={mapSource}
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
                        setSourceLinkError('');
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
              {!sourcePending && !sourceFailed ? officialPlanAction : null}
            </View>
          </AICard>
          {schoolId === 'pu' ? (
            <AICard title="靜宜地圖資料來源與步行分鐘算法">
              <Text style={textStyle}>
                預載目錄中的建築與設施位置取自 OpenStreetMap 貢獻者資料（查詢日期{' '}
                {PROVIDENCE_CAMPUS_SOURCE.retrievedAt}），並與校方校園地圖實境導覽交叉核對名稱。預載公車站牌取自臺中市公車站牌資料（快照{' '}
                {PROVIDENCE_CAMPUS_SOURCE.transitCatalogDate}）。步行分鐘是直線公尺 ÷ 每分鐘 80 公尺後四捨五入，不是導航路線時間。
              </Text>
              <AIButton
                label="OpenStreetMap 著作權與授權"
                variant="ghost"
                onPress={() => {
                  const actionSchoolId = schoolId;
                  void Linking.openURL(PROVIDENCE_CAMPUS_SOURCE.mapDataUrl).catch(() => {
                    if (!mounted.current || schoolIdRef.current !== actionSchoolId) return;
                    setDirectionsError('無法開啟地圖服務，請確認網路連線後重試。');
                  });
                }}
              />
            </AICard>
          ) : null}
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
                      selected.floor ? `樓層：${selected.floor}` : null,
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
                  {location ? (
                    <Text style={textStyle}>
                      與目前位置直線相距約 {formatDistance(distanceMeters(location, selected))}。
                      {walkingEstimateLabel(distanceMeters(location, selected))}
                    </Text>
                  ) : null}
                  {origin && origin.id !== selected.id ? (
                    <Text style={textStyle}>
                      從{origin.name}出發；兩地直線距離約 {formatDistance(distanceMeters(origin, selected))}（地圖虛線僅為位置示意）。
                      {walkingEstimateLabel(distanceMeters(origin, selected))}
                    </Text>
                  ) : null}
                  {isProvidencePendingVerification(schoolId, selected) ? (
                    <Text style={textStyle}>
                      這個地點目前只有單一資料來源，位置待再次確認，先不要把它當成已核對的導航點。
                    </Text>
                  ) : null}
                  <Text style={textStyle}>
                    將開啟 Google 地圖確認實際步行路線與所需時間。
                  </Text>
                  <AIButton label="查看步行路線" onPress={() => void openDirections()} />
                  {selectedSourceUrl ? (
                    <AIButton
                      label="查看地點來源"
                      variant="ghost"
                      onPress={() => void openSelectedSource()}
                    />
                  ) : null}
                  {hasOfficialProvidenceLibraryGuide(schoolId, selected) ? (
                    <AIButton
                      label="查看校方樓層導覽"
                      variant="ghost"
                      onPress={() => safeNavigate(navigation, 'IndoorFloorMap', { poiId: 'pu-library' })}
                    />
                  ) : null}
                  <AIButton
                    label={originId === selected.id ? '已設為起點' : '設為步行起點'}
                    variant="ghost"
                    onPress={() => {
                      setOriginId(selected.id);
                      setDirectionsError('');
                    }}
                  />
                  {origin ? (
                    <AIButton
                      label="清除步行起點"
                      variant="ghost"
                      onPress={() => { setOriginId(null); setDirectionsError(""); }}
                    />
                  ) : null}
                  {directionsError ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ ...textStyle, color: theme.colors.danger }}
                    >
                      {directionsError}
                    </Text>
                  ) : null}
                  {sourceLinkError ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ ...textStyle, color: theme.colors.danger }}
                    >
                      {sourceLinkError}
                    </Text>
                  ) : null}
                  <AIButton
                    label="關閉地點資訊"
                    variant="ghost"
                    onPress={() => {
                      setSelectedId(null);
                      setDirectionsError('');
                      setSourceLinkError('');
                    }}
                  />
                </View>
              </AICard>
            </View>
          ) : null}
          <AISection
            title="地點清單"
            subtitle={location ? `${places.length} 個地點，依直線距離排序` : `${places.length} 個地點`}
          >
            {places.map((place) => (
              <AIRow
                key={place.id}
                title={place.name}
                subtitle={[
                  place.category,
                  place.building,
                  isProvidencePendingVerification(schoolId, place) ? '待確認' : null,
                  location ? `直線距離 ${formatDistance(distanceMeters(location, place))}` : null,
                ].filter(Boolean).join(' · ')}
                onPress={() => {
                  setSelectedId(place.id);
                  setDirectionsError('');
                  setSourceLinkError('');
                }}
              />
            ))}
          </AISection>
          {places.length === 0 ? (
            <AICard>
              <AIEmptyState
                title="找不到符合的地點"
                subtitle="換個關鍵字，或清除篩選條件再找一次。"
              />
              <AIButton
                label="清除篩選條件"
                variant="ghost"
                onPress={() => {
                  setQuery('');
                  setCategory('all');
                  setNearbyOnly(false);
                }}
              />
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}
