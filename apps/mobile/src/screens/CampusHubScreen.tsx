import React, { useMemo, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIScreen } from '../ui/aiFirst';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useSchool } from '../state/school';
import { supportsLegacyTransportHub } from '../features/campusTransportScope';
import { isFeatureEnabled } from '../services/release';
import { safeNavigate } from '../utils/safeNavigate';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';
import { OpenOrderCard } from '../components/OpenOrderCard';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { getMobileQuickActions } from '../services/quickCampusActions';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type ServiceItem = {
  icon: IconName;
  label: string;
  description: string;
  screen: string;
  params?: { tab: 'food' };
  keywords: string[];
  secondary?: boolean;
};
const frequentServices: ServiceItem[] = [
  {
    icon: 'map-outline',
    label: '校園地圖',
    description: '找大樓與教室',
    screen: 'MapV2',
    keywords: ['地圖', '導航', '系所', '位置', '路線'],
  },
  {
    icon: 'restaurant-outline',
    label: '餐廳',
    description: '看菜單、找餐廳',
    screen: '餐廳總覽',
    keywords: ['吃', '食堂', '餐飲', '菜單', '點餐'],
  },
  {
    icon: 'bus-outline',
    label: '校園公車',
    description: '查站牌與到站',
    screen: 'BusV2',
    keywords: ['公車', '校車', '搭車', '到站'],
  },
  {
    icon: 'library-outline',
    label: '圖書館',
    description: '找書與館內服務',
    screen: 'Library',
    keywords: ['借書', '還書', '自習', '蓋夏', '館藏'],
  },
];
const sections: Array<{ title: string; searchOnly?: boolean; items: ServiceItem[] }> = [
  {
    title: '餐飲與住宿',
    items: [
      {
        icon: 'bed-outline',
        label: '宿舍',
        screen: 'Dormitory',
        description: '入住安排、設備問題與洗衣計時',
        keywords: ['住宿', '寢室', '床位', '入住', '退宿', '報修', '維修', '洗衣'],
      },
      {
        icon: 'receipt-outline',
        label: '我的訂單',
        screen: 'StudentOrders',
        description: '查看 App 校園餐廳的取餐號碼、進度與訂餐紀錄',
        keywords: ['取餐', '訂單狀態', '訂單紀錄', '訂單進度', '餐點訂單'],
      },
      {
        icon: 'storefront-outline',
        label: '站內點餐',
        screen: 'NuniWorkspace',
        params: { tab: 'food' },
        description: '查看 nuni 平台的門市與訂單紀錄',
        keywords: ['站內訂單', '站內取餐', '平台點餐', '平台訂單'],
      },
      {
        icon: 'wallet-outline',
        label: '校園錢包',
        screen: 'Payment',
        secondary: true,
        description: '餘額與交易紀錄',
        keywords: ['付款', '支付', '繳費', '儲值'],
      },
    ],
  },
  {
    title: '校園資源',
    items: [
      {
        icon: 'megaphone-outline',
        label: '校方公告',
        screen: '公告總覽',
        description: '學校最新消息',
        keywords: ['消息', '新聞', '通知'],
      },
      {
        icon: 'calendar-outline',
        label: '校園活動',
        screen: '活動總覽',
        description: '找活動與報名',
        keywords: ['活動', '報名', '社團'],
      },
      {
        icon: 'bag-handle-outline',
        label: '失物招領',
        screen: 'PlatformLostFound',
        description: '找回遺失物品',
        keywords: ['失物', '招領', '撿到', '遺失'],
      },
      {
        icon: 'people-outline',
        label: '社團',
        screen: 'Clubs',
        description: '找社團、查看已加入社團與活動',
        keywords: ['社團', '學會', '招新', '入社', '社員', '幹部', '社課'],
      },
      {
        icon: 'briefcase-outline',
        label: '職涯',
        screen: 'Career',
        description: '找實習、工讀與校方職涯資訊',
        keywords: ['職涯', '實習', '工讀', '就業', '工作', '徵才', '履歷', '求職'],
      },
      {
        icon: 'information-circle-outline',
        label: '學校資訊',
        screen: 'SchoolInfo',
        description: '總機、官網與校方服務',
        keywords: ['總機', '官網', '地址', '名錄', '聯絡', '宿舍', '住宿', '寢室', '入住'],
      },
      {
        icon: 'heart-outline',
        label: '健康',
        screen: 'Health',
        secondary: true,
        description: '校園健康與諮商服務',
        keywords: ['醫療', '診所', '保健', '諮商'],
      },
      {
        icon: 'print-outline',
        label: '列印',
        screen: 'PrintService',
        secondary: true,
        description: '準備列印文件',
        keywords: ['印表機', '影印', '掃描', '文件'],
      },
    ],
  },
  {
    title: '出行與設施',
    items: [
      {
        icon: 'navigate-outline',
        label: '路線規劃',
        screen: 'TripPlanner',
        secondary: true,
        description: '步行與轉乘',
        keywords: ['導航', '怎麼去', 'directions'],
      },
      {
        icon: 'train-outline',
        label: '台中交通',
        screen: 'TransportHub',
        secondary: true,
        description: '高鐵、火車與轉乘',
        keywords: ['交通', '車站', '高鐵', '台鐵', 'youbike'],
      },
      {
        icon: 'accessibility-outline',
        label: '無障礙設施',
        screen: 'AccessibleRoute',
        secondary: true,
        description: '電梯與坡道',
        keywords: ['輪椅', '電梯', '坡道'],
      },
    ],
  },
  {
    title: '交流與課務',
    searchOnly: true,
    items: [
      {
        icon: 'chatbubbles-outline',
        label: '校園社群',
        screen: 'CampusSocialScreen',
        description: '交流裡的校園看板與近況',
        keywords: ['社群', '看板', '動態', '發文', '學伴'],
      },
      {
        icon: 'person-add-outline',
        label: '找人',
        screen: 'FriendSearch',
        description: '加好友後，分享課表與查看共同空堂。',
        keywords: ['找同學', '找朋友', '同校成員'],
      },
      {
        icon: 'calendar-number-outline',
        label: '校園行事曆',
        screen: 'SmartCalendarScreen',
        description: '校園活動與作業截止；個人行程、課表另開',
        keywords: ['今天', '時間', '行程', '日曆'],
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
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.2 || width < 320;
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const keyword = query.normalize('NFKC').trim().toLowerCase();
  const paymentsEnabled = isFeatureEnabled('payments');
  const filtered = useMemo(() => {
    const isProvidence = supportsLegacyTransportHub(schoolId);
    const terms = keyword.split(/\s+/);
    return [{ title: FREQUENT_TITLE, searchOnly: false, items: frequentServices }, ...sections]
      .filter((section) => keyword || !section.searchOnly)
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (!isProvidence && item.screen === 'TransportHub') return false;
          if (!paymentsEnabled && item.screen === 'Payment') return false;
          const keywords =
            !isProvidence && item.screen === 'Library'
              ? item.keywords.filter((word) => word !== '蓋夏')
              : item.keywords;
          const fields = [item.label, item.description, ...keywords];
          return terms.every((term) => fields.some((value) => value.toLowerCase().includes(term)));
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [keyword, schoolId, paymentsEnabled]);
  const matchCount = filtered.reduce((count, section) => count + section.items.length, 0);
  const quickActions = keyword
    ? getMobileQuickActions(query).filter(
        (action) =>
          !filtered.some((section) =>
            section.items.some((item) => item.screen === action.route && !item.params),
          ),
      )
    : [];
  const openService = (item: ServiceItem) => {
    Keyboard.dismiss();
    safeNavigate(navigation, item.screen, item.params, {
      fallbackMessage: `「${item.label}」目前無法開啟。`,
    });
  };

  const toggleSection = (title: string) =>
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  const renderService = (item: ServiceItem, nested: boolean, divider: 'inset' | 'full') => (
    <React.Fragment key={item.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.label}，${item.description}`}
        testID={serviceTestId(item)}
        onPress={() => openService(item)}
        android_ripple={{ color: theme.colors.surfaceInteractiveStrong }}
        style={({ pressed }) => [s.serviceRow, nested && s.childRow, pressed && s.pressed]}
      >
        <View style={s.rowIcon} accessibilityElementsHidden>
          <Ionicons name={item.icon} size={22} color={theme.colors.accent} />
        </View>
        <View style={s.serviceCopy}>
          <Text style={nested ? s.childTitle : s.serviceTitle}>{item.label}</Text>
          <Text style={s.serviceDetail}>{item.description}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
      </Pressable>
      <View
        style={[s.divider, divider === 'inset' && (nested ? s.dividerNested : s.dividerInset)]}
      />
    </React.Fragment>
  );
  const renderServiceList = (items: ServiceItem[]) => (
    <View style={s.list}>{items.map((item) => renderService(item, false, 'inset'))}</View>
  );
  const frequentSection = filtered.find((section) => section.title === FREQUENT_TITLE);
  const browseSections = filtered.filter((section) => section.title !== FREQUENT_TITLE);

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
      </View>
      <View style={[s.searchBox, searchFocused && s.searchFocused]}>
        <Ionicons name="search" size={18} color={theme.colors.muted} accessible={false} />
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
          找到 {matchCount} 項清單服務
          {quickActions.length ? '，另有 ' + quickActions.length + ' 項捷徑' : ''}
        </Text>
      ) : (
        <OpenOrderCard navigation={navigation} />
      )}

      {frequentSection && !keyword && !stacked ? (
        <View style={s.band}>
          {frequentSection.items.map((item, index) => (
            <Pressable
              key={item.screen}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}，${item.description}`}
              testID={serviceTestId(item)}
              onPress={() => openService(item)}
              android_ripple={{ color: theme.colors.surfaceInteractiveStrong }}
              style={({ pressed }) => [
                s.bandButton,
                index > 0 && s.bandDivider,
                pressed && s.pressed,
              ]}
            >
              <Ionicons name={item.icon} size={26} color={theme.colors.accent} accessible={false} />
              <Text style={s.bandLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {frequentSection && (keyword || stacked) ? (
        <View style={s.section}>
          <Text accessibilityRole="header" style={s.sectionTitle}>
            {frequentSection.title}
          </Text>
          {renderServiceList(frequentSection.items)}
        </View>
      ) : null}

      {keyword
        ? browseSections.map((section) => (
            <View key={section.title} style={s.section}>
              <Text accessibilityRole="header" style={s.sectionTitle}>
                {section.title}
              </Text>
              {renderServiceList(section.items)}
            </View>
          ))
        : browseSections.length > 0 && (
            <View style={s.section}>
              <Text accessibilityRole="header" style={s.sectionTitle}>
                更多服務
              </Text>
              <View style={s.list}>
                {browseSections.map((section) => {
                  const expanded = expandedSections.has(section.title);
                  return (
                    <React.Fragment key={section.title}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${expanded ? '收合' : '展開'}${section.title}，共 ${section.items.length} 項服務`}
                        accessibilityState={{ expanded }}
                        onPress={() => toggleSection(section.title)}
                        android_ripple={{ color: theme.colors.surfaceInteractiveStrong }}
                        style={({ pressed }) => [s.categoryRow, pressed && s.pressed]}
                      >
                        <Text style={s.categoryTitle}>{section.title}</Text>
                        <Text style={s.categoryCount}>{section.items.length}</Text>
                        <Ionicons
                          name={expanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={theme.colors.muted}
                        />
                      </Pressable>
                      <View style={[s.divider, expanded && s.dividerInset]} />
                      {expanded
                        ? section.items.map((item, index) =>
                            renderService(
                              item,
                              true,
                              index === section.items.length - 1 ? 'full' : 'inset',
                            ),
                          )
                        : null}
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          )}

      {quickActions.length > 0 ? (
        <View style={s.section}>
          <Text accessibilityRole="header" style={s.sectionTitle}>
            可以直接做
          </Text>
          <View style={s.list}>
            {quickActions.map((action) => (
              <React.Fragment key={action.destination}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'依需求前往' + action.label}
                  onPress={() => {
                    Keyboard.dismiss();
                    safeNavigate(navigation, action.route, undefined, {
                      fallbackMessage: '目前無法開啟對應服務，請稍後重試。',
                    });
                  }}
                  android_ripple={{ color: theme.colors.surfaceInteractiveStrong }}
                  style={({ pressed }) => [s.serviceRow, pressed && s.pressed]}
                >
                  <View style={s.serviceCopy}>
                    <Text style={s.serviceTitle}>{action.label}</Text>
                    <Text style={s.serviceDetail}>{action.description}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={theme.colors.accent} />
                </Pressable>
                <View style={s.divider} />
              </React.Fragment>
            ))}
          </View>
          <Text style={[s.subtitle, s.note]}>這裡只會開啟功能，變更或提交仍需你確認。</Text>
        </View>
      ) : null}
      {matchCount === 0 && quickActions.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="search-outline" size={28} color={theme.colors.muted} accessible={false} />
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
    </AIScreen>
  );
}

const FREQUENT_TITLE = '常用服務';
const serviceTestId = (item: ServiceItem) =>
  item.screen === 'MapV2'
    ? 'e2e-campus-open-map'
    : item.screen === '餐廳總覽'
      ? 'e2e-campus-open-cafeteria'
      : undefined;

const ICON_COLUMN = 24;
const ROW_GAP = 16;
const CHILD_INDENT = 16;

const createStyles = () =>
  StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 22,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingTop: 12,
    },
    intro: { paddingTop: 16, paddingBottom: 12 },
    heading: {
      fontFamily: pageTitleFont,
      color: theme.colors.text,
      fontSize: 32,
      lineHeight: 40,
      fontWeight: '700',
      letterSpacing: -0.6,
    },
    subtitle: { color: theme.colors.muted, fontSize: 14, lineHeight: 23 },
    note: { paddingTop: 10 },
    searchBox: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 12,
      paddingRight: 4,
      borderWidth: 1.5,
      borderColor: 'transparent',
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceInteractive,
    },
    searchFocused: { borderColor: theme.colors.accent },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      color: theme.colors.text,
      fontSize: 17,
      paddingVertical: 10,
    },
    clearSearch: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    searchCaption: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, paddingTop: 12 },
    section: { marginTop: 28 },
    sectionTitle: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '600',
      marginBottom: 6,
    },
    band: {
      flexDirection: 'row',
      marginTop: 20,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: theme.colors.surface,
    },
    bandButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 80,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 2,
    },
    bandDivider: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.separator,
    },
    bandLabel: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      textAlign: 'center',
    },
    list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.separator },
    categoryRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    categoryTitle: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.text,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '600',
    },
    categoryCount: {
      color: theme.colors.muted,
      fontSize: 14,
      fontVariant: ['tabular-nums'],
    },
    serviceRow: {
      minHeight: 64,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: ROW_GAP,
    },
    childRow: { paddingLeft: CHILD_INDENT },
    rowIcon: { width: ICON_COLUMN, alignItems: 'center' },
    serviceCopy: { flex: 1, minWidth: 0, gap: 2 },
    serviceTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: '500' },
    childTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 21, fontWeight: '400' },
    serviceDetail: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.separator },
    dividerInset: { marginLeft: ICON_COLUMN + ROW_GAP },
    dividerNested: { marginLeft: CHILD_INDENT + ICON_COLUMN + ROW_GAP },
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
