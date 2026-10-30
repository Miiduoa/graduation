import React, { useMemo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIScreen } from '../ui/aiFirst';
import { rootNavigateNested } from '../app/rootNavigation';
import { AppActionIcon } from '../ui/AppActionIcon';
import type { GeneratedButtonIconId } from '../ui/generatedButtonIcons';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useSchool } from '../state/school';
import { supportsLegacyTransportHub } from '../features/campusTransportScope';
import { isFeatureEnabled } from '../services/release';
import { safeNavigate } from '../utils/safeNavigate';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';
import { OpenOrderCard } from '../components/OpenOrderCard';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { getMobileQuickActions } from '../services/quickCampusActions';

type ServiceItem = {
  icon: GeneratedButtonIconId;
  label: string;
  description: string;
  screen: string;
  keywords: string[];
};
const frequentServices: ServiceItem[] = [
  {
    icon: 'ic_navigate_pin',
    label: '校園地圖',
    description: '找大樓與教室',
    screen: 'MapV2',
    keywords: ['地圖', '導航', '系所', '位置', '路線'],
  },
  {
    icon: 'ic_restaurant',
    label: '餐廳',
    description: '看菜單、找餐廳',
    screen: '餐廳總覽',
    keywords: ['吃', '食堂', '餐飲', '菜單', '點餐'],
  },
  {
    icon: 'ic_bus',
    label: '校園公車',
    description: '查站牌與到站',
    screen: 'BusV2',
    keywords: ['公車', '校車', '搭車', '到站'],
  },
  {
    icon: 'ic_library',
    label: '圖書館',
    description: '找書與館內服務',
    screen: 'Library',
    keywords: ['借書', '還書', '自習', '蓋夏', '館藏'],
  },
];
const sections: Array<{ title: string; items: ServiceItem[] }> = [
  {
    title: '校園動態',
    items: [
      {
        icon: 'ic_notifications',
        label: '校方公告',
        description: '學校最新消息',
        screen: '公告總覽',
        keywords: ['消息', '新聞', '通知'],
      },
      {
        icon: 'ic_tab_today',
        label: '校園活動',
        description: '找活動與報名',
        screen: '活動總覽',
        keywords: ['活動', '報名', '社團'],
      },
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
        description: '課程與自己的安排',
        screen: 'SmartCalendarScreen',
        keywords: ['今天', '時間', '行程', '日曆'],
      },
    ],
  },
  {
    title: '辦事與服務',
    items: [
      {
        icon: 'ic_school',
        label: '學校資訊',
        description: '總機、官網與校方服務',
        screen: 'SchoolInfo',
        keywords: [
          '總機',
          '官網',
          '地址',
          '名錄',
          '聯絡',
          '宿舍',
          '住宿',
          '職涯',
          '實習',
          '寢室',
          '入住',
          '就業',
          '工作',
        ],
      },
      {
        icon: 'ic_dorm',
        label: '宿舍',
        description: '入住安排、設備問題與洗衣計時',
        screen: 'Dormitory',
        keywords: ['住宿', '寢室', '床位', '入住', '退宿', '報修', '維修', '洗衣'],
      },
      {
        icon: 'ic_health_heart',
        label: '健康',
        description: '校園健康與諮商服務',
        screen: 'Health',
        keywords: ['醫療', '診所', '保健', '諮商'],
      },
      {
        icon: 'ic_lost_found',
        label: '失物招領',
        description: '找回遺失物品',
        screen: 'LostFound',
        keywords: ['失物', '招領', '撿到', '遺失'],
      },
      {
        icon: 'ic_print',
        label: '列印',
        description: '準備列印文件',
        screen: 'PrintService',
        keywords: ['印表機', '影印', '掃描', '文件'],
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
  {
    title: '交通與設施',
    items: [
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
        description: '高鐵、火車與轉乘',
        screen: 'TransportHub',
        keywords: ['交通', '車站', '高鐵', '台鐵', 'youbike'],
      },
      {
        icon: 'ic_accessibility',
        label: '無障礙設施',
        description: '電梯與坡道',
        screen: 'AccessibleRoute',
        keywords: ['輪椅', '電梯', '坡道'],
      },
    ],
  },
];

type Navigation = Parameters<typeof safeNavigate>[0];
export function CampusHubScreen({ navigation }: { navigation?: Navigation }) {
  const { school } = useSchool();
  return <CampusDirectory key={school.id} schoolId={school.id} navigation={navigation} />;
}

function CampusDirectory({ schoolId, navigation }: { schoolId: string; navigation?: Navigation }) {
  const s = useThemeStyleSheet(createStyles);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const keyword = query.trim().toLowerCase();
  const paymentsEnabled = isFeatureEnabled('payments');
  const filtered = useMemo(() => {
    const isProvidence = supportsLegacyTransportHub(schoolId);
    return [{ title: '常用服務', items: frequentServices }, ...sections]
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (!isProvidence && item.screen === 'TransportHub') return false;
          if (!paymentsEnabled && item.screen === 'Payment') return false;
          const keywords =
            !isProvidence && item.screen === 'Library'
              ? item.keywords.filter((word) => word !== '蓋夏')
              : item.keywords;
          return [item.label, item.description, ...keywords].some((value) =>
            value.toLowerCase().includes(keyword),
          );
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [keyword, schoolId, paymentsEnabled]);
  const matchCount = filtered.reduce((count, section) => count + section.items.length, 0);
  const quickActions = keyword
    ? getMobileQuickActions(query).filter(
        (action) => !filtered.some((section) =>
          section.items.some((item) => item.screen === action.route)),
      )
    : [];
  const openService = (item: ServiceItem) => {
    Keyboard.dismiss();
    safeNavigate(navigation, item.screen, undefined, {
      fallbackMessage: `「${item.label}」目前無法開啟。`,
    });
  };

  return (
    <AIScreen
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={s.content}
    >
      <View style={s.header}>
        <SchoolBrowsingControl compact />
        <HeaderAvatarButton />
      </View>
      <View style={s.intro}>
        <Text accessibilityRole="header" style={s.heading}>
          生活
        </Text>
        <Text style={s.subtitle}>找地方、吃點東西，把校園的事安排好。</Text>
      </View>
      <View style={[s.searchBox, searchFocused && s.searchFocused]}>
        <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
        <TextInput
          accessibilityLabel="搜尋校園服務"
          value={query}
          onChangeText={setQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onSubmitEditing={() => Keyboard.dismiss()}
          placeholder="搜尋地點或服務"
          placeholderTextColor={theme.colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardAppearance={theme.mode}
          selectionColor={theme.colors.accent}
          maxLength={120}
          returnKeyType="search"
          style={s.searchInput}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除搜尋"
            onPress={() => setQuery('')}
            style={s.clearSearch}
          >
            <Ionicons name="close-circle" size={19} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {keyword ? (
        <Text accessibilityLiveRegion="polite" style={s.searchCaption}>
          找到 {matchCount} 項清單服務{quickActions.length ? '，另有 ' + quickActions.length + ' 項捷徑' : ''}
        </Text>
      ) : (
        <OpenOrderCard navigation={navigation} />
      )}
      {quickActions.length > 0 ? (
        <View style={s.section}>
          <Text accessibilityRole="header" style={s.sectionTitle}>可以直接做</Text>
          <View style={s.serviceList}>
            {quickActions.map((action) => (
              <Pressable
                key={action.destination}
                accessibilityRole="button"
                accessibilityLabel={'依需求前往' + action.label}
                onPress={() => {
                  Keyboard.dismiss();
                  safeNavigate(navigation, action.route, action.params, {
                    fallbackMessage: '目前無法開啟對應服務，請稍後重試。',
                  });
                }}
                style={({ pressed }) => [s.serviceRow, pressed && s.pressed]}
              >
                <View style={s.serviceCopy}>
                  <Text style={s.serviceTitle}>{action.label}</Text>
                  <Text style={s.serviceDetail}>{action.description}</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={theme.colors.accent} />
              </Pressable>
            ))}
          </View>
          <Text style={s.subtitle}>這裡只會開啟功能，變更或提交仍需你確認。</Text>
        </View>
      ) : null}
      {filtered.map((section) => {
        const isFrequent = !keyword && section.title === '常用服務';
        return (
          <View key={section.title} style={s.section}>
            <Text accessibilityRole="header" style={s.sectionTitle}>
              {section.title}
            </Text>
            <View style={isFrequent ? s.quickGrid : s.serviceList}>
              {section.items.map((item, index) => (
                <Pressable
                  key={item.screen}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label}，${item.description}`}
                  testID={
                    item.screen === 'MapV2'
                      ? 'e2e-campus-open-map'
                      : item.screen === '餐廳總覽'
                        ? 'e2e-campus-open-cafeteria'
                        : undefined
                  }
                  onPress={() => openService(item)}
                  style={({ pressed }) => [
                    isFrequent ? s.quickCard : s.serviceRow,
                    !isFrequent && index > 0 && s.rowBorder,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={isFrequent ? s.quickIcon : s.rowIcon}>
                    <AppActionIcon
                      name={item.icon}
                      size={isFrequent ? 23 : 21}
                      fallback="ionicon"
                      color={theme.colors.accent}
                    />
                  </View>
                  <View style={s.serviceCopy}>
                    <Text style={s.serviceTitle}>{item.label}</Text>
                    <Text style={s.serviceDetail}>{item.description}</Text>
                  </View>
                  {!isFrequent ? (
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {matchCount === 0 && quickActions.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="search-outline" size={28} color={theme.colors.muted} />
          <Text style={s.emptyTitle}>找不到「{query.trim()}」相關的服務</Text>
          <Text style={s.subtitle}>試試「圖書館」、「公車」或「公告」。</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={({ pressed }) => [s.resetSearch, pressed && s.pressed]}
          >
            <Text style={s.link}>查看所有服務</Text>
          </Pressable>
        </View>
      ) : null}
      {!keyword ? (
        <View style={s.section}>
          <Text accessibilityRole="header" style={s.sectionTitle}>
            和同學一起
          </Text>
          <View style={s.serviceList}>
            <Pressable
              accessibilityRole="button"
              onPress={() => rootNavigateNested('訊息', 'FriendSearch')}
              style={({ pressed }) => [s.serviceRow, pressed && s.pressed]}
            >
              <View style={s.serviceCopy}>
                <Text style={s.serviceTitle}>找人</Text>
                <Text style={s.serviceDetail}>加好友後，分享課表與查看共同空堂。</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </AIScreen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 12 },
    intro: { paddingTop: 22, paddingBottom: 20, gap: 6 },
    heading: {
      color: theme.colors.text,
      fontSize: 30,
      lineHeight: 38,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    subtitle: { color: theme.colors.muted, fontSize: 14, lineHeight: 23 },
    searchBox: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    searchFocused: { borderColor: theme.colors.accent },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 50,
      color: theme.colors.text,
      fontSize: 15,
      paddingVertical: 12,
    },
    clearSearch: { minHeight: 44, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
    searchCaption: { color: theme.colors.muted, fontSize: 12, lineHeight: 20, paddingTop: 12 },
    section: { marginTop: 24 },
    sectionTitle: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '600',
      marginBottom: 10,
    },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    quickCard: {
      flexBasis: '45%',
      flexGrow: 1,
      minWidth: 130,
      minHeight: 122,
      padding: 16,
      gap: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    quickIcon: { width: 38, height: 38, justifyContent: 'center' },
    serviceList: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 14,
      overflow: 'hidden',
    },
    serviceRow: {
      minHeight: 74,
      paddingHorizontal: 16,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    rowIcon: { width: 26, alignItems: 'center' },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
    serviceCopy: { flex: 1, minWidth: 0, gap: 3 },
    serviceTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    serviceDetail: { color: theme.colors.muted, fontSize: 12, lineHeight: 20 },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    emptyState: { paddingVertical: 36, alignItems: 'center', gap: 12 },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '600',
      textAlign: 'center',
    },
    resetSearch: {
      minHeight: 44,
      paddingHorizontal: 16,
      justifyContent: 'center',
      borderRadius: 8,
    },
    link: { color: theme.colors.accent, fontSize: 14, fontWeight: '600' },
  });
