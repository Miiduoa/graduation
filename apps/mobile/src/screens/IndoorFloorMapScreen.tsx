import React, { useMemo, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AICard, AIButton, AIDetailScreen } from '../ui/aiFirst';
import { useTheme } from '../state/theme';
import { useSchool } from '../state/school';
import { safeNavigate } from '../utils/safeNavigate';

type Floor = { id: string; title: string; facilities: string[] };
type Params = {
  buildingId?: string;
  poiId?: string;
  floorId?: string;
  roomId?: string;
  roomCode?: string;
};

const LIBRARY_GUIDE_URL = 'https://b028.pu.edu.tw/p/426-1054-34.php?Lang=zh-tw';

// Library floor allocations are summarized from the school's public directory.
// The directory does not supply verified room polygons or indoor turn-by-turn routes.
const LIBRARY_FLOORS: readonly Floor[] = [
  { id: 'B2', title: '期刊與自習', facilities: ['期刊室', '西方語文過期期刊', '自習室'] },
  { id: 'B1', title: '期刊、咖啡與資訊檢索', facilities: ['現行期刊', '閱報區', '咖啡區', '資訊檢索', '影印掃描'] },
  { id: '1F', title: '流通與參考服務', facilities: ['流通櫃檯', '參考室', '自助借書', '展示區', '列印影印'] },
  { id: '2F', title: '數位學習與視聽資源', facilities: ['數位學習中心', '多媒體資料', '個人及團體視聽', '校史資料室'] },
  { id: '3F', title: '東方語文書庫', facilities: ['圖書分類 000–494.4', '研究小間', '討論室', '閱覽空間'] },
  { id: '4F', title: '東方語文書庫與古籍', facilities: ['圖書分類 494.5–815.8', '古籍室', '討論室', '閱覽空間'] },
  { id: '5F', title: '東方語文書庫', facilities: ['圖書分類 815.9–859.9', '學習促進區'] },
  { id: '6F', title: '東方語文書庫', facilities: ['圖書分類 860–999', '研究小間', '討論室'] },
  { id: '7F', title: '西方語文書庫', facilities: ['圖書分類 000–499'] },
  { id: '8F', title: '西方語文書庫', facilities: ['圖書分類 500–808.82', '研究小間', '討論室'] },
  { id: '9F', title: '西方語文書庫', facilities: ['圖書分類 808.83–999'] },
  { id: '10F', title: '蓋夏廳與行政辦公', facilities: ['蓋夏廳', '館長室', '副館長室'] },
];

export function IndoorFloorMapScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { school } = useSchool();
  const theme = useTheme();
  const params = (route.params ?? {}) as Params;
  const requestedBuilding = params.buildingId ?? params.poiId ?? '';
  const isLibrary = school.id === 'pu' && ['lib', 'pu-library', 'library'].includes(requestedBuilding);
  const requestedFloor = (params.floorId ?? '').replace(/^lib-/i, '').toUpperCase();
  const [search, setSearch] = useState(
    isLibrary && LIBRARY_FLOORS.some((floor) => floor.id === requestedFloor) ? requestedFloor : '',
  );
  const [error, setError] = useState('');
  const visibleFloors = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('zh-TW');
    return LIBRARY_FLOORS.filter((floor) =>
      [floor.id, floor.title, ...floor.facilities].some((label) =>
        label.toLocaleLowerCase('zh-TW').includes(needle),
      ),
    );
  }, [search]);
  const bodyStyle = { ...theme.typography.bodySmall, color: theme.colors.muted };

  async function openOfficialGuide() {
    setError('');
    try {
      await Linking.openURL(LIBRARY_GUIDE_URL);
    } catch {
      setError('無法開啟校方樓層導覽，請確認網路連線後再試一次。');
    }
  }

  return (
    <AIDetailScreen
      title="室內樓層導覽"
      subtitle="先查證來源，再確認建築與樓層位置。"
      onBack={() => navigation.goBack?.()}
    >
      {!isLibrary ? (
        <AICard title="尚未提供可核對的室內平面圖">
          <View style={{ gap: theme.space.md }}>
            <Text style={bodyStyle}>
              {school.name}目前沒有這個建築的已核實室內圖資。為避免導到錯誤樓層，不會套用其他學校的圖書館或示意房間位置。
            </Text>
            <AIButton
              label="返回目前學校地圖"
              variant="ghost"
              onPress={() => safeNavigate(navigation, 'MapV2')}
            />
          </View>
        </AICard>
      ) : (
        <>
          <AICard title="蓋夏圖書館 · 官方樓層資訊">
            <View style={{ gap: theme.space.md }}>
              <Text style={bodyStyle}>
                以下為靜宜大學圖書館公布的樓層配置摘要，不是室內比例平面圖，也不代表設備目前可使用。房間位置、出入口及電梯動線請以校方最新資訊與現場標示為準。
              </Text>
              <AIButton
                label="開啟圖書館官方樓層導覽"
                onPress={() => void openOfficialGuide()}
              />
              {error ? (
                <Text accessibilityRole="alert" style={{ ...bodyStyle, color: theme.colors.danger }}>
                  {error}
                </Text>
              ) : null}
            </View>
          </AICard>
          <AICard title="查詢樓層與設施">
            <TextInput
              accessibilityLabel="搜尋樓層與設施"
              placeholder="例如 B1、討論室、影印或數位學習"
              placeholderTextColor={theme.colors.muted}
              value={search}
              onChangeText={setSearch}
              maxLength={80}
              returnKeyType="search"
              style={{
                ...theme.typography.body,
                color: theme.colors.text,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                padding: theme.space.sm,
                minHeight: 48,
                marginTop: theme.space.sm,
              }}
            />
            <Text style={bodyStyle}>{visibleFloors.length} 個符合條件的樓層</Text>
            {search ? (
              <AIButton label="清除樓層搜尋" variant="ghost" onPress={() => setSearch('')} />
            ) : null}
          </AICard>
          {visibleFloors.map((floor) => (
            <AICard key={floor.id} title={`${floor.id} · ${floor.title}`}>
              <Text style={bodyStyle}>{floor.facilities.join('、')}</Text>
            </AICard>
          ))}
          {!visibleFloors.length ? (
            <AICard title="找不到符合的樓層">
              <View style={{ gap: theme.space.sm }}>
                <Text style={bodyStyle}>可以換個設施名稱，或到校方網站確認最新配置。</Text>
                <AIButton label="顯示全部樓層" variant="ghost" onPress={() => setSearch('')} />
              </View>
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}

export default IndoorFloorMapScreen;
