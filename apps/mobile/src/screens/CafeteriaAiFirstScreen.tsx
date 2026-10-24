import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  loadDiningCatalog,
  loadPublicDiningCatalog,
  watchDiningReceipt,
  loadDiningIntent,
  prepareDiningIntent,
  submitDiningIntent,
  diningTotal,
  DiningError,
  ORDER_NOT_SENT_TEXT,
  ORDER_CHECKING_TEXT,
  type DiningScope,
  type DiningCatalog,
  type DiningIntent,
  type DiningMenu,
  type DiningReceipt,
} from '../features/dining';
import { NETWORK_RETRY_TEXT, loadServiceFailureCopy } from '../utils/loadFailureCopy';
import {
  describePickupNumber,
  formatShortOrderCode,
} from '@campus/shared/src/ordering/pickupNumber';
import {
  CAFETERIA_EMPTY_SCHOOL_TEXT,
  cafeteriaReviewBadge,
} from '@campus/shared/src/cafeteriaCatalog';
import { MY_ORDER_STATUS_LABELS as statuses } from './MyOrdersScreen';
import { safeNavigate } from '../utils/safeNavigate';
import { isMobileOnlineOrderingEnabled, ONLINE_ORDERING_OFF_TEXT } from '../utils/onlineOrdering';

type Props = {
  navigation?: {
    goBack?: () => void;
    navigate?: (route: string, params?: Record<string, unknown>) => void;
  };
};
export default function CafeteriaAiFirstScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = { userId: user?.uid ?? '', schoolId: school.id };
  const scopeKey = JSON.stringify(scope);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return (
    <DiningContent
      key={scopeKey}
      scope={scope}
      scopeKey={scopeKey}
      activeScope={activeScope}
      navigation={navigation}
    />
  );
}
function DiningContent({
  scope,
  scopeKey,
  activeScope,
  navigation,
}: Props & {
  scope: DiningScope;
  scopeKey: string;
  activeScope: React.MutableRefObject<string>;
}) {
  const [catalog, setCatalog] = useState<DiningCatalog | null>(null);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<'all' | 'menu' | 'budget'>('all');
  const [expanded, setExpanded] = useState<string[]>([]);
  const styles = diningStyles();
  const [selected, setSelected] = useState<DiningMenu | null>(null);
  const [pending, setPending] = useState<DiningIntent | null>(null);
  const [receipt, setReceipt] = useState<DiningReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const generation = useRef(0);
  const isCurrent = () => mounted.current && activeScope.current === scopeKey;
  const load = async () => {
    if (!isCurrent() || lock.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setCatalog(null);
    try {
      const [next, saved] = await Promise.all([
        scope.userId
          ? loadDiningCatalog(scope, isCurrent)
          : loadPublicDiningCatalog(scope.schoolId),
        scope.userId ? loadDiningIntent(scope, isCurrent) : Promise.resolve(null),
      ]);
      if (isCurrent() && request === generation.current) {
        setCatalog(next);
        setPending(saved);
      }
    } catch (reason) {
      if (isCurrent() && request === generation.current)
        setError(reason instanceof DiningError ? reason.message : loadServiceFailureCopy(reason));
    } finally {
      if (isCurrent() && request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
    // This content remounts for every account and school change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = async () => {
    if (!isCurrent() || lock.current || (!pending && !selected)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const intent = pending ?? (await prepareDiningIntent(scope, selected!, isCurrent));
      if (!isCurrent()) return;
      setPending(intent);
      setSelected(null);
      const next = await submitDiningIntent(intent, isCurrent);
      if (isCurrent()) {
        setReceipt(next);
        setPending(null);
      }
    } catch (reason) {
      if (isCurrent()) {
        setError(reason instanceof DiningError ? reason.message : ORDER_NOT_SENT_TEXT);
        if (reason instanceof DiningError && reason.kind === 'not-sent') {
          setPending(null);
          setSelected(null);
          setCatalog(null);
        }
      }
    } finally {
      if (isCurrent()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const needle = keyword.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');
  const restaurants = useMemo(() => {
    const menusByVenue = new Map<string, DiningMenu[]>();
    for (const menu of catalog?.menus ?? []) {
      const items = menusByVenue.get(menu.cafeteriaId) ?? [];
      items.push(menu);
      menusByVenue.set(menu.cafeteriaId, items);
    }
    const matches = (value: string) =>
      value.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(needle);
    return (catalog?.venues ?? []).flatMap((venue) => {
      const allMenus = menusByVenue.get(venue.id) ?? [];
      const venueMatches = !needle || matches(`${venue.name} ${venue.location}`);
      const matchedMenus = allMenus.filter(
        (menu) =>
          (venueMatches || matches(`${menu.name} ${menu.description}`)) &&
          (filter !== 'budget' || (menu.price !== null && menu.price <= 100)),
      );
      if ((!venueMatches && !matchedMenus.length) || (filter !== 'all' && !matchedMenus.length))
        return [];
      const prices = allMenus.flatMap((menu) => (menu.price !== null ? [menu.price] : []));
      return [
        {
          venue,
          menus: matchedMenus,
          total: allMenus.length,
          lowestPrice: prices.length ? Math.min(...prices) : null,
        },
      ];
    });
  }, [catalog, filter, needle]);
  const clearFilters = () => {
    setKeyword('');
    setFilter('all');
  };
  const venueName = (menu: DiningMenu) =>
    catalog?.venues.find((venue) => venue.id === menu.cafeteriaId)?.name ?? '未提供餐廳資料';
  // 訂單還沒結束前一直盯著：店家給號碼就換成真的號碼，店家取消就拿掉號碼
  const receiptId = receipt?.id ?? null;
  const receiptOpen = Boolean(
    receipt && receipt.status !== 'completed' && receipt.status !== 'cancelled',
  );
  useEffect(() => {
    if (!receiptId || !receiptOpen || !scope.userId) return;
    const stop = watchDiningReceipt({ ...scope, orderId: receiptId }, (patch) => {
      if (!isCurrent()) return;
      setReceipt((current) =>
        current && current.id === receiptId
          ? {
              ...current,
              queueNumber: patch.queueNumber,
              status: patch.status ?? current.status,
              cancelledBy: patch.cancelledBy ?? current.cancelledBy ?? null,
              cancelReason: patch.cancelReason ?? current.cancelReason ?? null,
            }
          : current,
      );
    });
    return () => stop?.();
    // scope is fixed for this mounted content (remounts on account/school change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId, receiptOpen]);
  const pickup = receipt ? describePickupNumber(receipt) : null;
  const quote = selected?.price != null ? diningTotal(selected.price) : null;
  return (
    <AIDetailScreen
      title="校園餐廳"
      subtitle="選店、看菜單，再決定吃什麼。"
      onBack={navigation?.goBack}
      rightAction={
        scope.userId && navigation?.navigate ? (
          <AIButton
            label="我的訂單"
            variant="ghost"
            onPress={() => navigation.navigate?.('StudentOrders')}
          />
        ) : undefined
      }
    >
      {receipt ? (
        <AICard title={statuses[receipt.status] ?? '訂單紀錄'}>
          <Text style={{ color: aiTokens.text }}>
            {receipt.label} · 訂單金額 NT${receipt.total}
          </Text>
          {pickup?.state === 'assigned' ? (
            <Text
              accessibilityLabel={pickup.text}
              style={{ color: aiTokens.text, fontSize: 20, fontWeight: '700', marginTop: 8 }}
            >
              {pickup.text}
            </Text>
          ) : pickup?.state === 'cancelled' ? (
            <Text style={{ color: aiTokens.danger, fontWeight: '700', marginTop: 8 }}>
              {pickup.text}
            </Text>
          ) : pickup ? (
            <View style={{ marginTop: 8, gap: 4 }}>
              <Text style={{ color: aiTokens.text, fontWeight: '700' }}>{pickup.text}</Text>
              {pickup.detail ? (
                <Text selectable style={{ color: aiTokens.text }}>
                  {pickup.detail}
                </Text>
              ) : null}
              <Text style={{ color: aiTokens.muted }}>狀態：{pickup.label}</Text>
            </View>
          ) : null}
          <Text selectable style={{ color: aiTokens.muted, marginTop: 8 }}>
            {formatShortOrderCode(receipt.id)}
          </Text>
          {navigation?.navigate ? (
            <View style={{ marginTop: 12 }}>
              <AIButton
                label="看我的訂單"
                variant="ghost"
                onPress={() => navigation.navigate?.('StudentOrders')}
              />
            </View>
          ) : null}
        </AICard>
      ) : null}
      {pending ? (
        <AICard
          title={
            busy ? '訂單送出中' : error === ORDER_CHECKING_TEXT ? '還在確認訂單' : '訂單沒送出去'
          }
        >
          <View style={{ gap: 12 }}>
            {busy ? null : (
              <Text accessibilityRole="alert" style={{ color: aiTokens.text, fontWeight: '700' }}>
                {error || ORDER_NOT_SENT_TEXT}
              </Text>
            )}
            <Text style={{ color: aiTokens.text }}>
              {pending.label} · 到店應付 NT${pending.expectedTotal}
            </Text>
            <Text style={{ color: aiTokens.muted }}>
              再試一次會沿用同一個訂單編號，不會重複下單。
            </Text>
            {!busy && error === ORDER_CHECKING_TEXT ? (
              navigation?.navigate ? (
                <AIButton label="我的訂單" onPress={() => navigation.navigate?.('StudentOrders')} />
              ) : null
            ) : (
              <AIButton
                label={busy ? '送出中' : '再試一次'}
                disabled={busy}
                onPress={() => void submit()}
              />
            )}
          </View>
        </AICard>
      ) : null}
      <View style={styles.searchArea}>
        <Text accessibilityRole="header" style={styles.heading}>
          今天想吃什麼？
        </Text>
        <View style={styles.searchField}>
          <Ionicons name="search-outline" size={20} color={aiTokens.muted} />
          <TextInput
            accessibilityLabel="餐點或店名"
            value={keyword}
            maxLength={100}
            onChangeText={setKeyword}
            placeholder="搜尋店名、餐點或位置"
            placeholderTextColor={aiTokens.muted}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {keyword ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除搜尋"
              onPress={() => setKeyword('')}
              style={styles.clearButton}
            >
              <Ionicons name="close-circle" size={20} color={aiTokens.muted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filters}>
          {(
            [
              ['all', '全部餐廳'],
              ['menu', '有菜單'],
              ['budget', '100 元內'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === value }}
              onPress={() => setFilter(value)}
              style={[styles.filter, filter === value && styles.filterSelected]}
            >
              <Text
                style={{
                  color: filter === value ? aiTokens.ai : aiTokens.textSecondary,
                  fontWeight: filter === value ? '700' : '500',
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.resultBar}>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {loading
              ? '正在讀取餐廳…'
              : catalog
                ? `${restaurants.length} 間餐廳${filter === 'budget' ? '有百元內餐點' : ''}`
                : '餐廳資料'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="更新菜單"
            accessibilityState={{ disabled: loading || busy }}
            disabled={loading || busy}
            onPress={() => void load()}
            style={styles.refreshButton}
          >
            <Ionicons name="refresh-outline" size={17} color={aiTokens.muted} />
            <Text style={styles.muted}>{loading ? '讀取中' : '更新菜單'}</Text>
          </Pressable>
        </View>
      </View>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel="讀取餐廳" color={aiTokens.ai} />
          <Text style={styles.muted}>餐廳與菜單載入中</Text>
        </View>
      ) : null}
      {error && !pending ? (
        <AICard title="餐廳資料暫時無法讀取">
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>
            {error}
          </Text>
          {error === NETWORK_RETRY_TEXT ? (
            <AIButton label="重新整理" variant="ghost" onPress={() => void load()} />
          ) : null}
        </AICard>
      ) : null}
      {catalog ? (
        restaurants.length === 0 ? (
          <AICard
            title={
              !needle && filter === 'all' && catalog.venues.length === 0
                ? CAFETERIA_EMPTY_SCHOOL_TEXT
                : '找不到符合的餐廳或餐點'
            }
          >
            <Text style={styles.muted}>
              {catalog.venues.length === 0
                ? '這間學校還沒提供餐廳資料，之後再來看看。'
                : '試試其他關鍵字，或清除篩選查看全部餐廳。'}
            </Text>
            {needle || filter !== 'all' ? (
              <AIButton label="清除篩選" variant="ghost" onPress={clearFilters} />
            ) : null}
          </AICard>
        ) : (
          restaurants.map(({ venue, menus, total, lowestPrice }) => {
            const isExpanded = expanded.includes(venue.id);
            const preview = isExpanded ? menus : menus.slice(0, 3);
            return (
              <AICard key={venue.id} style={styles.restaurant}>
                <View style={styles.restaurantHeader}>
                  <View style={styles.restaurantIcon} accessibilityElementsHidden>
                    <Ionicons name="restaurant-outline" size={23} color={aiTokens.ai} />
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text accessibilityRole="header" style={styles.restaurantName}>
                      {venue.name}
                    </Text>
                    <Text style={styles.muted}>{venue.location || '位置資訊未提供'}</Text>
                  </View>
                </View>
                <View style={styles.restaurantMeta}>
                  {cafeteriaReviewBadge(venue.reviewStatus) ? (
                    <Text style={styles.reviewBadge}>
                      {cafeteriaReviewBadge(venue.reviewStatus)}
                    </Text>
                  ) : null}
                  <Text style={styles.muted}>
                    {total === 0
                      ? '尚未提供菜單'
                      : needle || filter === 'budget'
                        ? `${menus.length} 道符合 · 共 ${total} 道`
                        : `${total} 道餐點`}
                  </Text>
                  {lowestPrice !== null ? (
                    <Text style={styles.priceFrom}>
                      菜單 NT${lowestPrice.toLocaleString('zh-TW')} 起
                    </Text>
                  ) : null}
                </View>
                {preview.map((menu) => (
                  <View key={menu.id} style={styles.menuRow}>
                    <View style={styles.menuHeading}>
                      <Text style={styles.menuName}>{menu.name}</Text>
                      <Text style={styles.price}>
                        {menu.price === null
                          ? '未標價'
                          : `NT$${menu.price.toLocaleString('zh-TW')}`}
                      </Text>
                    </View>
                    {menu.description ? (
                      <Text numberOfLines={isExpanded ? undefined : 2} style={styles.muted}>
                        {menu.description}
                      </Text>
                    ) : null}
                    {menu.orderable && scope.userId ? (
                      <AIButton
                        label={`選擇${menu.name}`}
                        variant="ghost"
                        disabled={busy || Boolean(pending)}
                        onPress={() => {
                          if (isCurrent()) setSelected(menu);
                        }}
                      />
                    ) : null}
                  </View>
                ))}
                {!menus.length ? (
                  <Text style={styles.menuEmpty}>可以先看店家資訊，餐點請向店家確認。</Text>
                ) : null}
                <View style={styles.restaurantActions}>
                  {navigation?.navigate ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`查看${venue.name}的店家資訊`}
                      onPress={() =>
                        safeNavigate(navigation, 'Storefront', { cafeteriaId: venue.id })
                      }
                      style={styles.storefrontButton}
                    >
                      <Text style={{ color: aiTokens.ai, fontWeight: '600' }}>
                        店家資訊與完整菜單
                      </Text>
                      <Ionicons name="arrow-forward" size={17} color={aiTokens.ai} />
                    </Pressable>
                  ) : null}
                  {menus.length > 3 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${isExpanded ? '收合' : '展開'}${venue.name}的菜單`}
                      accessibilityState={{ expanded: isExpanded }}
                      onPress={() =>
                        setExpanded((current) =>
                          current.includes(venue.id)
                            ? current.filter((id) => id !== venue.id)
                            : [...current, venue.id],
                        )
                      }
                      style={styles.expandButton}
                    >
                      <Text style={styles.muted}>
                        {isExpanded ? '收合菜單' : `再看 ${menus.length - 3} 道`}
                      </Text>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={17}
                        color={aiTokens.muted}
                      />
                    </Pressable>
                  ) : null}
                </View>
              </AICard>
            );
          })
        )
      ) : null}
      <View style={styles.footnote}>
        {isMobileOnlineOrderingEnabled() ? (
          <AIButton
            label="前往平台點餐"
            onPress={() => safeNavigate(navigation, 'NuniWorkspace', { tab: 'food' })}
          />
        ) : (
          <Text style={styles.muted}>{ONLINE_ORDERING_OFF_TEXT}</Text>
        )}
        <Text style={styles.muted}>營業時間、餐點供應與價格，以店家現場資訊為準。</Text>
      </View>
      <Modal
        visible={Boolean(selected)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setSelected(null);
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.35)',
            padding: 20,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: aiTokens.surface,
              borderRadius: 16,
              padding: 24,
              gap: 16,
            }}
          >
            <Text style={{ color: aiTokens.text, fontSize: 20, fontWeight: '600' }}>確認餐點</Text>
            <Text style={{ color: aiTokens.text }}>{selected?.name} · 1 份</Text>
            <Text style={{ color: aiTokens.muted }}>{selected ? venueName(selected) : ''}</Text>
            <Text style={{ color: aiTokens.text }}>
              餐點 NT${quote?.subtotal} + 稅額 NT${quote?.tax}
            </Text>
            <Text style={{ color: aiTokens.text, fontWeight: '600' }}>
              到店付款合計 NT${quote?.total}
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {error}
              </Text>
            ) : null}
            <AIButton
              label={busy ? '送出中' : '送出訂單，到店付款'}
              disabled={busy}
              onPress={() => void submit()}
            />
            <AIButton
              label="返回菜單"
              variant="ghost"
              disabled={busy}
              onPress={() => setSelected(null)}
            />
          </View>
        </View>
      </Modal>
    </AIDetailScreen>
  );
}

function diningStyles() {
  return StyleSheet.create({
    searchArea: { paddingHorizontal: aiTokens.space.md, paddingTop: 20, gap: 14 },
    heading: { color: aiTokens.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: aiTokens.border,
      backgroundColor: aiTokens.surface,
      borderRadius: 14,
      paddingLeft: 14,
      minHeight: 52,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      color: aiTokens.text,
      fontSize: 16,
      paddingVertical: 14,
      paddingHorizontal: 10,
    },
    clearButton: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    filter: {
      minHeight: 44,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: aiTokens.border,
      paddingHorizontal: 15,
      paddingVertical: 10,
      borderRadius: 22,
      backgroundColor: aiTokens.surface,
    },
    filterSelected: { backgroundColor: aiTokens.aiSoft, borderColor: aiTokens.ai },
    resultBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    refreshButton: {
      flexDirection: 'row',
      minHeight: 44,
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 4,
    },
    muted: { color: aiTokens.muted, fontSize: 13, lineHeight: 21 },
    loading: { alignItems: 'center', padding: 32, gap: 12 },
    restaurant: { marginBottom: 16, padding: 18 },
    restaurantHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    restaurantIcon: {
      width: 46,
      height: 46,
      borderRadius: 13,
      backgroundColor: aiTokens.aiSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    restaurantName: { color: aiTokens.text, fontSize: 19, lineHeight: 26, fontWeight: '700' },
    restaurantMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      paddingTop: 10,
      paddingBottom: 8,
    },
    reviewBadge: {
      color: aiTokens.muted,
      backgroundColor: aiTokens.panel,
      fontSize: 12,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    priceFrom: { color: aiTokens.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    menuRow: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: aiTokens.border,
      paddingVertical: 13,
      gap: 7,
    },
    menuHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    menuName: { flex: 1, color: aiTokens.text, fontWeight: '500', fontSize: 15, lineHeight: 22 },
    price: {
      color: aiTokens.text,
      fontWeight: '600',
      fontSize: 15,
      lineHeight: 22,
      fontVariant: ['tabular-nums'],
    },
    menuEmpty: { color: aiTokens.muted, lineHeight: 22, paddingVertical: 12 },
    restaurantActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: aiTokens.border,
      gap: 4,
    },
    storefrontButton: {
      minHeight: 46,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      paddingRight: 8,
    },
    expandButton: { minHeight: 46, flexDirection: 'row', gap: 6, alignItems: 'center' },
    footnote: { padding: aiTokens.space.md, gap: 8 },
  });
}
