import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIScreen, AICard, AISection, AIRow, AIButton, AIChip } from '../ui/aiFirst';
import { loadCampusMapPlaces, type CampusMapPlace } from '../features/campusMap';

type TravelMode = 'walking' | 'transit' | 'bicycling' | 'driving';
const MODES: ReadonlyArray<{ value: TravelMode; label: string }> = [
  { value: 'walking', label: '步行' },
  { value: 'transit', label: '大眾運輸' },
  { value: 'bicycling', label: '自行車' },
  { value: 'driving', label: '開車' },
];
type CoordinateDestination = { name: string; lat: number; lng: number };
type Destination =
  | { kind: 'place'; id: string }
  | { kind: 'coordinate'; place: CoordinateDestination };
type PlannerParams = {
  toPoiId?: unknown;
  poiId?: unknown;
  fromPoiId?: unknown;
  toLat?: unknown;
  toLng?: unknown;
  toName?: unknown;
  mode?: unknown;
};

function textParam(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function coordinateDestination(params: PlannerParams): CoordinateDestination | null {
  const name = textParam(params.toName);
  if (
    !name ||
    name.length > 160 ||
    typeof params.toLat !== 'number' ||
    typeof params.toLng !== 'number' ||
    !Number.isFinite(params.toLat) ||
    !Number.isFinite(params.toLng) ||
    Math.abs(params.toLat) > 90 ||
    Math.abs(params.toLng) > 180
  )
    return null;
  return { name, lat: params.toLat, lng: params.toLng };
}
function initialMode(value: unknown): TravelMode {
  if (value === 'bus') return 'transit';
  if (value === 'drive') return 'driving';
  if (value === 'bike') return 'bicycling';
  return MODES.some((mode) => mode.value === value) ? (value as TravelMode) : 'walking';
}

export function TripPlannerScreen() {
  const route = useRoute();
  const { school } = useSchool();
  const { user } = useAuth();
  const scope = JSON.stringify([user?.uid ?? null, school.id]);
  // A location carried by an existing route belongs to the account/school that opened it.
  const routeOwner = useRef({ params: route.params, scope, allowed: true });
  if (routeOwner.current.params !== route.params)
    routeOwner.current = { params: route.params, scope, allowed: true };
  else if (routeOwner.current.scope !== scope)
    routeOwner.current = { params: route.params, scope, allowed: false };
  const params = routeOwner.current.allowed ? ((route.params ?? {}) as PlannerParams) : {};
  const toId = textParam(params.toPoiId) ?? textParam(params.poiId);
  const fromId = textParam(params.fromPoiId);
  const coordinate = toId ? null : coordinateDestination(params);
  const mode = initialMode(params.mode);
  const intent = JSON.stringify([toId, fromId, coordinate, mode]);
  return (
    <TripPlannerContent
      key={JSON.stringify([scope, intent])}
      schoolId={school.id}
      initialDestination={
        toId
          ? { kind: 'place', id: toId }
          : coordinate
            ? { kind: 'coordinate', place: coordinate }
            : null
      }
      initialOriginId={fromId}
      initialTravelMode={mode}
    />
  );
}

function TripPlannerContent({
  schoolId,
  initialDestination,
  initialOriginId,
  initialTravelMode,
}: {
  schoolId: string;
  initialDestination: Destination | null;
  initialOriginId: string | null;
  initialTravelMode: TravelMode;
}) {
  const theme = useTheme();
  const mounted = useRef(true);
  const generation = useRef(0);
  const openingLock = useRef(false);
  const [places, setPlaces] = useState<CampusMapPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(initialDestination);
  const [originId, setOriginId] = useState<string | null>(initialOriginId);
  const [mode, setMode] = useState<TravelMode>(initialTravelMode);
  const [picker, setPicker] = useState<'destination' | 'origin' | null>(
    initialDestination ? null : 'destination',
  );
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(false);
  const [linkError, setLinkError] = useState('');

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
    setPlaces([]);
    try {
      const result = await loadCampusMapPlaces(schoolId);
      if (mounted.current && generation.current === request) setPlaces(result);
    } catch {
      if (mounted.current && generation.current === request) setLoadError(true);
    } finally {
      if (mounted.current && generation.current === request) setLoading(false);
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);

  const target =
    destination?.kind === 'coordinate'
      ? destination.place
      : places.find((place) => destination?.kind === 'place' && place.id === destination.id);
  const origin = places.find((place) => place.id === originId);
  const missingOrigin = Boolean(originId && !origin);
  const missingDestination = destination?.kind === 'place' && !target;
  const results = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return places.filter((place) =>
      [place.name, place.category, place.building, place.description].some((value) =>
        value?.toLocaleLowerCase().includes(keyword),
      ),
    );
  }, [places, query]);
  const beginSelection = (next: 'destination' | 'origin') => {
    setPicker(next);
    setQuery('');
    setLinkError('');
  };
  const openDirections = async () => {
    if (!mounted.current || openingLock.current || !target || missingOrigin) return;
    openingLock.current = true;
    setOpening(true);
    setLinkError('');
    const destinationValue = encodeURIComponent(`${target.lat},${target.lng}`);
    const originValue = origin
      ? `&origin=${encodeURIComponent(`${origin.lat},${origin.lng}`)}`
      : '';
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destinationValue}&travelmode=${mode}${originValue}`;
    try {
      await Linking.openURL(url);
    } catch {
      if (mounted.current) setLinkError('無法開啟 Google Maps，請確認網路連線後再試一次。');
    } finally {
      openingLock.current = false;
      if (mounted.current) setOpening(false);
    }
  };
  const body = { ...theme.typography.body, color: theme.colors.text };
  const detail = { ...theme.typography.bodySmall, color: theme.colors.muted };

  return (
    <AIScreen contentContainerStyle={{ paddingTop: theme.space.md }}>
      <AICard title="這次要去哪裡？">
        <View style={{ gap: theme.space.md }}>
          <Text style={detail}>選好地點與交通方式，在 Google Maps 查看路線、時間與轉乘資訊。</Text>
          <View style={{ gap: theme.space.xs }}>
            <Text style={detail}>目的地</Text>
            <Text style={body}>
              {target?.name ??
                (destination ? (loading ? '正在讀取目的地…' : '尚未確認目的地') : '尚未選擇')}
            </Text>
            {destination?.kind === 'coordinate' ? (
              <Text style={detail}>由開啟此頁的地點帶入，請在地圖中確認位置。</Text>
            ) : null}
            <AIButton
              label={target ? '更換目的地' : '選擇目的地'}
              variant="ghost"
              disabled={opening}
              onPress={() => beginSelection('destination')}
            />
          </View>
          <View style={{ gap: theme.space.xs }}>
            <Text style={detail}>起點</Text>
            <Text style={body}>
              {origin?.name ??
                (missingOrigin
                  ? loading
                    ? '正在讀取起點…'
                    : '尚未確認起點'
                  : '在 Google Maps 確認出發地點')}
            </Text>
            <AIButton
              label="選擇校園起點"
              variant="ghost"
              disabled={opening}
              onPress={() => beginSelection('origin')}
            />
            {originId ? (
              <AIButton
                label="改在 Google Maps 設定起點"
                variant="ghost"
                disabled={opening}
                onPress={() => {
                  setOriginId(null);
                  setLinkError('');
                }}
              />
            ) : null}
          </View>
          {!loading && !loadError && (missingDestination || missingOrigin) ? (
            <Text accessibilityRole="alert" style={detail}>
              帶入的校園地點不在目前學校的清單中，請重新選擇。
            </Text>
          ) : null}
        </View>
      </AICard>

      {loading ? (
        <AICard>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={detail}>正在讀取校園地點…</Text>
          </View>
        </AICard>
      ) : loadError ? (
        <AICard title="校園地點暫時無法讀取">
          <View style={{ gap: theme.space.md }}>
            <Text accessibilityRole="alert" style={detail}>
              請確認網路連線後重試。
            </Text>
            <AIButton label="重新讀取地點" onPress={() => void load()} disabled={opening} />
          </View>
        </AICard>
      ) : places.length === 0 ? (
        <AICard title="這所學校尚未提供地點">
          <Text style={detail}>地點資料開放後，就能在這裡選擇校園目的地。</Text>
        </AICard>
      ) : picker ? (
        <AISection title={picker === 'destination' ? '選擇目的地' : '選擇起點'}>
          <View style={{ padding: theme.space.md, gap: theme.space.md }}>
            <TextInput
              accessibilityLabel={picker === 'destination' ? '搜尋目的地' : '搜尋起點'}
              placeholder="搜尋地點或大樓"
              placeholderTextColor={theme.colors.muted}
              value={query}
              onChangeText={setQuery}
              editable={!opening}
              style={{
                ...body,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                padding: theme.space.md,
                minHeight: 48,
              }}
            />
            {results.length === 0 ? (
              <Text style={detail}>找不到符合的地點，試試其他名稱。</Text>
            ) : null}
            {results.length > 20 ? (
              <Text style={detail}>顯示前 20 個地點，輸入名稱可縮小範圍。</Text>
            ) : null}
          </View>
          {results.slice(0, 20).map((place) => (
            <AIRow
              key={place.id}
              title={place.name}
              subtitle={[place.category, place.building, place.floor ? `${place.floor} 樓` : null]
                .filter(Boolean)
                .join(' · ')}
              disabled={opening}
              onPress={() => {
                if (picker === 'destination') setDestination({ kind: 'place', id: place.id });
                else setOriginId(place.id);
                setPicker(null);
                setQuery('');
                setLinkError('');
              }}
            />
          ))}
          <View style={{ padding: theme.space.md }}>
            <AIButton
              label="收起地點清單"
              variant="ghost"
              disabled={opening}
              onPress={() => setPicker(null)}
            />
          </View>
        </AISection>
      ) : null}

      <AICard title="交通方式">
        <View style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
            {MODES.map((option) => (
              <AIChip
                key={option.value}
                label={option.label}
                active={mode === option.value}
                onPress={
                  opening
                    ? undefined
                    : () => {
                        setMode(option.value);
                        setLinkError('');
                      }
                }
              />
            ))}
          </View>
          {mode === 'walking' ? (
            <Text style={detail}>
              步行路線未經無障礙通行驗證；需要無階梯通道時，請向校方確認設施。
            </Text>
          ) : null}
          {mode === 'transit' ? (
            <Text style={detail}>班次與轉乘以 Google Maps 及交通業者公布的資訊為準。</Text>
          ) : null}
          {linkError ? (
            <Text accessibilityRole="alert" style={{ ...detail, color: theme.colors.danger }}>
              {linkError}
            </Text>
          ) : null}
          <AIButton
            label={opening ? '正在開啟…' : '在 Google Maps 查看路線'}
            disabled={opening || !target || missingOrigin}
            onPress={() => void openDirections()}
          />
        </View>
      </AICard>
    </AIScreen>
  );
}

export default TripPlannerScreen;
