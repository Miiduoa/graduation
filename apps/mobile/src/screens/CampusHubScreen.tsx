import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIScreen, AIHero, AICard, AISection, AIEmptyState } from '../ui/aiFirst';
import { AppActionIcon } from '../ui/AppActionIcon';
import type { GeneratedButtonIconId } from '../ui/generatedButtonIcons';
import { useTheme } from '../state/theme';
import { useSchool } from '../state/school';
import { safeNavigate } from '../utils/safeNavigate';
import { aiOverlay } from '../app/useAIOverlay';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';

type ServiceItem = {
  icon: GeneratedButtonIconId;
  label: string;
  description: string;
  screen: string;
  keywords: string[];
};
const sections: Array<{ title: string; items: ServiceItem[] }> = [
  {
    title: '課餘生活',
    items: [
      {
        icon: 'ic_people_community',
        label: '校園社群',
        description: '看板與近況',
        screen: 'CampusSocialScreen',
        keywords: ['社群', '看板', '動態', '發文', '學伴'],
      },
      {
        icon: 'ic_tab_today',
        label: '行事曆',
        description: '課程與安排',
        screen: 'SmartCalendarScreen',
        keywords: ['今天', '時間', '行程', '日曆'],
      },
      {
        icon: 'ic_tab_today',
        label: '校園活動',
        description: '找活動與報名',
        screen: '活動總覽',
        keywords: ['活動', '報名', '社團'],
      },
    ],
  },
  {
    title: '校園服務',
    items: [
      {
        icon: 'ic_restaurant',
        label: '餐廳',
        description: '菜單與訂餐',
        screen: '餐廳總覽',
        keywords: ['吃', '食堂', '餐飲', '菜單', '點餐'],
      },
      {
        icon: 'ic_library',
        label: '圖書館',
        description: '館藏與借閱',
        screen: 'Library',
        keywords: ['借書', '還書', '自習', '蓋夏'],
      },
      {
        icon: 'ic_dorm',
        label: '宿舍',
        description: '住宿服務',
        screen: 'Dormitory',
        keywords: ['住宿', '寢室', '報修'],
      },
      {
        icon: 'ic_bus',
        label: '校園公車',
        description: '路線與站牌',
        screen: 'BusV2',
        keywords: ['公車', '校車', '搭車', '到站'],
      },
      {
        icon: 'ic_navigate_pin',
        label: '校園地圖',
        description: '大樓與設施',
        screen: 'MapV2',
        keywords: ['地圖', '導航', '系所', '路線'],
      },
      {
        icon: 'ic_navigate_pin',
        label: '路線規劃',
        description: '步行與轉乘',
        screen: 'TripPlanner',
        keywords: ['導航', '怎麼去', 'directions'],
      },
      {
        icon: 'ic_bus',
        label: '台中交通',
        description: '高鐵與火車',
        screen: 'TransportHub',
        keywords: ['交通', '車站', '高鐵', '台鐵', 'youbike'],
      },
      {
        icon: 'ic_print',
        label: '列印',
        description: '準備列印文件',
        screen: 'PrintService',
        keywords: ['印表機', '影印', '掃描', '文件'],
      },
      {
        icon: 'ic_health_heart',
        label: '健康',
        description: '校園健康服務',
        screen: 'Health',
        keywords: ['醫療', '診所', '保健'],
      },
      {
        icon: 'ic_lost_found',
        label: '失物招領',
        description: '找回遺失物品',
        screen: 'LostFound',
        keywords: ['失物', '招領', '撿到', '遺失'],
      },
      {
        icon: 'ic_accessibility',
        label: '無障礙路線',
        description: '電梯與坡道',
        screen: 'AccessibleRoute',
        keywords: ['輪椅', '電梯', '坡道'],
      },
      {
        icon: 'ic_payment_card',
        label: '校園錢包',
        description: '餘額與交易紀錄',
        screen: 'Payment',
        keywords: ['付款', '支付', '繳費', '儲值'],
      },
    ],
  },
];

type Navigation = Parameters<typeof safeNavigate>[0];
export function CampusHubScreen({ navigation }: { navigation?: Navigation }) {
  const { school } = useSchool();
  return <CampusDirectory key={school.id} schoolName={school.name} navigation={navigation} />;
}

function CampusDirectory({
  schoolName,
  navigation,
}: {
  schoolName: string;
  navigation?: Navigation;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          [item.label, item.description, ...item.keywords].some((text) =>
            text.toLowerCase().includes(keyword),
          ),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [query]);
  const openAssistant = () => aiOverlay.open({ mode: 'chat', source: 'campus_hub' });
  const openService = (item: ServiceItem) => {
    safeNavigate(navigation, item.screen, undefined, {
      fallbackMessage: `「${item.label}」目前無法開啟。`,
    });
  };

  return (
    <AIScreen keyboardShouldPersistTaps="handled">
      <View
        style={{
          paddingHorizontal: theme.layout.screenPadding,
          paddingTop: theme.space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.md,
        }}
      >
        <HeaderAvatarButton />
        <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
          {schoolName}
        </Text>
      </View>
      <AIHero title="校園" subtitle="找地點、查服務，安排課餘生活。" />
      <AICard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          <View
            style={{
              flex: 1,
              minHeight: 48,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.sm,
              paddingHorizontal: theme.space.sm,
            }}
          >
            <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
            <TextInput
              accessibilityLabel="搜尋校園服務"
              value={query}
              onChangeText={setQuery}
              placeholder="搜尋地點或服務"
              placeholderTextColor={theme.colors.muted}
              maxLength={120}
              returnKeyType="search"
              style={{
                flex: 1,
                minHeight: 48,
                ...theme.typography.bodySmall,
                color: theme.colors.text,
              }}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清除搜尋"
                onPress={() => setQuery('')}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Ionicons name="close-circle-outline" size={20} color={theme.colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="詢問校園助理"
            onPress={openAssistant}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Ionicons name="chatbubble-outline" size={21} color={theme.colors.onAccent} />
          </Pressable>
        </View>
      </AICard>
      {!query.trim() ? (
        <AICard title="先找到要去的地方">
          <Pressable
            testID="e2e-campus-open-map"
            accessibilityRole="button"
            accessibilityLabel="開啟校園地圖"
            onPress={() => safeNavigate(navigation, 'MapV2')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.md,
              minHeight: 64,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                backgroundColor: theme.colors.accentSoft,
                borderRadius: theme.radius.md,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name="map-outline" size={24} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...theme.typography.h3, color: theme.colors.text }}>校園地圖</Text>
              <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                搜尋大樓、系所與設施，查看步行路線。
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
        </AICard>
      ) : null}
      {filtered.map((section) => (
        <AISection key={section.title} title={section.title}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {section.items.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}，${item.description}`}
                testID={item.label === '餐廳' ? 'e2e-campus-open-cafeteria' : undefined}
                onPress={() => openService(item)}
                style={({ pressed }) => ({
                  width: '33.333%',
                  minHeight: 116,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: theme.space.xs,
                  paddingHorizontal: theme.space.xs,
                  paddingVertical: theme.space.md,
                  backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                })}
              >
                <AppActionIcon
                  name={item.icon}
                  size={24}
                  fallback="ionicon"
                  color={theme.colors.accent}
                />
                <Text
                  style={{
                    ...theme.typography.label,
                    color: theme.colors.text,
                    textAlign: 'center',
                    marginTop: theme.space.xs,
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  style={{
                    ...theme.typography.caption,
                    color: theme.colors.muted,
                    textAlign: 'center',
                  }}
                >
                  {item.description}
                </Text>
              </Pressable>
            ))}
          </View>
        </AISection>
      ))}
      {filtered.length === 0 ? (
        <AIEmptyState
          title={`找不到「${query.trim()}」相關的服務`}
          subtitle="試試其他關鍵字，或詢問校園助理。"
        />
      ) : null}
    </AIScreen>
  );
}
