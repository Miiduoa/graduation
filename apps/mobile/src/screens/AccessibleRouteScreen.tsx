import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, AIChip } from '../ui/aiFirst';
import { useTheme } from '../state/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { loadCampusMapPlaces, type CampusMapPlace } from '../features/campusMap';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

type Props = ServiceScreenProps & {
  navigation?: ServiceScreenProps['navigation'] & {
    setOptions?: (options: { headerShown: boolean }) => void;
  };
};
const filters = [
  { key: 'all', label: '全部', pattern: /電梯|坡道|無障礙|導盲|自動門/i },
  { key: 'elevator', label: '電梯', pattern: /電梯/ },
  { key: 'ramp', label: '坡道', pattern: /坡道/ },
  { key: 'other', label: '其他設施', pattern: /無障礙|導盲|自動門/i },
] as const;
type Filter = (typeof filters)[number]['key'];

export function AccessibleRouteScreen({ navigation, route }: Props) {
  const { school } = useSchool();
  const { user } = useAuth();
  const scope = JSON.stringify([user?.uid, school.id]);
  const initialScope = useRef(scope);
  const destination =
    initialScope.current === scope && typeof route?.params?.destination === 'string'
      ? route.params.destination.slice(0, 120)
      : '';
  useLayoutEffect(() => {
    navigation?.setOptions?.({ headerShown: false });
  }, [navigation]);
  return (
    <FacilityDirectory
      key={scope}
      schoolId={school.id}
      initialQuery={destination}
      navigation={navigation}
    />
  );
}

function FacilityDirectory({
  schoolId,
  initialQuery,
  navigation,
}: {
  schoolId: string;
  initialQuery: string;
  navigation: Props['navigation'];
}) {
  const theme = useTheme();
  const mounted = useRef(true);
  const generation = useRef(0);
  const [places, setPlaces] = useState<CampusMapPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setFailed(false);
    setPlaces([]);
    try {
      const result = await loadCampusMapPlaces(schoolId);
      if (mounted.current && request === generation.current) setPlaces(result);
    } catch {
      if (mounted.current && request === generation.current) setFailed(true);
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, [schoolId]);
  useEffect(() => {
    void load();
  }, [load]);

  // These are published text labels, not a classification of route or wheelchair suitability.
  const recordedPlaces = useMemo(
    () =>
      places.flatMap((place) => {
        const facilities = place.facilities.filter((label) => filters[0].pattern.test(label));
        return facilities.length > 0 ? [{ ...place, facilities }] : [];
      }),
    [places],
  );
  const visiblePlaces = useMemo(() => {
    const selectedFilter = filters.find((item) => item.key === filter) ?? filters[0];
    const keyword = query.trim().toLowerCase();
    return recordedPlaces.flatMap((place) => {
      const facilities = place.facilities.filter((label) => selectedFilter.pattern.test(label));
      const matches = [place.name, place.building, ...facilities].some((value) =>
        value?.toLowerCase().includes(keyword),
      );
      return facilities.length > 0 && matches ? [{ ...place, facilities }] : [];
    });
  }, [recordedPlaces, filter, query]);
  const body = { ...theme.typography.bodySmall, color: theme.colors.muted };

  return (
    <AIDetailScreen
      title="無障礙設施"
      subtitle="查找校園地點記載的電梯、坡道與相關設施。"
      onBack={() => navigation?.goBack?.()}
    >
      <AICard title="出發前先確認">
        <Text style={body}>
          目前未提供經確認的無障礙路線。下方列出地點資料中的設施文字，不代表沿途可通行或設備正在運作；需要協助時，請先向校方確認出入口與設施狀態。
        </Text>
      </AICard>
      {loading ? (
        <AICard>
          <ActivityIndicator accessibilityLabel="讀取設施資料" color={theme.colors.accent} />
        </AICard>
      ) : failed ? (
        <AICard title="目前無法讀取設施資料">
          <View style={{ gap: theme.space.md }}>
            <Text accessibilityRole="alert" style={body}>
              請確認登入狀態與網路連線後重試。
            </Text>
            <AIButton label="重新讀取設施" onPress={() => void load()} />
          </View>
        </AICard>
      ) : recordedPlaces.length === 0 ? (
        <AICard title="尚未提供相關設施資訊">
          <View style={{ gap: theme.space.md }}>
            <Text style={body}>
              目前地點資料中沒有可列出的電梯、坡道或其他無障礙設施文字。這不表示校園沒有這些設施；可先查詢校園地圖，並向校方確認。
            </Text>
            <AIButton label="重新讀取設施" variant="ghost" onPress={() => void load()} />
          </View>
        </AICard>
      ) : (
        <>
          <AICard title="尋找設施">
            <View style={{ gap: theme.space.md }}>
              <TextInput
                accessibilityLabel="搜尋無障礙設施"
                placeholder="地點或設施名稱"
                placeholderTextColor={theme.colors.muted}
                value={query}
                onChangeText={setQuery}
                maxLength={120}
                returnKeyType="search"
                style={{
                  ...theme.typography.body,
                  color: theme.colors.text,
                  minHeight: 48,
                  padding: theme.space.sm,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                }}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
                {filters.map((item) => (
                  <AIChip
                    key={item.key}
                    label={item.label}
                    active={item.key === filter}
                    onPress={() => setFilter(item.key)}
                  />
                ))}
              </View>
              <Text style={body}>{visiblePlaces.length} 個地點有符合的記載</Text>
            </View>
          </AICard>
          {visiblePlaces.map((place) => (
            <AICard key={place.id} title={place.name}>
              <View style={{ gap: theme.space.md }}>
                {place.facilities.map((facility, index) => (
                  <Text
                    key={`${index}:${facility}`}
                    style={{ ...theme.typography.body, color: theme.colors.text }}
                  >
                    {facility}
                  </Text>
                ))}
                <Text style={body}>樓層、出入口及設備狀態請向校方確認。</Text>
                <AIButton
                  label="在地圖查看地點"
                  variant="ghost"
                  onPress={() => safeNavigate(navigation, 'MapV2', { focusPoiId: place.id })}
                />
              </View>
            </AICard>
          ))}
          {visiblePlaces.length === 0 ? (
            <AICard title="找不到符合的設施">
              <View style={{ gap: theme.space.md }}>
                <Text style={body}>換個地點名稱，或清除篩選再找一次。</Text>
                <AIButton
                  label="清除搜尋與篩選"
                  variant="ghost"
                  onPress={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                />
              </View>
            </AICard>
          ) : null}
        </>
      )}
      <AICard title="查詢其他校園資訊">
        <View style={{ gap: theme.space.md }}>
          <AIButton
            label="開啟校園地圖"
            variant="ghost"
            onPress={() => safeNavigate(navigation, 'MapV2')}
          />
          <AIButton
            label="查看校方公告"
            variant="ghost"
            onPress={() => safeNavigate(navigation, '公告總覽')}
          />
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
